// Seeded PRNG using xorshift128+
export class SeededRandom {
  constructor(seed = Date.now()) {
    this.s0 = seed >>> 0;
    this.s1 = (seed * 1103515245 + 12345) >>> 0;
    if (this.s0 === 0) this.s0 = 1;
    if (this.s1 === 0) this.s1 = 1;
    // Warm up
    for (let i = 0; i < 20; i++) this._next();
  }

  _next() {
    let s1 = this.s0;
    const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23;
    s1 ^= s1 >>> 17;
    s1 ^= s0;
    s1 ^= s0 >>> 26;
    this.s1 = s1;
    return (this.s0 + this.s1) >>> 0;
  }

  // Returns float in [0, 1)
  next() {
    return this._next() / 4294967296;
  }

  // Returns true with given probability
  chance(probability) {
    return this.next() < probability;
  }

  // Returns float in [min, max)
  range(min, max) {
    return min + this.next() * (max - min);
  }

  // Returns integer in [min, max] inclusive
  intRange(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  // Pick random element from array
  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  // Shuffle array in place (Fisher-Yates)
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // Gaussian distribution (Box-Muller)
  gaussian(mean = 0, stddev = 1) {
    const u1 = this.next();
    const u2 = this.next();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * stddev + mean;
  }
}
