/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Route distance accounting. Movement totals are reported for the preview;
 * enforcing turn resources belongs to a separate application, so there is no
 * multiplier, budget clamp, or narrow-section surcharge here.
 */

import { distance } from "./vec.mjs";

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {object} PathSegment
 * @property {Point} a
 * @property {Point} b
 * @property {number} distancePx
 * @property {number} distance Scene units.
 * @property {number} cost Scene units (always equal to `distance`).
 */

/**
 * Build segments from a polyline.
 *
 * @param {Point[]} points
 * @param {object} [options]
 * @param {number} [options.unitsPerPixel] Scene units represented by one pixel.
 * @returns {PathSegment[]}
 */
export function buildSegments(points, { unitsPerPixel = 1 } = {}) {
  const factor = Number(unitsPerPixel) > 0 ? Number(unitsPerPixel) : 1;
  if (!Array.isArray(points) || points.length < 2) return [];

  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const distancePx = distance(a, b);
    if (distancePx < 1e-6) continue;
    const sceneDistance = distancePx * factor;
    segments.push({
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      distancePx,
      distance: sceneDistance,
      cost: sceneDistance
    });
  }
  return segments;
}

/**
 * Totals for a set of segments.
 * @param {PathSegment[]} segments
 * @returns {{distance: number, cost: number}}
 */
export function summarizeSegments(segments) {
  let distance = 0;
  for (const segment of segments ?? []) {
    distance += Number(segment?.distance) || 0;
  }
  return { distance, cost: distance };
}
