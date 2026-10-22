/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Geometry primitives used by the pathfinder and collision engine.
 * Pure functions, no Foundry dependencies.
 *
 * @typedef {{x: number, y: number}} Point
 * @typedef {{a: Point, b: Point}} Segment
 * @typedef {{minX: number, minY: number, maxX: number, maxY: number}} Bounds
 */

const EPSILON = 1e-9;

/** @param {number} value @param {number} min @param {number} max */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Squared distance from a point to a segment.
 * @param {Point} point
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
export function pointSegmentDistanceSq(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPSILON) {
    const px = point.x - a.x;
    const py = point.y - a.y;
    return px * px + py * py;
  }
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq, 0, 1);
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const px = point.x - cx;
  const py = point.y - cy;
  return px * px + py * py;
}

/**
 * Distance from a point to a segment.
 * @param {Point} point
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
export function pointSegmentDistance(point, a, b) {
  return Math.sqrt(pointSegmentDistanceSq(point, a, b));
}

/** @param {Point} a @param {Point} b @param {Point} c @returns {number} */
function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** @param {Point} a @param {Point} b @param {Point} c @param {number} [epsilon] @returns {boolean} */
function onSegment(a, b, c, epsilon = 1e-7) {
  return (
    Math.min(a.x, b.x) - epsilon <= c.x &&
    c.x <= Math.max(a.x, b.x) + epsilon &&
    Math.min(a.y, b.y) - epsilon <= c.y &&
    c.y <= Math.max(a.y, b.y) + epsilon
  );
}

/**
 * Whether two segments intersect or touch. Collinear overlaps count.
 * @param {Point} a1 @param {Point} a2 @param {Point} b1 @param {Point} b2
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function segmentsIntersect(a1, a2, b1, b2, epsilon = 1e-7) {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (Math.abs(o1) <= epsilon && onSegment(a1, a2, b1, epsilon)) return true;
  if (Math.abs(o2) <= epsilon && onSegment(a1, a2, b2, epsilon)) return true;
  if (Math.abs(o3) <= epsilon && onSegment(b1, b2, a1, epsilon)) return true;
  if (Math.abs(o4) <= epsilon && onSegment(b1, b2, a2, epsilon)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/**
 * Minimum distance between two segments. Zero when they cross.
 * @param {Point} a1 @param {Point} a2 @param {Point} b1 @param {Point} b2
 * @returns {number}
 */
export function segmentSegmentDistance(a1, a2, b1, b2) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.sqrt(
    Math.min(
      pointSegmentDistanceSq(a1, b1, b2),
      pointSegmentDistanceSq(a2, b1, b2),
      pointSegmentDistanceSq(b1, a1, a2),
      pointSegmentDistanceSq(b2, a1, a2)
    )
  );
}

/**
 * Total length of an open polyline.
 * @param {Point[]} points
 * @returns {number}
 */
export function polylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

/**
 * Point at a given distance along a polyline.
 * @param {Point[]} points
 * @param {number} distanceAlong
 * @returns {{point: Point, segmentIndex: number, t: number, distance: number} | null}
 */
export function pointAtDistance(points, distanceAlong) {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return { point: { ...points[0] }, segmentIndex: 0, t: 0, distance: 0 };
  }
  let remaining = Math.max(0, distanceAlong);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= segmentLength || index === points.length - 1) {
      const t = segmentLength < EPSILON ? 0 : clamp(remaining / segmentLength, 0, 1);
      return {
        point: { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t },
        segmentIndex: index - 1,
        t,
        distance: Math.min(distanceAlong, polylineLength(points))
      };
    }
    remaining -= segmentLength;
  }
  return {
    point: { ...points[points.length - 1] },
    segmentIndex: points.length - 2,
    t: 1,
    distance: polylineLength(points)
  };
}

/**
 * Uniformly sample a polyline, always including both endpoints.
 * @param {Point[]} points
 * @param {number} step Maximum spacing in pixels.
 * @returns {Array<{x: number, y: number, distance: number, segmentIndex: number}>}
 */
export function samplePolyline(points, step) {
  const samples = [];
  if (points.length === 0) return samples;
  if (points.length === 1) return [{ ...points[0], distance: 0, segmentIndex: 0 }];

  const safeStep = Math.max(0.5, step);
  let travelled = 0;
  samples.push({ ...points[0], distance: 0, segmentIndex: 0 });

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (segmentLength < EPSILON) continue;
    const divisions = Math.max(1, Math.ceil(segmentLength / safeStep));
    for (let division = 1; division <= divisions; division += 1) {
      const t = division / divisions;
      samples.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        distance: travelled + segmentLength * t,
        segmentIndex: index - 1
      });
    }
    travelled += segmentLength;
  }

  return samples;
}

/**
 * First parameter t in [0, 1] where a moving circle contacts a static circle,
 * traveling from a to b. Returns 0 if already touching or overlapping at a.
 * @param {Point} a @param {Point} b @param {Point} center @param {number} radius
 * @returns {number | null}
 */
export function firstCircleContactOnSegment(a, b, center, radius) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;

  const quadA = dx * dx + dy * dy;
  if (quadA < EPSILON) return null;
  const quadB = 2 * (fx * dx + fy * dy);
  const discriminant = quadB * quadB - 4 * quadA * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const t1 = (-quadB - root) / (2 * quadA);
  const t2 = (-quadB + root) / (2 * quadA);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

/**
 * Whether a circle overlaps a segment.
 * @param {Point} center @param {number} radius @param {Point} a @param {Point} b
 * @returns {boolean}
 */
export function circleOverlapsSegment(center, radius, a, b) {
  return pointSegmentDistanceSq(center, a, b) < radius * radius;
}

/**
 * Truncate a polyline at a given distance, interpolating the final point.
 * @param {Point[]} points
 * @param {number} maxDistance
 * @returns {Point[]}
 */
export function truncatePolyline(points, maxDistance) {
  if (!points?.length) return [];
  if (maxDistance <= 0) return [{ ...points[0] }];

  const result = [{ ...points[0] }];
  let travelled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (segmentLength < EPSILON) continue;

    if (travelled + segmentLength >= maxDistance) {
      const t = clamp((maxDistance - travelled) / segmentLength, 0, 1);
      result.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      });
      return result;
    }

    result.push({ ...end });
    travelled += segmentLength;
  }

  return result;
}

/**
 * Bounding box of points.
 * @param {Point[]} points
 * @returns {Bounds}
 */
export function boundsOfPoints(points) {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Expand a bounding box on all sides.
 * @param {Bounds} bounds @param {number} margin
 * @returns {Bounds}
 */
export function expandBounds(bounds, margin) {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin
  };
}

/**
 * Grow a bounds rectangle by a radius on all sides.
 * @param {Bounds} bounds @param {number} radius
 * @returns {Bounds}
 */
export function inflateBounds(bounds, radius) {
  return expandBounds(bounds, radius);
}

/** @param {Bounds} bounds @param {Point} point @param {number} [tolerance] */
export function boundsContainsPoint(bounds, point, tolerance = 0) {
  return (
    point.x >= bounds.minX - tolerance &&
    point.x <= bounds.maxX + tolerance &&
    point.y >= bounds.minY - tolerance &&
    point.y <= bounds.maxY + tolerance
  );
}

/** @param {Bounds} a @param {Bounds} b */
export function boundsIntersect(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/**
 * Signed shortest angular difference from one angle to another, in (-PI, PI].
 * @param {number} from @param {number} to
 * @returns {number}
 */
export function angleDelta(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Whether two circles overlap (touching counts as overlap within tolerance).
 * @param {Point} a @param {number} ra @param {Point} b @param {number} rb
 * @param {number} [tolerance]
 */
export function circlesOverlap(a, ra, b, rb, tolerance = 0) {
  return Math.hypot(a.x - b.x, a.y - b.y) < ra + rb - tolerance;
}
