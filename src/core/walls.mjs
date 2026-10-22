/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Wall geometry: normalize Foundry wall data into blocking segments and provide
 * clearance tests. Pure functions; the Foundry adapter supplies enum values.
 *
 * @typedef {{x: number, y: number}} Point
 * @typedef {{id: string, a: Point, b: Point, bbox: {minX: number, minY: number, maxX: number, maxY: number}}} WallSegment
 */

import { pointSegmentDistance, segmentSegmentDistance, boundsOfPoints, boundsIntersect } from "./geometry.mjs";
import { WALL_DOOR, WALL_DOOR_STATE, WALL_MOVEMENT } from "../constants.mjs";

/**
 * @typedef {object} WallEnums
 * @property {{none: number, normal: number, double: number, limited: number}} [movement]
 * @property {{none: number, door: number, secret: number}} [door]
 * @property {{closed: number, open: number, locked: number}} [doorState]
 */

function makeBbox(a, b) {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y)
  };
}

/**
 * Normalize a wall document or already-normalized object.
 * Foundry uses `c: [x0, y0, x1, y1]`, `move`, `door`, `ds`, `dir`.
 * @param {object} wall
 * @param {WallEnums} [enums]
 * @returns {WallSegment | null}
 */
export function normalizeWall(wall, enums = {}) {
  if (!wall) return null;
  const movement = { ...WALL_MOVEMENT, ...(enums.movement ?? {}) };
  const door = { ...WALL_DOOR, ...(enums.door ?? {}) };
  const doorState = { ...WALL_DOOR_STATE, ...(enums.doorState ?? {}) };

  let a;
  let b;
  if (Array.isArray(wall.c) && wall.c.length === 4) {
    a = { x: Number(wall.c[0]), y: Number(wall.c[1]) };
    b = { x: Number(wall.c[2]), y: Number(wall.c[3]) };
  } else if (wall.a && wall.b) {
    a = { x: Number(wall.a.x), y: Number(wall.a.y) };
    b = { x: Number(wall.b.x), y: Number(wall.b.y) };
  } else if (Array.isArray(wall) && wall.length === 4) {
    a = { x: Number(wall[0]), y: Number(wall[1]) };
    b = { x: Number(wall[2]), y: Number(wall[3]) };
  } else {
    return null;
  }

  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return null;

  const move = Number(wall.move ?? movement.none);
  const doorType = Number(wall.door ?? door.none);
  const doorStatus = Number(wall.ds ?? doorState.closed);
  const dir = Number(wall.dir ?? 0);

  const isOpenDoor = doorType !== door.none && doorStatus === doorState.open;
  const blocks = move !== movement.none && !isOpenDoor;

  return {
    id: String(wall.id ?? wall._id ?? wall.document?.id ?? `${a.x},${a.y},${b.x},${b.y}`),
    a,
    b,
    move,
    door: doorType,
    ds: doorStatus,
    dir,
    blocks,
    bbox: makeBbox(a, b)
  };
}

/**
 * Extract only walls that block movement.
 * @param {object[]} walls
 * @param {WallEnums} [enums]
 * @returns {WallSegment[]}
 */
export function extractBlockingWalls(walls, enums = {}) {
  const result = [];
  const seen = new Set();
  for (const raw of walls ?? []) {
    const wall = normalizeWall(raw, enums);
    if (!wall?.blocks) continue;
    const key = wall.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(wall);
  }
  return result;
}

/**
 * Distance from a point to the nearest blocking wall.
 * @param {Point} point
 * @param {WallSegment[]} walls
 * @returns {number} Infinity when there are no walls.
 */
export function clearanceAtPoint(point, walls) {
  let minimum = Infinity;
  for (const wall of walls) {
    const distance = pointSegmentDistance(point, wall.a, wall.b);
    if (distance < minimum) minimum = distance;
  }
  return minimum;
}

/**
 * Exact minimum clearance between a path segment and the wall set.
 * @param {Point} a
 * @param {Point} b
 * @param {WallSegment[]} walls
 * @returns {number}
 */
export function segmentMinClearance(a, b, walls) {
  let minimum = Infinity;
  for (const wall of walls) {
    const distance = segmentSegmentDistance(a, b, wall.a, wall.b);
    if (distance < minimum) minimum = distance;
  }
  return minimum;
}

/**
 * Whether a segment keeps at least `radius` clearance from every wall.
 * Uses a cheap bounding-box reject before the exact segment test.
 * @param {Point} a
 * @param {Point} b
 * @param {number} radius
 * @param {WallSegment[]} walls
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function segmentClear(a, b, radius, walls, epsilon = 0.5) {
  const segmentBox = {
    minX: Math.min(a.x, b.x) - radius,
    minY: Math.min(a.y, b.y) - radius,
    maxX: Math.max(a.x, b.x) + radius,
    maxY: Math.max(a.y, b.y) + radius
  };
  const threshold = radius - epsilon;

  for (const wall of walls) {
    const box = wall.bbox ?? makeBbox(wall.a, wall.b);
    if (
      box.maxX < segmentBox.minX ||
      box.minX > segmentBox.maxX ||
      box.maxY < segmentBox.minY ||
      box.minY > segmentBox.maxY
    ) {
      continue;
    }
    if (segmentSegmentDistance(a, b, wall.a, wall.b) < threshold) return false;
  }
  return true;
}

/**
 * Remove walls whose bounds do not intersect the search area.
 * @param {WallSegment[]} walls
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds
 * @returns {WallSegment[]}
 */
export function filterWallsNear(walls, bounds) {
  return walls.filter((wall) => boundsIntersect(wall.bbox, bounds));
}

/**
 * Keep the walls closest to the start→goal line, preserving a deterministic order.
 * @param {WallSegment[]} walls
 * @param {Point} start
 * @param {Point} goal
 * @param {number} limit
 * @returns {WallSegment[]}
 */
export function nearestWalls(walls, start, goal, limit = 40) {
  if (walls.length <= limit) return walls;
  return walls
    .map((wall, index) => ({
      wall,
      index,
      distance: segmentSegmentDistance(start, goal, wall.a, wall.b)
    }))
    .sort((first, second) => first.distance - second.distance || first.index - second.index)
    .slice(0, limit)
    .map((entry) => entry.wall);
}

/**
 * Bounds covering a wall set.
 * @param {WallSegment[]} walls
 */
export function wallsBounds(walls) {
  if (walls.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const points = [];
  for (const wall of walls) points.push(wall.a, wall.b);
  return boundsOfPoints(points);
}
