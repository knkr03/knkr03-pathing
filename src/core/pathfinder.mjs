/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Gridless pathfinding for a circular token footprint.
 *
 * Blocking walls are modeled as capsules (wall segment expanded by the token
 * radius). Candidate waypoints are generated around expanded wall endpoints,
 * connected by visibility, and searched with A*. Straight sections and the
 * result are smoothed greedily. The direct start→goal segment is tested first.
 *
 * @typedef {{x: number, y: number}} Point
 * @typedef {import("./walls.mjs").WallSegment} WallSegment
 */

import {
  boundsContainsPoint,
  boundsIntersect,
  boundsOfPoints,
  clamp,
  expandBounds,
  segmentsIntersect
} from "./geometry.mjs";
import { clearanceAtPoint, filterWallsNear, nearestWalls, segmentClear } from "./walls.mjs";
import { distance } from "./vec.mjs";
import { CLEARANCE_EPSILON } from "../constants.mjs";

const DEFAULT_MAX_WALLS = 32;
const DEFAULT_MAX_WAYPOINTS = 320;
const WAYPOINT_DIRECTIONS = 8;

/**
 * @param {object} options
 * @param {Point} options.start
 * @param {Point} options.goal
 * @param {number} options.radius Physical footprint radius in pixels.
 * @param {number} [options.passageRadius] Narrower radius allowed inside a gap.
 * @param {WallSegment[]} [options.walls]
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} [options.bounds]
 * @param {number} [options.maxWalls]
 * @param {number} [options.maxWaypoints]
 * @param {number} [options.epsilon]
 * @returns {{points: Point[], complete: boolean, visited: number, waypoints: number, prunedWalls: number}}
 */
export function findPath({
  start,
  goal,
  radius,
  passageRadius = null,
  walls = [],
  bounds = null,
  maxWalls = DEFAULT_MAX_WALLS,
  maxWaypoints = DEFAULT_MAX_WAYPOINTS,
  epsilon = CLEARANCE_EPSILON
}) {
  const startPoint = { x: start.x, y: start.y };
  const goalPoint = { x: goal.x, y: goal.y };
  const radiusValue = Math.max(0.5, Number(radius) || 0.5);
  const requestedPassage = Number(passageRadius);
  const passageValue = Number.isFinite(requestedPassage) && requestedPassage > 0
    ? Math.max(0.5, Math.min(radiusValue, requestedPassage))
    : radiusValue;
  const wallList = walls ?? [];

  if (distance(startPoint, goalPoint) < 1e-6) {
    return { points: [startPoint, goalPoint], complete: true, visited: 0, waypoints: 0, prunedWalls: 0 };
  }

  if (segmentClear(startPoint, goalPoint, radiusValue, wallList, epsilon)) {
    return {
      points: [startPoint, goalPoint],
      complete: true,
      visited: 0,
      waypoints: 0,
      prunedWalls: wallList.length
    };
  }

  // Expand the search region to include the endpoints of walls that block the
  // direct corridor. Otherwise a long barrier between start and goal would be
  // reported unreachable even though walking around its end is legal.
  const corridor = expandBounds(
    boundsOfPoints([startPoint, goalPoint]),
    Math.max(250, distance(startPoint, goalPoint) * 0.25) + radiusValue
  );
  const blockingNearCorridor = wallList.filter((wall) => boundsIntersect(wall.bbox, corridor));
  const anchors = [startPoint, goalPoint];
  for (const wall of blockingNearCorridor) anchors.push(wall.a, wall.b);
  const searchBounds = bounds
    ?? expandBounds(boundsOfPoints(anchors), Math.max(150, radiusValue * 2));

  // Collision tests use every wall near the search area, not just the subset
  // used to generate waypoints. A pruned wall must never be crossed silently.
  const collisionWalls = filterWallsNear(wallList, expandBounds(searchBounds, radiusValue + 1));
  const waypointWalls = nearestWalls(collisionWalls, startPoint, goalPoint, maxWalls);
  // Portal candidates need their attached jamb/return walls to be present so
  // those walls can be classified as hosts. Keep the candidate set bounded, but
  // wider than the ordinary endpoint-ring set.
  const passageWalls = nearestWalls(
    collisionWalls,
    startPoint,
    goalPoint,
    Math.max(maxWalls * 3, 96)
  );
  const generated = generateWaypoints(
    waypointWalls,
    passageWalls,
    radiusValue,
    passageValue,
    searchBounds,
    epsilon,
    collisionWalls
  );

  if (generated.length > maxWaypoints) {
    generated
      .map((node, index) => ({
        node,
        index,
        score: distance(startPoint, node.point) + distance(node.point, goalPoint)
      }))
      .sort((first, second) => first.score - second.score || first.index - second.index)
      .slice(0, maxWaypoints)
      .sort((first, second) => first.index - second.index)
      .forEach((entry, index) => {
        generated[index] = entry.node;
      });
    generated.length = Math.min(generated.length, maxWaypoints);
  }

  const nodes = [
    { point: startPoint },
    { point: goalPoint },
    ...generated
  ];
  const goalIndex = 1;
  const count = nodes.length;
  const gScore = new Float64Array(count).fill(Infinity);
  const cameFrom = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const heap = new MinHeap();

  gScore[0] = 0;
  heap.push(0, distance(startPoint, goalPoint));

  let reachedGoal = false;
  let visited = 0;

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current.index]) continue;
    closed[current.index] = 1;
    visited += 1;

    if (current.index === goalIndex) {
      reachedGoal = true;
      break;
    }

    for (let next = 0; next < count; next += 1) {
      if (next === current.index || closed[next]) continue;
      const from = nodes[current.index];
      const to = nodes[next];
      if (!edgeClear(from, to, radiusValue, passageValue, collisionWalls, epsilon)) continue;
      const tentative = gScore[current.index] + distance(from.point, to.point);
      if (tentative + 1e-9 < gScore[next]) {
        gScore[next] = tentative;
        cameFrom[next] = current.index;
        heap.push(next, tentative + distance(to.point, goalPoint));
      }
    }
  }

  if (reachedGoal) {
    const raw = reconstruct(cameFrom, goalIndex);
    return {
      points: smooth(raw.map((index) => nodes[index].point), radiusValue, collisionWalls, epsilon),
      complete: true,
      visited,
      waypoints: generated.length,
      prunedWalls: collisionWalls.length
    };
  }

  // No route: return the path to the reachable node that gets closest to the goal.
  let bestIndex = -1;
  let bestScore = Infinity;
  for (let index = 0; index < count; index += 1) {
    if (closed[index] && Number.isFinite(gScore[index])) {
      const score = gScore[index] + distance(nodes[index].point, goalPoint) * 1.0001;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }

  const partial = bestIndex > 0
    ? reconstruct(cameFrom, bestIndex).map((index) => nodes[index].point)
    : [startPoint];

  // A sealed room can leave every generated waypoint unreachable, and a partial
  // graph route can stop well short of the wall in front of the token. Continue
  // toward the cursor along the clearest straight line so the token still moves
  // as far as its body allows instead of staying at the drag origin.
  const extended = extendPartialRoute(partial, goalPoint, radiusValue, collisionWalls, epsilon);
  return {
    points: smooth(extended, radiusValue, collisionWalls, epsilon),
    complete: false,
    visited,
    waypoints: generated.length,
    prunedWalls: collisionWalls.length
  };
}

/**
 * Extend a partial route toward the goal while keeping full body clearance.
 * Returns a new array and never mutates the input.
 *
 * @param {Point[]} points
 * @param {Point} goal
 * @param {number} radius
 * @param {WallSegment[]} walls
 * @param {number} epsilon
 * @returns {Point[]}
 */
function extendPartialRoute(points, goal, radius, walls, epsilon) {
  const route = Array.isArray(points) ? points.map((point) => ({ ...point })) : [];
  const endpoint = route.at(-1);
  if (!endpoint) return route;

  const projected = farthestClearPoint(endpoint, goal, radius, walls, epsilon);
  if (projected && distance(endpoint, projected) > 0.5) route.push(projected);
  return route;
}

/**
 * Farthest point along start→goal that remains clear for the full body radius.
 * The result is the first obstacle contact, not a waypoint, so a token blocked
 * by a wall or a too-narrow opening still approaches it as closely as the
 * configured body clearance allows.
 *
 * @param {Point} start
 * @param {Point} goal
 * @param {number} radius
 * @param {WallSegment[]} walls
 * @param {number} epsilon
 * @returns {Point | null}
 */
function farthestClearPoint(start, goal, radius, walls, epsilon) {
  const total = distance(start, goal);
  if (total < 0.5) return null;
  if (clearanceAtPoint(start, walls) < radius - epsilon) return null;

  const at = (t) => ({
    x: start.x + (goal.x - start.x) * t,
    y: start.y + (goal.y - start.y) * t
  });

  if (segmentClear(start, goal, radius, walls, epsilon)) return { ...goal };

  // Clearance along a fixed ray is monotonic for capsule obstacles: once the
  // segment reaches a wall it cannot become clear again without turning. A
  // binary search therefore finds the contact point without sampling the wall
  // geometry.
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    const point = at(middle);
    if (
      segmentClear(start, point, radius, walls, epsilon)
      && clearanceAtPoint(point, walls) >= radius - epsilon
    ) {
      low = middle;
    } else {
      high = middle;
    }
  }

  if (low < 1e-4) return null;
  return at(low);
}

/**
 * Candidate waypoints around each expanded wall endpoint, plus portal nodes
 * for every opening the token can squeeze through.
 *
 * Endpoint rings alone only find gaps at particular approach angles. A portal
 * measures the real gap, ignores only the two walls that form it, and uses the
 * narrower gap radius for the crossing. Everywhere else the full physical
 * token radius still applies, so squeezing through a doorway does not let the
 * token clip unrelated walls.
 *
 * @param {WallSegment[]} walls
 * @param {number} radius Physical body radius in pixels.
 * @param {number} passageRadius Reduced radius used inside a gap.
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds
 * @param {number} epsilon
 * @returns {Array<{point: Point, portalId?: string, portalWalls?: WallSegment[]}>}
 */
function generateWaypoints(
  walls,
  passageWalls,
  radius,
  passageRadius,
  bounds,
  epsilon,
  collisionWalls = walls
) {
  const padding = Math.max(epsilon, 0.5) + 1;
  // Points exactly on the clearance circle cannot see each other: the chord
  // between two such points dips inside the capsule. A second, slightly wider
  // ring circumscribes the circle for the 8-way angular spacing, which lets the
  // graph round wall caps without cutting the corner. The tight ring is kept so
  // narrow passages still get usable waypoints.
  const tightOffset = radius + padding;
  const wideOffset = radius / Math.cos(Math.PI / WAYPOINT_DIRECTIONS) + padding;
  const offsets = [tightOffset, wideOffset];
  const candidates = [];
  const seen = new Set();

  const add = (point) => {
    const key = `${Math.round(point.x * 2)},${Math.round(point.y * 2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ point });
  };

  for (const wall of walls) {
    for (const endpoint of [wall.a, wall.b]) {
      for (const offset of offsets) {
        for (let direction = 0; direction < WAYPOINT_DIRECTIONS; direction += 1) {
          const angle = (Math.PI * 2 * direction) / WAYPOINT_DIRECTIONS;
          const point = {
            x: endpoint.x + Math.cos(angle) * offset,
            y: endpoint.y + Math.sin(angle) * offset
          };
          if (!boundsContainsPoint(bounds, point)) continue;
          if (clearanceAtPoint(point, collisionWalls) < radius - epsilon) continue;
          add(point);
        }
      }
    }
  }

  for (const node of generatePassageWaypoints(
    passageWalls,
    radius,
    passageRadius,
    bounds,
    epsilon,
    collisionWalls
  )) {
    candidates.push(node);
  }

  return candidates;
}

/**
 * Portal nodes for every opening at least `passageRadius * 2` wide.
 *
 * A portal contains the gap midpoint and lead points on each side along the
 * gap normal. Edges inside the portal use the reduced passage radius against
 * every wall, not only the two host walls. That keeps the squeeze valid when a
 * third wall forms the other side of a short corridor (a node-to-wall opening
 * often works this way). Start/goal points within the portal's local squeeze
 * zone can use the reduced radius on the connecting edge too.
 *
 * The gap is measured between the actual wall points. No waypoint offset is
 * subtracted from the opening.
 *
 * @param {WallSegment[]} walls
 * @param {number} radius Physical body radius in pixels.
 * @param {number} passageRadius Reduced radius used inside a gap.
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds
 * @param {number} epsilon
 * @param {WallSegment[]} collisionWalls
 * @returns {Array<{point: Point, portalId: string, portalCenter: Point, portalRadius: number}>}
 */
function generatePassageWaypoints(walls, radius, passageRadius, bounds, epsilon, collisionWalls) {
  const passageDiameter = passageRadius * 2;
  // Only tight openings need explicit guidance. Wider openings already have
  // endpoint-ring waypoints with enough room to turn.
  const maximumSpan = Math.max(passageDiameter * 2.5, 220);
  const padding = Math.max(epsilon, 0.5) + 1;
  const leadDistance = radius + padding;
  // Door jambs and wall returns can be deeper than one token radius. Carrying
  // the reduced-clearance portal one token-width beyond each side lets the
  // token finish leaving a short, narrow doorway instead of forcing full body
  // clearance while still between the jamb walls.
  const leadDistances = [leadDistance, leadDistance * 2];
  const zoneRadius = leadDistance * 2 + passageRadius + padding;
  const candidates = [];
  let portalCounter = 0;

  const endpoints = [];
  const endpointMap = new Map();
  for (const wall of walls) {
    for (const point of [wall.a, wall.b]) {
      const key = `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
      let entry = endpointMap.get(key);
      if (!entry) {
        entry = { point: { x: point.x, y: point.y }, wallIds: new Set() };
        endpointMap.set(key, entry);
        endpoints.push(entry);
      }
      entry.wallIds.add(wall.id);
    }
  }

  const crossesOtherWall = (a, b, hostIds) => {
    for (const wall of collisionWalls) {
      if (hostIds.has(wall.id)) continue;
      // Touching at an endpoint is normal: perpendicular jamb walls meet the
      // gap's host walls at exactly those points. Only a wall crossing the open
      // span, or ending inside it, actually closes the opening.
      if (segmentCrossesOpenSpan(a, b, wall)) return true;
    }
    return false;
  };

  // A real gap is empty between its two host walls. If the measured line runs
  // along a host wall, it is a wall length or a corner-to-far-end pair, not an
  // opening; ignoring that wall at the midpoint would tunnel through it.
  const overlapsHostWall = (a, b, hostWalls) => {
    for (let step = 1; step < 5; step += 1) {
      const t = step / 5;
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (clearanceAtPoint(point, hostWalls) <= Math.max(0.01, epsilon)) return true;
    }
    return false;
  };

  const addGap = (a, b, hostIds) => {
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    // Compare the real gap with the configured fraction of the token size.
    // The tolerance only absorbs floating-point noise from wall coordinates.
    if (gap > maximumSpan) return;

    // Include every wall attached at either gap endpoint, even one omitted by
    // the bounded portal-candidate set. Those are jamb/return walls, not walls
    // closing the opening.
    for (const wall of collisionWalls) {
      if (isSamePoint(wall.a, a) || isSamePoint(wall.b, a)
          || isSamePoint(wall.a, b) || isSamePoint(wall.b, b)) {
        hostIds.add(wall.id);
      }
    }
    if (crossesOtherWall(a, b, hostIds)) return;

    const hostWalls = collisionWalls.filter((wall) => hostIds.has(wall.id));
    if (overlapsHostWall(a, b, hostWalls)) return;

    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const nx = -(b.y - a.y) / gap;
    const ny = (b.x - a.x) / gap;
    const tooNarrow = gap + epsilon < passageDiameter;

    const leads = leadDistances.map((distance) => ({
      first: { x: mid.x + nx * distance, y: mid.y + ny * distance },
      second: { x: mid.x - nx * distance, y: mid.y - ny * distance }
    }));

    if (tooNarrow) {
      // Even when the token cannot cross here, the near-side approach point is
      // the furthest legal position. It is only useful if the full body fits
      // there; a reduced-radius approach would let the preview clip the jamb.
      for (const point of [leads[0].first, leads[0].second]) {
        if (!boundsContainsPoint(bounds, point, padding)) continue;
        if (clearanceAtPoint(point, collisionWalls) < radius - epsilon) continue;
        candidates.push({ point });
      }
      return;
    }

    // A squeeze corridor can be bounded by walls other than the two that form
    // the opening. Every portal node and the crossing line must fit at the
    // reduced radius against the complete wall set.
    if (clearanceAtPoint(mid, collisionWalls) < passageRadius - epsilon) return;

    // Validate leads independently. A short pocket or a return wall can make
    // the longer lead on one side unusable while the opening itself is still
    // passable. Rejecting the whole portal because one optional lead is inside
    // a wall is what previously forced tokens to stop at otherwise usable
    // gaps.
    const firstSide = [];
    const secondSide = [];
    for (const { first, second } of leads) {
      for (const point of [first, second]) {
        if (!boundsContainsPoint(bounds, point, padding)) continue;
        if (clearanceAtPoint(point, collisionWalls) < passageRadius - epsilon) continue;
        if (!segmentClear(mid, point, passageRadius, collisionWalls, epsilon)) continue;
        (point === first ? firstSide : secondSide).push(point);
      }
    }

    // Reject a "gap" whose crossing line cuts through one of its own walls.
    // This rules out pairs that are really a corner or a wall length, which
    // would otherwise let the reduced-radius edge tunnel through the wall.
    if (firstSide.length > 0 && secondSide.length > 0) {
      const farFirst = firstSide.at(-1);
      const farSecond = secondSide.at(-1);
      for (const wall of hostWalls) {
        if (segmentsIntersect(farFirst, farSecond, wall.a, wall.b, 0.01)) return;
      }

      // The crossing itself must not cut any wall at the reduced radius.
      if (!segmentClear(farFirst, farSecond, passageRadius, collisionWalls, epsilon)) return;
    }
    if (!boundsContainsPoint(bounds, mid, padding)) return;

    const portalId = `gap-${portalCounter}`;
    portalCounter += 1;
    const portal = { portalId, portalCenter: mid, portalRadius: zoneRadius };
    candidates.push({ point: mid, ...portal });
    for (const point of firstSide) candidates.push({ point, ...portal });
    for (const point of secondSide) candidates.push({ point, ...portal });
  };

  for (let first = 0; first < endpoints.length; first += 1) {
    for (let second = first + 1; second < endpoints.length; second += 1) {
      const left = endpoints[first];
      const right = endpoints[second];
      // The two ends of one wall are not a passage; their connecting line is
      // the wall itself.
      if ([...left.wallIds].some((id) => right.wallIds.has(id))) continue;
      const hostIds = new Set([...left.wallIds, ...right.wallIds]);
      addGap(left.point, right.point, hostIds);
    }
  }

  // A doorway can also be formed by a wall end facing the side of another
  // wall. Measure the actual endpoint-to-face distance instead of assuming
  // every opening is bounded by two endpoints.
  for (const endpoint of endpoints) {
    for (const wall of walls) {
      if (endpoint.wallIds.has(wall.id)) continue;
      const facePoint = closestPointOnSegment(endpoint.point, wall.a, wall.b);
      if (Math.hypot(facePoint.x - endpoint.point.x, facePoint.y - endpoint.point.y) < 0.5) continue;
      // A nearest point at the wall's own end is a corner, not a face gap;
      // endpoint-to-endpoint handling already covers it.
      if (Math.hypot(facePoint.x - wall.a.x, facePoint.y - wall.a.y) < 0.5) continue;
      if (Math.hypot(facePoint.x - wall.b.x, facePoint.y - wall.b.y) < 0.5) continue;
      const hostIds = new Set([...endpoint.wallIds, wall.id]);
      addGap(endpoint.point, facePoint, hostIds);
    }
  }

  return candidates;
}

/**
 * Visibility test between two graph nodes. Edges inside one portal use the
 * reduced passage radius. An edge from a start/goal or ordinary waypoint is
 * also reduced when that end is inside the portal's local squeeze zone, so the
 * token can finish leaving a narrow corridor bounded by a third wall.
 *
 * @param {{point: Point, portalId?: string, portalCenter?: Point, portalRadius?: number}} from
 * @param {{point: Point, portalId?: string, portalCenter?: Point, portalRadius?: number}} to
 * @param {number} radius
 * @param {number} passageRadius
 * @param {WallSegment[]} walls
 * @param {number} epsilon
 * @returns {boolean}
 */
function edgeClear(from, to, radius, passageRadius, walls, epsilon) {
  if (!from?.point || !to?.point) return false;
  const samePortal = Boolean(from.portalId) && from.portalId === to.portalId;
  const fromInZone = Boolean(from.portalId) && portalZoneContains(from, to.point);
  const toInZone = Boolean(to.portalId) && portalZoneContains(to, from.point);
  if (samePortal || fromInZone || toInZone) {
    return segmentClear(from.point, to.point, passageRadius, walls, epsilon);
  }
  return segmentClear(from.point, to.point, radius, walls, epsilon);
}

/** @param {{portalCenter?: Point, portalRadius?: number}} node @param {Point} point */
function portalZoneContains(node, point) {
  if (!node.portalCenter || !(Number(node.portalRadius) > 0)) return false;
  return Math.hypot(point.x - node.portalCenter.x, point.y - node.portalCenter.y)
    <= Number(node.portalRadius);
}

/** @param {Point} a @param {Point} b @param {number} [epsilon] */
function isSamePoint(a, b, epsilon = 0.01) {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/**
 * Whether a wall enters the open span between two gap endpoints. Endpoint
 * contact is ignored so a jamb wall attached at a corner does not make a real
 * doorway look closed.
 *
 * @param {Point} a
 * @param {Point} b
 * @param {import("./walls.mjs").WallSegment} wall
 * @param {number} [epsilon]
 * @returns {boolean}
 */
function segmentCrossesOpenSpan(a, b, wall, epsilon = 0.01) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return false;

  const onOpenSpan = (point) => {
    const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
    if (t <= 1e-4 || t >= 1 - 1e-4) return false;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    return Math.hypot(point.x - x, point.y - y) <= epsilon;
  };

  // A wall endpoint inside the span (a T-junction or an overlapping wall)
  // closes the opening even though it does not produce a strict crossing.
  if (onOpenSpan(wall.a) || onOpenSpan(wall.b)) return true;

  // The reverse case: one of the gap endpoints lies inside this wall, which
  // means the measured "gap" is really the surface of a thicker wall.
  const wallDx = wall.b.x - wall.a.x;
  const wallDy = wall.b.y - wall.a.y;
  const wallLengthSq = wallDx * wallDx + wallDy * wallDy;
  if (wallLengthSq >= 1e-9) {
    for (const point of [a, b]) {
      const t = ((point.x - wall.a.x) * wallDx + (point.y - wall.a.y) * wallDy) / wallLengthSq;
      if (t <= 1e-4 || t >= 1 - 1e-4) continue;
      const x = wall.a.x + wallDx * t;
      const y = wall.a.y + wallDy * t;
      if (Math.hypot(point.x - x, point.y - y) <= epsilon) return true;
    }
  }

  const sideA = (b.x - a.x) * (wall.a.y - a.y) - (b.y - a.y) * (wall.a.x - a.x);
  const sideB = (b.x - a.x) * (wall.b.y - a.y) - (b.y - a.y) * (wall.b.x - a.x);

  // A collinear wall overlapping part of the span also closes it, including a
  // duplicate wall exactly covering the measured opening.
  if (Math.abs(sideA) <= epsilon && Math.abs(sideB) <= epsilon) {
    const t1 = ((wall.a.x - a.x) * dx + (wall.a.y - a.y) * dy) / lengthSq;
    const t2 = ((wall.b.x - a.x) * dx + (wall.b.y - a.y) * dy) / lengthSq;
    const from = Math.min(t1, t2);
    const to = Math.max(t1, t2);
    return to > 1e-4 && from < 1 - 1e-4;
  }

  // Strict crossings have each wall endpoint on opposite sides of the span.
  if (Math.abs(sideA) <= epsilon || Math.abs(sideB) <= epsilon) return false;
  const spanSideA = wallDx * (a.y - wall.a.y) - wallDy * (a.x - wall.a.x);
  const spanSideB = wallDx * (b.y - wall.a.y) - wallDy * (b.x - wall.a.x);
  if (Math.abs(spanSideA) <= epsilon || Math.abs(spanSideB) <= epsilon) return false;
  return (sideA > 0) !== (sideB > 0) && (spanSideA > 0) !== (spanSideB > 0);
}

/** @param {Point} point @param {Point} a @param {Point} b @returns {Point} */
function closestPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return { x: a.x, y: a.y };
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * @param {Int32Array} cameFrom
 * @param {number} index
 * @returns {number[]}
 */
function reconstruct(cameFrom, index) {
  const indices = [index];
  let current = index;
  while (cameFrom[current] !== -1) {
    current = cameFrom[current];
    indices.push(current);
    if (indices.length > 10000) break;
  }
  return indices.reverse();
}

/**
 * Greedy line-of-sight smoothing.
 * @param {Point[]} points
 * @param {number} radius
 * @param {WallSegment[]} walls
 * @param {number} epsilon
 * @returns {Point[]}
 */
export function smooth(points, radius, walls, epsilon = CLEARANCE_EPSILON) {
  if (points.length <= 2) return points.map((point) => ({ ...point }));

  const result = [points[0]];
  let anchor = 0;

  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (next > anchor + 1) {
      if (segmentClear(points[anchor], points[next], radius, walls, epsilon)) break;
      next -= 1;
    }
    result.push({ ...points[next] });
    anchor = next;
  }

  return result;
}

/** Binary min-heap with stale-entry tolerance. */
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(index, score) {
    const item = { index, score };
    this.items.push(item);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.items[parent].score <= this.items[child].score) break;
      [this.items[parent], this.items[child]] = [this.items[child], this.items[parent]];
      child = parent;
    }
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.items.length && this.items[left].score < this.items[smallest].score) smallest = left;
        if (right < this.items.length && this.items[right].score < this.items[smallest].score) smallest = right;
        if (smallest === parent) break;
        [this.items[parent], this.items[smallest]] = [this.items[smallest], this.items[parent]];
        parent = smallest;
      }
    }
    return top;
  }
}
