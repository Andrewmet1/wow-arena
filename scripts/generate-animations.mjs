#!/usr/bin/env node
/**
 * Generate shared Meshy animations for the animation library.
 * All Meshy-rigged models share the same bone hierarchy, so we generate
 * each unique animation ONCE and share it across all classes.
 *
 * Pipeline: Rig Task ID → Animation API → Download GLBs → shared/
 *
 * Usage:
 *   node scripts/generate-animations.mjs --rig-task <rigTaskId>
 *   node scripts/generate-animations.mjs --rig-task <rigTaskId> --only idle,attack,dead
 *   node scripts/generate-animations.mjs --rig-task <rigTaskId> --rig-name tyrant_frost_dragon
 *   node scripts/generate-animations.mjs list
 *   node scripts/generate-animations.mjs list-rigs
 *
 * Rig task IDs (any class works since animations are shared):
 *   Tyrant:    019c6e11-13e7-7295-a177-4dbda07934aa
 *   Wraith:    019c6e7d-0741-7db3-80d2-6f6790ed4a35
 *   Infernal:  019c6ea5-346e-7857-bfad-e3f4f4586cb4
 *   Harbinger: 019c6eda-d451-7720-8faa-eca6741a0685
 *   Revenant:  019c6f31-d0f6-78c8-b20e-a15e8fe302a7
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env
const envPath = path.join(ROOT, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const API_KEY = envContent.match(/MESHY_API_KEY=(.+)/)?.[1]?.trim();
if (!API_KEY) {
  console.error('Missing MESHY_API_KEY in .env');
  process.exit(1);
}

const MESHY_API = 'https://api.meshy.ai';

// ─── Shared animation library ──────────────────────────────────────────────
// Each unique animation only needs to be generated once.
// Maps: shared clip name → { action_id, meshy_name }
const SHARED_LIBRARY = {
  idle:                         { action_id: 0,   name: 'Idle' },
  attack:                       { action_id: 4,   name: 'Attack' },
  dead:                         { action_id: 8,   name: 'Dead' },
  run:                          { action_id: 14,  name: 'Run_02' },
  basic_jump:                   { action_id: 86,  name: 'Basic_Jump' },
  chest_pound_taunt:            { action_id: 88,  name: 'Chest_Pound_Taunt' },
  combat_stance:                { action_id: 89,  name: 'Combat_Stance' },
  kung_fu_punch:                { action_id: 96,  name: 'Kung_Fu_Punch' },
  left_slash:                   { action_id: 97,  name: 'Left_Slash' },
  run_and_shoot:                { action_id: 98,  name: 'Run_and_Shoot' },
  reaping_swing:                { action_id: 99,  name: 'Reaping_Swing' },
  rightward_spin:               { action_id: 100, name: 'Rightward_Spin' },
  sword_judgment:               { action_id: 102, name: 'Sword_Judgment' },
  charged_spell_cast:           { action_id: 125, name: 'Charged_Spell_Cast' },
  mage_spell_cast:              { action_id: 126, name: 'Mage_Spell_Cast' },
  charged_ground_slam:          { action_id: 127, name: 'Charged_Ground_Slam' },
  heavy_hammer_swing:           { action_id: 128, name: 'Heavy_Hammer_Swing' },
  mage_spell_cast_3:            { action_id: 130, name: 'Mage_Spell_Cast_3' },
  mage_spell_cast_5:            { action_id: 132, name: 'Mage_Spell_Cast_5' },
  mage_spell_cast_8:            { action_id: 137, name: 'Mage_Spell_Cast_8' },
  block:                        { action_id: 138, name: 'Block' },
  stand_dodge:                  { action_id: 156, name: 'Stand_Dodge' },
  roll_dodge:                   { action_id: 157, name: 'Roll_Dodge' },
  hit_reaction:                 { action_id: 176, name: 'Hit_Reaction' },
  hit_reaction_1:               { action_id: 178, name: 'Hit_Reaction_1' },
  dying_backwards:              { action_id: 189, name: 'dying_backwards' },
  lean_forward_sprint:          { action_id: 509, name: 'Lean_Forward_Sprint' },

  // ── Melee attacks (weapon) ──
  counterstrike:                { action_id: 90,  name: 'Counterstrike' },
  double_blade_spin:            { action_id: 91,  name: 'Double_Blade_Spin' },
  double_combo_attack:          { action_id: 92,  name: 'Double_Combo_Attack' },
  dodge_and_counter:            { action_id: 93,  name: 'Dodge_and_Counter' },
  triple_combo_attack:          { action_id: 105, name: 'Triple_Combo_Attack' },
  weapon_combo:                 { action_id: 199, name: 'Weapon_Combo' },
  right_hand_sword_slash:       { action_id: 219, name: 'Right_Hand_Sword_Slash' },
  shield_push:                  { action_id: 220, name: 'Shield_Push_Left' },
  charged_upward_slash:         { action_id: 221, name: 'Charged_Upward_Slash' },
  axe_spin_attack:              { action_id: 238, name: 'Axe_Spin_Attack' },
  charged_slash:                { action_id: 242, name: 'Charged_Slash' },
  charged_axe_chop:             { action_id: 237, name: 'Charged_Axe_Chop' },
  thrust_slash:                 { action_id: 240, name: 'Thrust_Slash' },
  weapon_combo_2:               { action_id: 241, name: 'Weapon_Combo_2' },
  punch_combo:                  { action_id: 198, name: 'Punch_Combo' },
  weapon_combo_1:               { action_id: 202, name: 'Weapon_Combo_1' },

  // ── Spell casts (all variants) ──
  skill_01:                     { action_id: 17,  name: 'Skill_01' },
  skill_02:                     { action_id: 18,  name: 'Skill_02' },
  skill_03:                     { action_id: 19,  name: 'Skill_03' },
  mage_spell_cast_0:            { action_id: 129, name: 'Mage_Spell_Cast_0' },
  mage_spell_cast_2:            { action_id: 131, name: 'Mage_Spell_Cast_2' },
  mage_spell_cast_4:            { action_id: 133, name: 'Mage_Spell_Cast_4' },
  mage_spell_cast_6:            { action_id: 135, name: 'Mage_Spell_Cast_6' },
  mage_spell_cast_7:            { action_id: 136, name: 'Mage_Spell_Cast_7' },

  // ── Defense / parry / block variants ──
  sword_shout:                  { action_id: 101, name: 'Sword_Shout' },
  sword_parry:                  { action_id: 147, name: 'Sword_Parry' },
  two_handed_parry:             { action_id: 149, name: 'Two_Handed_Parry' },
  sword_parry_backward:         { action_id: 148, name: 'Sword_Parry_Backward' },
  block_2:                      { action_id: 139, name: 'Block2' },
  block_3:                      { action_id: 140, name: 'Block3' },
  block_4:                      { action_id: 141, name: 'Block4' },
  block_5:                      { action_id: 142, name: 'Block5' },

  // ── Roll dodge variants ──
  roll_dodge_1:                 { action_id: 159, name: 'Roll_Dodge_1' },
  roll_dodge_2:                 { action_id: 160, name: 'Roll_Dodge_2' },

  // ── Movement / acrobatic ──
  standard_forward_charge:      { action_id: 510, name: 'Standard_Forward_Charge' },
  quick_step_spin_dodge:        { action_id: 384, name: 'Quick_Step_and_Spin_Dodge' },
  backflip:                     { action_id: 452, name: 'Backflip' },
  sprint_roll_and_flip:         { action_id: 401, name: 'Sprint_Roll_and_Flip' },
  jump_and_slam:                { action_id: 382, name: 'Jump_and_Slam_Back_Down' },


  // ── Idle variants ──
  idle_02:                      { action_id: 11,  name: 'Idle_02' },
  idle_03:                      { action_id: 12,  name: 'Idle_03' },
  alert:                        { action_id: 2,   name: 'Alert' },
  axe_stance:                   { action_id: 85,  name: 'Axe_Stance' },
  boxing_practice:              { action_id: 87,  name: 'Boxing_Practice' },
  battle_pose:                  { action_id: 377, name: 'Relax_Arms_Then_Strike_Battle_Pose' },

  // ── Taunts / emotes ──
  angry_stomp:                  { action_id: 26,  name: 'Angry_Stomp' },
  victory_cheer:                { action_id: 59,  name: 'Victory_Cheer' },
  victory_fist_pump:            { action_id: 403, name: 'Victory_Fist_Pump' },

  // ── Run / movement variants ──
  run_03:                       { action_id: 15,  name: 'Run_03' },
  run_fast:                     { action_id: 16,  name: 'RunFast' },
  walk_fight_forward:           { action_id: 21,  name: 'Walk_Fight_Forward' },
  walk_fight_back:              { action_id: 20,  name: 'Walk_Fight_Back' },
  walk_backward:                { action_id: 544, name: 'Walk_Backward' },
  injured_walk:                 { action_id: 111, name: 'Injured_Walk' },
  sneaky_walk:                  { action_id: 559, name: 'Sneaky_Walk' },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${MESHY_API}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${endpoint} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return safeJson(res);
}

async function pollTask(endpoint, taskId) {
  const maxAttempts = 120; // 10 min max
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${MESHY_API}${endpoint}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    if (!res.ok) {
      console.warn(`  Poll failed (${res.status}), retrying...`);
      await sleep(5000);
      continue;
    }
    let data;
    try {
      data = await safeJson(res);
    } catch {
      console.warn(`  Non-JSON poll response, retrying...`);
      await sleep(5000);
      continue;
    }
    if (data.status === 'SUCCEEDED') return data;
    if (data.status === 'FAILED') {
      throw new Error(`Task ${taskId} failed: ${data.task_error?.message || 'unknown'}`);
    }
    process.stdout.write(`  Status: ${data.status} (${data.progress || 0}% | ${i + 1}/${maxAttempts})    \r`);
    await sleep(5000);
  }
  throw new Error(`Task ${taskId} timed out`);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  console.log(`  Saved: ${destPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
}

async function generateAnimation(rigTaskId, clipName, actionId, destPath) {
  console.log(`\n  ── ${clipName} — ${SHARED_LIBRARY[clipName].name} (action_id: ${actionId}) ──`);

  const result = await apiPost('/openapi/v1/animations', {
    rig_task_id: rigTaskId,
    action_id: actionId,
  });

  const taskId = result.result;
  console.log(`  Task ID: ${taskId}`);

  const taskData = await pollTask('/openapi/v1/animations', taskId);
  console.log('\n  Animation complete!');

  const glbUrl = taskData.result?.animation_glb_url;
  if (glbUrl) {
    await downloadFile(glbUrl, destPath);
  } else {
    console.warn('  No GLB URL found:', JSON.stringify(Object.keys(taskData.result || {})));
  }
}

// ── Main ──
const args = process.argv.slice(2);

if (args[0] === 'list') {
  console.log(`\n  Shared Animation Library (${Object.keys(SHARED_LIBRARY).length} clips):\n`);
  for (const [name, info] of Object.entries(SHARED_LIBRARY)) {
    const sharedDir = path.join(ROOT, 'public', 'assets', 'animations', 'shared');
    const exists = fs.existsSync(path.join(sharedDir, `${name}.glb`));
    const marker = exists ? '✓' : '✗';
    console.log(`  ${marker} ${name.padEnd(32)} → action_id ${String(info.action_id).padEnd(4)} (${info.name})`);
  }
  const sharedDir = path.join(ROOT, 'public', 'assets', 'animations', 'shared');
  const existing = fs.readdirSync(sharedDir).filter(f => f.endsWith('.glb')).length;
  console.log(`\n  ${existing}/${Object.keys(SHARED_LIBRARY).length} clips available in shared/\n`);
  process.exit(0);
}

if (args[0] === 'list-rigs') {
  const rigsDir = path.join(ROOT, 'public', 'assets', 'animations', 'rigs');
  if (!fs.existsSync(rigsDir)) {
    console.log('\n  No rig-specific animation sets found.\n');
    process.exit(0);
  }
  const rigDirs = fs.readdirSync(rigsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  if (rigDirs.length === 0) {
    console.log('\n  No rig-specific animation sets found.\n');
    process.exit(0);
  }
  console.log(`\n  Rig-Specific Animation Sets:\n`);
  for (const dir of rigDirs) {
    const dirPath = path.join(rigsDir, dir.name);
    const clips = fs.readdirSync(dirPath).filter(f => f.endsWith('.glb'));
    console.log(`  ${dir.name.padEnd(40)} ${clips.length} clips`);
  }
  console.log('');
  process.exit(0);
}

const rigTaskIdx = args.indexOf('--rig-task');
const rigTaskId = rigTaskIdx >= 0 ? args[rigTaskIdx + 1] : null;
const onlyIdx = args.indexOf('--only');
const onlyFilter = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
const rigNameIdx = args.indexOf('--rig-name');
const rigName = rigNameIdx >= 0 ? args[rigNameIdx + 1] : null;
const skipExisting = !args.includes('--force');

if (!rigTaskId) {
  console.log('Meshy Shared Animation Generator');
  console.log('Usage: node scripts/generate-animations.mjs --rig-task <rigTaskId> [--only idle,attack] [--force]');
  console.log('       node scripts/generate-animations.mjs --rig-task <rigTaskId> --rig-name tyrant_frost_dragon');
  console.log('       node scripts/generate-animations.mjs list');
  console.log('       node scripts/generate-animations.mjs list-rigs');
  console.log('\nRig task IDs (any works — animations are shared):');
  console.log('  Tyrant:    019c6e11-13e7-7295-a177-4dbda07934aa');
  console.log('  Wraith:    019c6e7d-0741-7db3-80d2-6f6790ed4a35');
  console.log('  Infernal:  019c6ea5-346e-7857-bfad-e3f4f4586cb4');
  console.log('  Harbinger: 019c6eda-d451-7720-8faa-eca6741a0685');
  console.log('  Revenant:  019c6f31-d0f6-78c8-b20e-a15e8fe302a7');
  console.log('\nOptions:');
  console.log('  --only <clips>     Only generate specific clips (comma-separated)');
  console.log('  --rig-name <name>  Save to rigs/<name>/ instead of shared/ (for skin-specific anims)');
  console.log('  --force            Regenerate even if clip already exists');
  process.exit(1);
}

async function main() {
  // Determine output directory: shared/ by default, or rigs/<name>/ if --rig-name specified
  const outDir = rigName
    ? path.join(ROOT, 'public', 'assets', 'animations', 'rigs', rigName)
    : path.join(ROOT, 'public', 'assets', 'animations', 'shared');
  fs.mkdirSync(outDir, { recursive: true });

  let entries = Object.entries(SHARED_LIBRARY);
  if (onlyFilter) {
    entries = entries.filter(([name]) => onlyFilter.includes(name));
  }

  // Skip existing files unless --force
  if (skipExisting) {
    const before = entries.length;
    entries = entries.filter(([name]) => !fs.existsSync(path.join(outDir, `${name}.glb`)));
    if (before !== entries.length) {
      console.log(`  Skipping ${before - entries.length} existing clips (use --force to regenerate)`);
    }
  }

  if (entries.length === 0) {
    console.log('\n  All clips already exist. Nothing to generate.\n');
    process.exit(0);
  }

  const label = rigName ? `RIG-SPECIFIC: ${rigName}` : 'SHARED';
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  GENERATING ${label} ANIMATIONS (${entries.length} clips)`);
  console.log(`  Rig Task: ${rigTaskId}`);
  if (rigName) console.log(`  Output:   rigs/${rigName}/`);
  console.log(`${'═'.repeat(60)}`);

  const results = { success: [], failed: [] };

  for (const [clipName, info] of entries) {
    const destPath = path.join(outDir, `${clipName}.glb`);
    try {
      await generateAnimation(rigTaskId, clipName, info.action_id, destPath);
      results.success.push(clipName);
    } catch (err) {
      console.error(`\n  ✗ ${clipName} failed: ${err.message}`);
      results.failed.push(clipName);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Success: ${results.success.join(', ') || 'none'}`);
  if (results.failed.length) {
    console.log(`  Failed:  ${results.failed.join(', ')}`);
  }
  console.log(`  Output:  ${outDir}/`);
  if (rigName) console.log(`  Rig Name: ${rigName}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error(`\n  ✗ Fatal:`, err.message);
  process.exit(1);
});
