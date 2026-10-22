/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Movement planner: one call produces a complete plan for a drag frame. The
 * token keeps its full body radius along ordinary walls. Openings use the
 * caller's passage radius (by default 75% of the body radius), so a gap that
 * reaches the configured ratio is passable without letting the token clip
 * unrelated walls.
 */

import { findPath } from "./pathfinder.mjs";
import { buildSegments, summarizeSegments } from "./cost.mjs";
import { clampPolylineAtEnemies } from "./enemies.mjs";
import { polylineLength, truncatePolyline } from "./geometry.mjs";
import { distance } from "./vec.mjs";
import { CLEARANCE_EPSILON, PLAN_STATUS } from "../constants.mjs";

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {import("./walls.mjs").WallSegment} WallSegment
 * @typedef {import("./enemies.mjs").Enemy} Enemy
 */

/**
 * Plan a single movement.
 *
 * @param {object} options
 * @param {Point} options.start Drag origin in pixels.
 * @param {Point} options.goal Proposed destination in pixels.
 * @param {WallSegment[]} [options.walls] Blocking walls.
 * @param {number} options.radius Token body clearance radius in pixels.
 * @param {number} [options.passageRadius] Narrower radius allowed inside a gap.
 * @param {Enemy[]} [options.enemies] Eligible hostile enemies.
 * @param {number} [options.unitsPerPixel] Scene units per pixel.
 * @param {number} [options.maxDistance] Remaining scene units, when another module owns movement resources.
 * @param {number} [options.epsilon]
 * @param {number} [options.maxWalls]
 * @param {number} [options.maxWaypoints]
 * @returns {object}
 */
export function planMovement({
  start,
  goal,
  walls = [],
  radius,
  passageRadius = null,
  enemies = [],
  unitsPerPixel = 1,
  maxDistance = null,
  epsilon = CLEARANCE_EPSILON,
  maxWalls,
  maxWaypoints
}) {
  if (!isFinitePoint(start) || !isFinitePoint(goal)) {
    throw new TypeError("planMovement requires finite start and goal points");
  }

  const factor = Number(unitsPerPixel) > 0 ? Number(unitsPerPixel) : 1;
  const clearanceRadius = Math.max(0.5, Number(radius) || 0.5);
  const requestedPassage = Number(passageRadius);
  const gapRadius = Number.isFinite(requestedPassage) && requestedPassage > 0
    ? Math.max(0.5, Math.min(clearanceRadius, requestedPassage))
    : clearanceRadius;

  const path = findPath({
    start,
    goal,
    radius: clearanceRadius,
    passageRadius: gapRadius,
    walls,
    epsilon,
    maxWalls,
    maxWaypoints
  });

  const enemyClamp = clampPolylineAtEnemies(path.points, {
    movingRadius: clearanceRadius,
    enemies,
    epsilon
  });

  const route = limitRoute(enemyClamp.points, { maxDistance, unitsPerPixel: factor });
  const points = route.points;
  const contactReached = enemyClamp.contact
    && (!route.limited || enemyClamp.contact.distanceAlong * factor <= route.limit.distance + 1e-6);
  const contact = contactReached ? enemyClamp.contact : null;
  const segments = buildSegments(points, { unitsPerPixel: factor });
  const summary = summarizeSegments(segments);
  const endpoint = points[points.length - 1] ?? { ...start };
  const reachable = path.complete;
  const complete = reachable && !contact && !route.limited && distance(endpoint, goal) <= 0.5;

  let status = reachable ? PLAN_STATUS.normal : PLAN_STATUS.impassable;
  if (route.limited) status = PLAN_STATUS.limited;
  if (contact) status = PLAN_STATUS.contact;

  return {
    status,
    routeMode: route.limited ? PLAN_STATUS.limited : (reachable ? "normal" : "impassable"),
    complete,
    start: { ...start },
    goal: { ...goal },
    points,
    segments,
    reachable,
    contact,
    endpoint,
    totalDistance: summary.distance,
    totalCost: summary.cost,
    physicalDistancePx: polylineLength(points),
    unitsPerPixel: factor,
    radius: clearanceRadius,
    passageRadius: gapRadius,
    movementLimit: route.limit,
    debug: {
      visited: path.visited,
      waypoints: path.waypoints,
      prunedWalls: path.prunedWalls
    }
  };
}

/**
 * Trim a route to an externally owned movement budget. The route is compared
 * in scene units, so the caller's budget (for example the remaining movement
 * reported by dnd5e-movement-limiter) does not have to know about pixels.
 *
 * @param {Point[]} points
 * @param {object} [options]
 * @param {number | null} [options.maxDistance] Scene units, or null/Infinity for no limit.
 * @param {number} [options.unitsPerPixel]
 * @returns {{points: Point[], limited: boolean, limit: object | null}}
 */
export function limitRoute(points, { maxDistance = null, unitsPerPixel = 1 } = {}) {
  const route = Array.isArray(points) ? points : [];
  const factor = Number(unitsPerPixel) > 0 ? Number(unitsPerPixel) : 1;
  const budget = Number(maxDistance);
  const hasLimit = maxDistance != null && Number.isFinite(budget) && budget >= 0;
  if (!hasLimit) {
    return { points: route, limited: false, limit: null };
  }

  const maximumPx = budget / factor;
  const availablePx = polylineLength(route);
  const limited = availablePx > maximumPx + 1e-6;
  const limitedPoints = limited ? truncatePolyline(route, maximumPx) : route;
  const distanceTravelled = polylineLength(limitedPoints) * factor;

  return {
    points: limitedPoints,
    limited,
    limit: {
      remaining: Math.max(0, budget),
      distance: distanceTravelled,
      remainingAfter: Math.max(0, budget - distanceTravelled),
      exhausted: limited,
      source: "external"
    }
  };
}

/** @param {Point} point */
function isFinitePoint(point) {
  return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
}
