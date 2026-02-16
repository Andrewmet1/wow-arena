export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone() {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v) {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v) {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  scale(s) {
    return new Vec3(this.x * s, this.y * s, this.z * s);
  }

  addInPlace(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  subInPlace(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scaleInPlace(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  // Horizontal distance (ignoring Y)
  distanceXZ(v) {
    const dx = this.x - v.x;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  distance(v) {
    return this.sub(v).length();
  }

  distanceSq(v) {
    return this.sub(v).lengthSq();
  }

  normalize() {
    const len = this.length();
    if (len === 0) return new Vec3();
    return this.scale(1 / len);
  }

  normalizeInPlace() {
    const len = this.length();
    if (len > 0) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v) {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  lerp(v, t) {
    return new Vec3(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t
    );
  }

  // Angle in radians on XZ plane from this toward v
  angleTo(v) {
    const dx = v.x - this.x;
    const dz = v.z - this.z;
    return Math.atan2(dx, dz);
  }

  // Direction unit vector on XZ plane from this toward v
  directionTo(v) {
    const dx = v.x - this.x;
    const dz = v.z - this.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) return new Vec3();
    return new Vec3(dx / len, 0, dz / len);
  }

  // Rotate around Y axis
  rotateY(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vec3(
      this.x * cos + this.z * sin,
      this.y,
      -this.x * sin + this.z * cos
    );
  }

  equals(v) {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }

  toArray() {
    return [this.x, this.y, this.z];
  }

  static fromArray(arr) {
    return new Vec3(arr[0], arr[1], arr[2]);
  }

  static zero() {
    return new Vec3(0, 0, 0);
  }

  static up() {
    return new Vec3(0, 1, 0);
  }
}
