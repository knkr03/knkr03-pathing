/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Minimal immutable vector helpers. All points are plain {x, y} objects in canvas pixels.
 */

const EPSILON = 1e-9;

/** @typedef {{x: number, y: number}} Point */

/** @returns {Point} */
export function vec(x = 0, y = 0) {
  return { x, y };
}

/** @param {Point} a @param {Point} b @returns {Point} */
export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** @param {Point} a @param {Point} b @returns {Point} */
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** @param {Point} a @param {number} scalar @returns {Point} */
export function scale(a, scalar) {
  return { x: a.x * scalar, y: a.y * scalar };
}

/** @param {Point} a @param {Point} b @returns {number} */
export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

/** @param {Point} a @returns {number} */
export function lengthSq(a) {
  return a.x * a.x + a.y * a.y;
}

/** @param {Point} a @returns {number} */
export function length(a) {
  return Math.hypot(a.x, a.y);
}

/** @param {Point} a @param {Point} b @returns {number} */
export function distanceSq(a, b) {
  return lengthSq(sub(a, b));
}

/** @param {Point} a @param {Point} b @returns {number} */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** @param {Point} a @returns {Point} */
export function normalize(a) {
  const len = length(a);
  return len < EPSILON ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Rotate 90 degrees counter-clockwise in screen coordinates. @param {Point} a @returns {Point} */
export function perpendicular(a) {
  return { x: -a.y, y: a.x };
}

/** @param {Point} a @param {number} radians @returns {Point} */
export function rotate(a, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: a.x * cos - a.y * sin, y: a.x * sin + a.y * cos };
}

/** @param {Point} a @param {Point} b @param {number} t @returns {Point} */
export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** @param {Point} a @returns {number} Angle in radians. */
export function angleOf(a) {
  return Math.atan2(a.y, a.x);
}

/** @param {number} radians @param {number} [radius] @returns {Point} */
export function fromAngle(radians, radius = 1) {
  return { x: Math.cos(radians) * radius, y: Math.sin(radians) * radius };
}

/** @param {Point} a @param {Point} b @param {number} [epsilon] @returns {boolean} */
export function equalsApprox(a, b, epsilon = EPSILON) {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}
