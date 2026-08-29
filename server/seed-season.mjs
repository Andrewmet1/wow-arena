#!/usr/bin/env node
// Seed Season 1 Battle Pass configuration into DynamoDB
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// Load env
const ROOT = resolve(import.meta.dirname, '..');
const localEnv = resolve(import.meta.dirname, '.env');
const rootEnv = resolve(ROOT, '.env');
const envText = readFileSync(existsSync(localEnv) ? localEnv : rootEnv, 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)/);
  if (m) process.env[m[1]] = m[2].trim();
}

const TABLE = process.env.DYNAMO_TABLE || 'EbonCrucible';
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

const SEASON_CONFIG = {
  PK: 'SYSTEM',
  SK: 'SEASON_CONFIG',
  seasonId: 'S1',
  seasonName: 'Season 1: The Crucible Awakens',
  tierCount: 50,
  active: true,
  startDate: new Date().toISOString(),
  endDate: null,
  rewards: [
    // Tier 1-10: Common + first Rare
    { tier: 1, type: 'coins', amount: 50, rarity: 'common' },
    { tier: 2, type: 'title', itemId: 'bp_s1_title_initiate', name: 'Initiate', rarity: 'common' },
    { tier: 3, type: 'coins', amount: 75, rarity: 'common' },
    { tier: 4, type: 'portrait', itemId: 'bp_s1_portrait_ashen', name: 'Ashen Gaze', rarity: 'common', portraitFilter: 'brightness(0.85) saturate(0.3) contrast(1.2)' },
    { tier: 5, type: 'coins', amount: 100, rarity: 'common' },
    { tier: 6, type: 'frame', itemId: 'bp_s1_frame_iron', name: 'Crucible Iron', rarity: 'common' },
    { tier: 7, type: 'coins', amount: 75, rarity: 'common' },
    { tier: 8, type: 'portrait', itemId: 'bp_s1_portrait_ember', name: 'Ember Eyes', rarity: 'common', portraitFilter: 'brightness(1.1) saturate(1.4) sepia(0.2) hue-rotate(-10deg)' },
    { tier: 9, type: 'coins', amount: 100, rarity: 'common' },
    { tier: 10, type: 'frame', itemId: 'bp_s1_frame_bloodforge', name: 'Bloodforge', rarity: 'rare' },

    // Tier 11-20: Rare + first Epic
    { tier: 11, type: 'coins', amount: 100, rarity: 'common' },
    { tier: 12, type: 'title', itemId: 'bp_s1_title_forged', name: 'Crucible-Forged', rarity: 'rare' },
    { tier: 13, type: 'coins', amount: 125, rarity: 'common' },
    { tier: 14, type: 'portrait', itemId: 'bp_s1_portrait_crimson', name: 'Crimson Veil', rarity: 'rare', portraitFilter: 'brightness(0.9) saturate(1.5) hue-rotate(-20deg) contrast(1.15)' },
    { tier: 15, type: 'frame', itemId: 'bp_s1_frame_thorns', name: 'Soul Thorns', rarity: 'rare' },
    { tier: 16, type: 'coins', amount: 125, rarity: 'common' },
    { tier: 17, type: 'portrait', itemId: 'bp_s1_portrait_wraith', name: 'Wraithborn', rarity: 'rare', portraitFilter: 'brightness(0.8) saturate(0.2) contrast(1.3) hue-rotate(180deg)' },
    { tier: 18, type: 'coins', amount: 150, rarity: 'common' },
    { tier: 19, type: 'title', itemId: 'bp_s1_title_hardened', name: 'Battle-Hardened', rarity: 'rare' },
    { tier: 20, type: 'frame', itemId: 'bp_s1_frame_doomweaver', name: 'Doomweaver', rarity: 'epic' },

    // Tier 21-30: Epic
    { tier: 21, type: 'coins', amount: 150, rarity: 'common' },
    { tier: 22, type: 'coins', amount: 200, rarity: 'rare' },
    { tier: 23, type: 'portrait', itemId: 'bp_s1_portrait_void', name: 'Void-Touched', rarity: 'epic', portraitFilter: 'brightness(0.7) saturate(0.8) contrast(1.4) hue-rotate(260deg)' },
    { tier: 24, type: 'coins', amount: 200, rarity: 'rare' },
    { tier: 25, type: 'frame', itemId: 'bp_s1_frame_obsidian', name: 'Obsidian Crown', rarity: 'epic' },
    { tier: 26, type: 'coins', amount: 175, rarity: 'common' },
    { tier: 27, type: 'title', itemId: 'bp_s1_title_dread', name: 'Dreadforged', rarity: 'epic' },
    { tier: 28, type: 'coins', amount: 200, rarity: 'rare' },
    { tier: 29, type: 'portrait', itemId: 'bp_s1_portrait_hellfire', name: 'Hellfire Visage', rarity: 'epic', portraitFilter: 'brightness(1.0) saturate(2.0) hue-rotate(-30deg) contrast(1.3)' },
    { tier: 30, type: 'frame', itemId: 'bp_s1_frame_abyssal', name: 'Abyssal Gate', rarity: 'epic' },

    // Tier 31-40: Epic + first Legendary
    { tier: 31, type: 'coins', amount: 200, rarity: 'common' },
    { tier: 32, type: 'coins', amount: 250, rarity: 'rare' },
    { tier: 33, type: 'portrait', itemId: 'bp_s1_portrait_spectral', name: 'Spectral Sovereign', rarity: 'epic', portraitFilter: 'brightness(1.2) saturate(0.1) contrast(1.5) hue-rotate(200deg)' },
    { tier: 34, type: 'coins', amount: 250, rarity: 'rare' },
    { tier: 35, type: 'frame', itemId: 'bp_s1_frame_soulflame', name: 'Soulflame', rarity: 'epic' },
    { tier: 36, type: 'coins', amount: 250, rarity: 'common' },
    { tier: 37, type: 'title', itemId: 'bp_s1_title_warden', name: 'Crucible Warden', rarity: 'epic' },
    { tier: 38, type: 'coins', amount: 300, rarity: 'rare' },
    { tier: 39, type: 'portrait', itemId: 'bp_s1_portrait_fury', name: 'Ascendant Fury', rarity: 'epic', portraitFilter: 'brightness(1.15) saturate(1.8) contrast(1.2) hue-rotate(30deg)' },
    { tier: 40, type: 'frame', itemId: 'bp_s1_frame_diadem', name: 'Ebon Diadem', rarity: 'legendary' },

    // Tier 41-50: Legendary capstone
    { tier: 41, type: 'coins', amount: 300, rarity: 'rare' },
    { tier: 42, type: 'coins', amount: 350, rarity: 'epic' },
    { tier: 43, type: 'portrait', itemId: 'bp_s1_portrait_chosen', name: "The Crucible's Chosen", rarity: 'legendary', portraitFilter: 'brightness(1.3) saturate(1.6) contrast(1.1) sepia(0.3) hue-rotate(10deg)' },
    { tier: 44, type: 'coins', amount: 350, rarity: 'epic' },
    { tier: 45, type: 'title', itemId: 'bp_s1_title_ascendant', name: 'Ebon Ascendant', rarity: 'legendary' },
    { tier: 46, type: 'coins', amount: 400, rarity: 'rare' },
    { tier: 47, type: 'frame', itemId: 'bp_s1_frame_eternal', name: 'Crucible Eternal', rarity: 'legendary' },
    { tier: 48, type: 'coins', amount: 500, rarity: 'epic' },
    { tier: 49, type: 'portrait', itemId: 'bp_s1_portrait_incarnate', name: 'Crucible Incarnate', rarity: 'legendary', portraitFilter: 'brightness(1.0) saturate(2.5) contrast(1.4) hue-rotate(-15deg) drop-shadow(0 0 8px rgba(200,168,96,0.6))' },
    { tier: 50, type: 'multi', tier: 50, rarity: 'legendary', rewards: [
      { type: 'frame', itemId: 'bp_s1_frame_crown', name: 'The Ebon Crown', rarity: 'legendary' },
      { type: 'title', itemId: 'bp_s1_title_conqueror', name: 'Season 1 Conqueror', rarity: 'legendary' },
    ]},
  ],
  createdAt: new Date().toISOString(),
};

console.log('Seeding Season 1 Battle Pass config...');
console.log(`  Season: ${SEASON_CONFIG.seasonName}`);
console.log(`  Tiers: ${SEASON_CONFIG.tierCount}`);
console.log(`  Rewards: ${SEASON_CONFIG.rewards.length} entries`);

await client.send(new PutCommand({
  TableName: TABLE,
  Item: SEASON_CONFIG,
}));

console.log('Done! Season 1 config saved to DynamoDB.');
