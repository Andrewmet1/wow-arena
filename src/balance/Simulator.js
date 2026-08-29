import { MatchState } from '../engine/MatchState.js';
import { GameLoop } from '../engine/GameLoop.js';
import { Unit } from '../engine/Unit.js';
import { AIController } from '../ai/AIController.js';
import { EventScheduler } from '../arena/EventScheduler.js';

import { SeededRandom } from '../utils/Random.js';
import { EventBus } from '../utils/EventBus.js';
import { Vec3 } from '../utils/Vec3.js';

/**
 * Run a single headless match between two classes
 */
export function runMatch(classDefA, classDefB, seed, config = {}) {
  const {
    maxTicks = 6000,
    enableEvents = true,
    aiDifficulty = 'sim'
  } = config;

  const rng = new SeededRandom(seed);
  const eventBus = new EventBus();

  // Create match
  const match = new MatchState({
    eventBus,
    rng,
    seed,
    maxTicks,
    isSimulation: true
  });

  // Create units
  const unitA = new Unit(0, classDefA.id, classDefA.name);
  const loadoutA = AIController.selectBuildForMatchup(classDefA, classDefB.id);
  classDefA.applyToUnit(unitA, loadoutA);
  unitA.position = new Vec3(-15, 0, 0);
  unitA.facing = 0;

  const unitB = new Unit(1, classDefB.id, classDefB.name);
  const loadoutB = AIController.selectBuildForMatchup(classDefB, classDefA.id);
  classDefB.applyToUnit(unitB, loadoutB);
  unitB.position = new Vec3(15, 0, 0);
  unitB.facing = Math.PI;

  match.addUnit(unitA);
  match.addUnit(unitB);

  // Create AI controllers
  const aiA = new AIController(0, aiDifficulty);
  const aiB = new AIController(1, aiDifficulty);

  // Create game loop and set controllers
  const gameLoop = new GameLoop(match);
  gameLoop.setController(0, aiA);
  gameLoop.setController(1, aiB);

  // Track enemy ability usage for both AIs
  eventBus.on('ability_cast_success', (data) => {
    if (data.sourceId === 0) {
      const ability = unitA.abilities.get(data.abilityId);
      if (ability) aiB.observeEnemyAbility(data.abilityId, ability.cooldown, match.tick);
    } else {
      const ability = unitB.abilities.get(data.abilityId);
      if (ability) aiA.observeEnemyAbility(data.abilityId, ability.cooldown, match.tick);
    }
  });

  // Event scheduler
  let eventScheduler = null;
  if (enableEvents) {
    eventScheduler = new EventScheduler(match);
  }

  // Patch the engine tick to include events
  const originalTick = gameLoop.engine.tick.bind(gameLoop.engine);
  gameLoop.engine.tick = function() {
    if (eventScheduler) {
      eventScheduler.tick(match.tick);
      if (eventScheduler.activeEvent?.expired) {
        eventScheduler.activeEvent = null;
      }
    }
    originalTick();
  };

  // Run headless
  const result = gameLoop.runHeadless();

  return {
    winner: result.winner?.classId || null,
    loser: result.loser?.classId || null,
    duration: result.duration,
    ticks: result.ticks,
    winnerHpPercent: result.winner ? result.winner.hp / result.winner.maxHp : 0,
    stats: {
      [classDefA.id]: {
        damageDealt: unitA.totalDamageDealt,
        damageTaken: unitA.totalDamageTaken,
        healingDone: unitA.totalHealingDone,
        ccInflicted: unitA.totalCCTimeInflicted,
        finalHp: unitA.hp
      },
      [classDefB.id]: {
        damageDealt: unitB.totalDamageDealt,
        damageTaken: unitB.totalDamageTaken,
        healingDone: unitB.totalHealingDone,
        ccInflicted: unitB.totalCCTimeInflicted,
        finalHp: unitB.hp
      }
    },
    seed
  };
}
