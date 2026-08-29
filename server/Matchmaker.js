export class Matchmaker {
  constructor() {
    this.queue = new Map(); // cognitoSub -> { ws, classId, elo, username, queuedAt }
    this.matchInterval = null;
    this.onMatch = null; // callback: (playerA, subA, playerB, subB) => void
  }

  start() {
    this.matchInterval = setInterval(() => this.processQueue(), 2000);
    console.log('[Matchmaker] Started (2s scan interval)');
  }

  addToQueue(sub, ws, classId, elo, username, currentStreak = 0, activeFrame = null, activeTitle = null, activeSkin = null) {
    this.queue.delete(sub);
    this.queue.set(sub, { ws, classId, elo, username, currentStreak, activeFrame, activeTitle, activeSkin, queuedAt: Date.now() });
    ws.send(JSON.stringify({ type: 'queue_update', position: this.queue.size, status: 'queued' }));
    console.log(`[Matchmaker] ${username} (${elo}) queued as ${classId}. Queue size: ${this.queue.size}`);
  }

  removeFromQueue(sub) {
    const entry = this.queue.get(sub);
    if (entry) {
      this.queue.delete(sub);
      console.log(`[Matchmaker] ${entry.username} left queue. Queue size: ${this.queue.size}`);
    }
  }

  processQueue() {
    if (this.queue.size < 2) return;

    const entries = [...this.queue.entries()].sort((a, b) => a[1].elo - b[1].elo);
    const matched = new Set();

    for (let i = 0; i < entries.length - 1; i++) {
      if (matched.has(entries[i][0])) continue;

      const [subA, dataA] = entries[i];
      const waitTimeA = (Date.now() - dataA.queuedAt) / 1000;
      const rangeA = Math.min(200 + Math.floor(waitTimeA / 5) * 100, 800);

      for (let j = i + 1; j < entries.length; j++) {
        if (matched.has(entries[j][0])) continue;

        const [subB, dataB] = entries[j];
        const waitTimeB = (Date.now() - dataB.queuedAt) / 1000;
        const rangeB = Math.min(200 + Math.floor(waitTimeB / 5) * 100, 800);

        const eloDiff = Math.abs(dataA.elo - dataB.elo);
        if (eloDiff <= Math.max(rangeA, rangeB)) {
          matched.add(subA);
          matched.add(subB);
          this.queue.delete(subA);
          this.queue.delete(subB);

          console.log(`[Matchmaker] Matched ${dataA.username} (${dataA.elo}) vs ${dataB.username} (${dataB.elo}) — diff ${eloDiff}`);

          if (this.onMatch) {
            this.onMatch(dataA, subA, dataB, subB);
          }
          break;
        }
      }
    }
  }

  getQueueSize() {
    return this.queue.size;
  }

  stop() {
    if (this.matchInterval) {
      clearInterval(this.matchInterval);
      this.matchInterval = null;
    }
  }
}

/**
 * TeamMatchmaker — 2v2 matchmaking.
 * Supports solo queue (pairs 4 randoms) and duo queue (pairs 2 pre-formed duos).
 * Uses average team ELO for matchmaking range.
 */
export class TeamMatchmaker {
  constructor() {
    this.soloQueue = new Map();  // sub -> { ws, classId, elo, username, ... }
    this.duoQueue = new Map();   // leaderSub -> { players: [p0, p1], avgElo, queuedAt }
    this.matchInterval = null;
    this.onMatch = null; // callback: (team0, team1) => void
    // team0/team1 = [{ sub, ws, classId, elo, username, currentStreak, activeFrame }]
  }

  start() {
    this.matchInterval = setInterval(() => this.processQueue(), 2000);
    console.log('[TeamMatchmaker] Started (2s scan interval)');
  }

  addSoloToQueue(sub, ws, classId, elo, username, currentStreak = 0, activeFrame = null, activeTitle = null) {
    this.soloQueue.delete(sub);
    this.soloQueue.set(sub, { sub, ws, classId, elo, username, currentStreak, activeFrame, activeTitle, queuedAt: Date.now() });
    ws.send(JSON.stringify({ type: 'queue_update', position: this.soloQueue.size + this.duoQueue.size, status: 'queued_2v2' }));
    console.log(`[TeamMatchmaker] ${username} (${elo}) solo queued as ${classId}. Solo: ${this.soloQueue.size}, Duo: ${this.duoQueue.size}`);
  }

  addDuoToQueue(leaderSub, players) {
    // players = [{ sub, ws, classId, elo, username, currentStreak, activeFrame }, ...]
    this.duoQueue.delete(leaderSub);
    const avgElo = players.reduce((s, p) => s + p.elo, 0) / players.length;
    this.duoQueue.set(leaderSub, { players, avgElo, queuedAt: Date.now() });
    for (const p of players) {
      p.ws.send(JSON.stringify({ type: 'queue_update', position: this.soloQueue.size + this.duoQueue.size, status: 'queued_2v2_duo' }));
    }
    console.log(`[TeamMatchmaker] Duo queued: ${players.map(p => p.username).join(' + ')} (avg ${Math.round(avgElo)}). Solo: ${this.soloQueue.size}, Duo: ${this.duoQueue.size}`);
  }

  removeFromQueue(sub) {
    if (this.soloQueue.has(sub)) {
      const entry = this.soloQueue.get(sub);
      this.soloQueue.delete(sub);
      console.log(`[TeamMatchmaker] ${entry.username} left solo queue`);
      return;
    }
    // Check if sub is in any duo
    for (const [leaderSub, duo] of this.duoQueue) {
      if (duo.players.some(p => p.sub === sub)) {
        this.duoQueue.delete(leaderSub);
        console.log(`[TeamMatchmaker] Duo ${leaderSub} removed (member left)`);
        // Notify other player
        for (const p of duo.players) {
          if (p.sub !== sub && p.ws?.readyState === 1) {
            p.ws.send(JSON.stringify({ type: 'queue_cancelled', reason: 'partner_left' }));
          }
        }
        return;
      }
    }
  }

  processQueue() {
    // Priority 1: Match two duos
    if (this.duoQueue.size >= 2) {
      const duos = [...this.duoQueue.entries()].sort((a, b) => a[1].avgElo - b[1].avgElo);
      for (let i = 0; i < duos.length - 1; i++) {
        const [leaderA, duoA] = duos[i];
        const waitA = (Date.now() - duoA.queuedAt) / 1000;
        const rangeA = Math.min(100 + Math.floor(waitA / 10) * 50, 500);

        for (let j = i + 1; j < duos.length; j++) {
          const [leaderB, duoB] = duos[j];
          const waitB = (Date.now() - duoB.queuedAt) / 1000;
          const rangeB = Math.min(100 + Math.floor(waitB / 10) * 50, 500);
          const diff = Math.abs(duoA.avgElo - duoB.avgElo);
          if (diff <= Math.max(rangeA, rangeB)) {
            this.duoQueue.delete(leaderA);
            this.duoQueue.delete(leaderB);
            console.log(`[TeamMatchmaker] Duo vs Duo: ${duoA.players.map(p => p.username).join('+')} vs ${duoB.players.map(p => p.username).join('+')}`);
            if (this.onMatch) this.onMatch(duoA.players, duoB.players);
            return;
          }
        }
      }
    }

    // Priority 2: Match duo vs 2 solos
    if (this.duoQueue.size >= 1 && this.soloQueue.size >= 2) {
      const duos = [...this.duoQueue.entries()].sort((a, b) => a[1].avgElo - b[1].avgElo);
      const solos = [...this.soloQueue.entries()].sort((a, b) => a[1].elo - b[1].elo);
      for (const [leaderSub, duo] of duos) {
        const waitDuo = (Date.now() - duo.queuedAt) / 1000;
        const rangeDuo = Math.min(100 + Math.floor(waitDuo / 10) * 50, 500);
        // Find 2 solos close in ELO to form a team
        for (let i = 0; i < solos.length - 1; i++) {
          const [subA, soloA] = solos[i];
          for (let j = i + 1; j < solos.length; j++) {
            const [subB, soloB] = solos[j];
            const soloAvg = (soloA.elo + soloB.elo) / 2;
            const diff = Math.abs(duo.avgElo - soloAvg);
            const waitSolo = Math.max((Date.now() - soloA.queuedAt) / 1000, (Date.now() - soloB.queuedAt) / 1000);
            const rangeSolo = Math.min(100 + Math.floor(waitSolo / 10) * 50, 500);
            if (diff <= Math.max(rangeDuo, rangeSolo)) {
              this.duoQueue.delete(leaderSub);
              this.soloQueue.delete(subA);
              this.soloQueue.delete(subB);
              const soloTeam = [soloA, soloB];
              console.log(`[TeamMatchmaker] Duo vs Solos: ${duo.players.map(p => p.username).join('+')} vs ${soloA.username}+${soloB.username}`);
              if (this.onMatch) this.onMatch(duo.players, soloTeam);
              return;
            }
          }
        }
      }
    }

    // Priority 3: Match 4 solos
    if (this.soloQueue.size >= 4) {
      const solos = [...this.soloQueue.entries()].sort((a, b) => a[1].elo - b[1].elo);
      // Take 4 closest-ELO solos, split into balanced teams
      for (let i = 0; i < solos.length - 3; i++) {
        const group = solos.slice(i, i + 4);
        const waitMax = Math.max(...group.map(([, d]) => (Date.now() - d.queuedAt) / 1000));
        const range = Math.min(100 + Math.floor(waitMax / 10) * 50, 500);
        const eloSpread = group[3][1].elo - group[0][1].elo;
        if (eloSpread <= range) {
          for (const [sub] of group) this.soloQueue.delete(sub);
          // Balance: 1st+4th vs 2nd+3rd (snake draft by ELO)
          const team0 = [group[0][1], group[3][1]];
          const team1 = [group[1][1], group[2][1]];
          console.log(`[TeamMatchmaker] 4 Solos: ${team0.map(p => p.username).join('+')} vs ${team1.map(p => p.username).join('+')}`);
          if (this.onMatch) this.onMatch(team0, team1);
          return;
        }
      }
    }
  }

  getQueueSize() {
    return this.soloQueue.size + this.duoQueue.size * 2;
  }

  stop() {
    if (this.matchInterval) {
      clearInterval(this.matchInterval);
      this.matchInterval = null;
    }
  }
}
