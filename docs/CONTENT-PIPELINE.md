# Ebon Crucible — Engine & Content Pipeline

How the engine is put together, why content kept drifting, and the loop that
makes it safe to iterate — whether a human is prompting, an agent is working on
demand, or a job is running unattended.

## 1. How the engine works

Four layers. The important property is that the first one is **shared**.

### Simulation (`src/engine/`, `src/classes/`)
Pure logic: no Three.js, no DOM. `CombatEngine`, `MatchState`, `Unit`,
`CastSystem`, `CrowdControl`, `MovementSystem`, `LineOfSight`.

The server imports these directly — `server/GameRoom.js` runs the *same*
`src/engine/CombatEngine.js` the browser runs. One simulation, two hosts. This
is the single most valuable architectural property in the codebase: server
authority and client prediction can never disagree about rules, only about
timing. Any change here must stay renderer-free or it breaks the server.

### Netcode (`server/GameRoom.js`, `src/main.js`)
Server is authoritative at **10Hz** (`TICK_RATE = 100`). Clients:
- **predict** the local player every frame, reconciling when a tick arrives
  (snap over 5u for teleports, ignore corrections under ~0.6u to avoid jitter)
- **interpolate** remote players from a 6-snapshot buffer at an 80ms render
  delay, with teleport detection and angle-wrapped facing

A low tick rate is normal and fine. What makes netcode *feel* bad is starving
it — see §2.

### Rendering (`src/rendering/`)
`SceneManager` owns the Three.js renderer, post-processing and quality tiers.
`CharacterRenderer` loads models and drives `AnimationMixer`. `ModelLoader`
caches GLBs and applies materials. `SpellEffects` handles VFX.
`DungeonEnvironment` builds dungeon geometry from a wing description.

### Content (`src/rendering/AssetManifest.js`, `src/rendering/DungeonManifest.js`)
Registries mapping ids → files. Everything downstream resolves through these.

```
  generation scripts ──> assets on disk ──> MANIFEST ──> engine reads pools
         ^                                     |
         └─────────── reads the same manifest ─┘
```

That cycle is the whole design. Generation and consumption read the *same*
declaration, so an asset cannot exist on one side and not the other.

## 2. Why it wasn't scalable

Every problem found in this codebase was the same shape: **something was
produced that nothing consumed, and nothing detected it.**

| symptom | cause |
| --- | --- |
| 27 props, 32 textures, 9 monsters unreachable | generation had one hardcoded list, the engine had ~12 others, nothing reconciled them |
| "no animations, can't see the casting" | ability clips lazy-loaded a 37MB GLB mid-cast; the cast ended first, so `idle` played |
| "ping is absurd", laggy movement | those 37MB downloads saturated the connection and stalled the main thread parsing 777K-triangle meshes, starving the snapshot buffer |
| flat, non-AAA characters | Meshy generated full PBR and the pipeline downloaded it, but the rigged GLB carries only baseColor, so the maps sat unused |
| 42 generation scripts, 12 reimplementing Meshy polling | no shared library, so every batch was a fresh copy-paste |

Note the netcode is *not* on that list. It was competently written and was
being starved by the asset layer. Diagnosing from symptoms ("it's laggy →
rewrite netcode") would have rewritten the one part that was already right.

## 3. The loop that makes it safe

Two gates. Both exit non-zero on failure, which is what makes them usable by
something that isn't a human.

```bash
npm run content:check   # static  — orphans, broken refs, blocked assets, theme drift
npm run verify          # runtime — real ModelLoader in a real WebGL context
npm run verify:all      # both
```

`content:check` answers *is it wired up*. `verify` answers *does it load*. You
need both: an asset can be correctly declared and still fail to parse, and it
can parse fine while being unreachable.

`verify` boots headless Chrome with software WebGL and drives the **real**
`ModelLoader` — not a reimplementation — so material and texture wiring is
exercised exactly as the game exercises it. It enforces a 160K triangle budget
and asserts full PBR on every class.

### Adding content — the actual steps

1. **Declare** it in `DungeonManifest.js` (props/textures) or
   `AssetManifest.js` (characters/animations).
2. **Generate** it — `scripts/generate-*.mjs`. Idempotent; skips existing files.
3. **Validate** — `npm run content:check`. Anything undeclared or unreachable
   is reported by name.
4. **Verify** — `npm run verify`. Catches broken geometry, missing maps,
   blown triangle budgets.
5. **Commit** only if both pass.

Re-run `node scripts/bootstrap-dungeon-manifest.mjs` to refresh the manifest
from disk; hand-edits to the `CLASSIFY` map are what persist.

### Placement vocabulary

A prop declares one or more `placements`. `poolFor(x)` is what the engine
calls, so adding a prop to a pool is a one-line manifest change rather than
finding the right array in a 4,400-line file.

```
wall corner center scatter cluster ring pillar rubble arch hanging special
blocked:<system>   — asset is fine, no system can place it yet
unclassified       — needs a decision
```

`blocked:` is deliberate. It keeps an asset visible and accounted for instead
of letting it rot silently, and it names the feature that would unblock it.

## 4. Three ways to iterate

**You, prompting.** Describe the content. The agent declares it, generates it,
runs both gates, and reports. The gates mean you don't have to review asset
wiring by hand — a green `verify:all` means it loads and is reachable.

**An agent, on demand.** Same loop, unattended. Safe because every step has a
machine-readable verdict. `content:check --json` emits structured output for
exactly this.

**Scheduled / autonomous.** Viable for a bounded queue — "work the orphan
list", "generate the declared-but-missing props". Constraints that must hold:

- **Never auto-deploy.** Gates prove *loading*, not *fun* or *balance*.
- **Budget the spend.** Each Meshy asset is a real API charge; cap per run.
- **One concern per commit**, so a bad batch reverts cleanly.
- **Dungeon stays local.** See the four containment gates — env-gated server
  import, gated handlers, deploy-script skip, and a prod hard-off in
  `FeatureFlags.js`. Verify all four still hold before any dungeon work.

## 5. Known gaps

- **No shared generation library.** 42 scripts, 12 reimplementing Meshy
  polling; model versions drift (`meshy-5` vs `meshy-6`, stale `dall-e-3`).
  A `scripts/lib/genkit.mjs` would make a content batch a data file.
- **No spatial dungeon generation.** `DungeonGenerator.js` sequences rooms;
  geometry is shared. The 5 `blocked:architecture` props — stairs, bridge,
  gate, sealed door — are its missing vocabulary.
- **No hazard system.** 4 props waiting on trigger/damage logic.
- **9 monster models undeclared.** Needs stats and balance — a design task.
- **`DungeonEnvironment.js` is 4,433 lines** with two near-duplicate entry
  points (`build` legacy, `buildWing` current).
- **No meshopt/KTX2 compression.** Models are 13MB each; KTX2 would cut GPU
  memory and Steam/iOS download size substantially.
- **Animation quality.** Crossfades exist; additive layers, blend trees, foot
  IK and movement acceleration do not.
