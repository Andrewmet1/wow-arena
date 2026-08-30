#!/usr/bin/env node
// Prints every file under src/ that the server transitively imports.
//
// The deploy script used to carry a hardcoded list of three engine files, so
// src/classes/* was never shipped. Production drifted three weeks behind the
// client: abilities the client rendered as cones and AoE still resolved as
// single-target server-side. Computing the set from the actual import graph
// means the list cannot silently fall out of date again.
import fs from 'fs';
import path from 'path';

const ENTRIES = ['server/GameRoom.js', 'server/index.js', 'server/db.js',
                 'server/challenges.js', 'server/elo.js', 'server/Matchmaker.js'];
const seen = new Set();
const need = new Set();
const queue = [...ENTRIES];

while (queue.length) {
  const f = queue.pop();
  if (seen.has(f) || !fs.existsSync(f)) continue;
  seen.add(f);
  const src = fs.readFileSync(f, 'utf-8');
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const p = path.normalize(path.join(path.dirname(f), spec));
    if (p.startsWith('src/')) need.add(p);
    queue.push(p);
  }
}
console.log([...need].sort().join('\n'));
