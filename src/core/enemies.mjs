/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Hostile-token collision: contact clamping along a route and cursor-relative
 * rotation around a token the moving token is already touching.
 * Pure functions.
 */

import { angleDelta, firstCircleContactOnSegment, pointSegmentDistance } from "./geometry.mjs";
import { distance } from "./vec.mjs";
import { ENEMY_POLICY, TOKEN_DISPOSITION } from "../constants.mjs";

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {{id: string, center: Point, radius: number}} Enemy
 * @typedef {{id: string, disposition: number, hidden?: boolean}} EnemyCandidate
 */

/**
 * Filter candidate tokens by the configured disposition policy.
 * Friendly tokens never block. Hidden and secret tokens are excluded unless
 * explicitly included.
 *
 * @param {EnemyCandidate[]} candidates
 * @param {object} [options]
 * @param {string} [options.policy]
 * @param {boolean} [options.includeHidden]
 * @returns {EnemyCandidate[]}
 */
export function filterEnemies(candidates, {
  policy = ENEMY_POLICY.hostile,
  includeHidden = false
} = {}) {
  const hostile = TOKEN_DISPOSITION.hostile;
  const neutral = TOKEN_DISPOSITION.neutral;
  const friendly = TOKEN_DISPOSITION.friendly;
  const secret = TOKEN_DISPOSITION.secret;

  return (candidates ?? []).filter((candidate) => {
    const disposition = Number(candidate.disposition);
    if (disposition === friendly) return false;
    const hidden = Boolean(candidate.hidden) || disposition === secret;
    if (hidden && !includeHidden) return false;

    switch (policy) {
      case ENEMY_POLICY.hostileNeutral:
        return disposition === hostile || disposition === neutral;
      case ENEMY_POLICY.nonFriendly:
        return disposition !== friendly;
      case ENEMY_POLICY.hostile:
      default:
        return disposition === hostile;
    }
  });
}

/**
 * Whether the moving token is touching or overlapping an enemy.
 * @param {Point} position
 * @param {Enemy} enemy
 * @param {number} movingRadius
 * @param {number} [tolerance]
 */
export function isTouchingEnemy(position, enemy, movingRadius, tolerance = 2) {
  return distance(position, enemy.center) <= movingRadius + enemy.radius + tolerance;
}

/**
 * Truncate a polyline at the first new contact with an enemy.
 *
 * Tokens already touching an enemy are allowed to move away: a segment that
 * starts inside contact and increases its distance is ignored. A segment that
 * starts in contact and moves deeper is clamped immediately.
 *
 * @param {Point[]} points
 * @param {object} options
 * @param {number} options.movingRadius
 * @param {Enemy[]} [options.enemies]
 * @param {number} [options.epsilon]
 * @returns {{points: Point[], contact: {enemyId: string, point: Point, distanceAlong: number} | null, distanceAlong: number}}
 */
export function clampPolylineAtEnemies(points, {
  movingRadius,
  enemies = [],
  epsilon = 0.5
}) {
  if (!points?.length || !enemies.length) {
    return { points: points ?? [], contact: null, distanceAlong: Infinity };
  }

  let best = null;
  let travelled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const segmentLength = distance(a, b);
    if (segmentLength < 1e-9) continue;

    for (const enemy of enemies) {
      const contactDistance = movingRadius + enemy.radius;
      const startDistance = distance(a, enemy.center);
      const endDistance = distance(b, enemy.center);

      let t;
      if (startDistance <= contactDistance + epsilon) {
        // Already touching or overlapping. The token may move away, but a
        // segment that passes through the enemy must still be clamped. A
        // straight segment whose closest point is its start is moving away.
        const closest = pointSegmentDistance(enemy.center, a, b);
        if (closest >= startDistance - epsilon) continue;
        t = 0;
      } else {
        t = firstCircleContactOnSegment(a, b, enemy.center, contactDistance);
      }
      if (t == null) continue;

      const along = travelled + segmentLength * t;
      if (!best || along < best.distanceAlong - 1e-6) {
        best = {
          enemyId: enemy.id,
          point: {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
          },
          distanceAlong: along
        };
      }
    }

    travelled += segmentLength;
  }

  if (!best) return { points, contact: null, distanceAlong: Infinity };

  const truncated = [{ ...points[0] }];
  let accumulated = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distance(start, end);
    if (accumulated + segmentLength >= best.distanceAlong - 1e-6) {
      const t = segmentLength < 1e-9
        ? 0
        : Math.max(0, Math.min(1, (best.distanceAlong - accumulated) / segmentLength));
      truncated.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      });
      break;
    }
    truncated.push({ ...end });
    accumulated += segmentLength;
  }

  if (
    truncated.length > 1
    && distance(truncated[truncated.length - 1], truncated[truncated.length - 2]) < 1e-6
  ) {
    truncated.pop();
  }

  return { points: truncated, contact: best, distanceAlong: best.distanceAlong };
}

/**
 * Pick the enemy under the cursor, preferring the closest center.
 * The caller decides which enemies are eligible (for example, touching ones).
 *
 * @param {Enemy[]} enemies
 * @param {Point} cursor
 * @param {number} [tolerance]
 * @returns {Enemy | null}
 */
export function findEnemyUnderCursor(enemies, cursor, tolerance = 0) {
  let best = null;
  let bestDistance = Infinity;
  for (const enemy of enemies) {
    if (distance(cursor, enemy.center) > enemy.radius + tolerance) continue;
    const cursorDistance = distance(cursor, enemy.center);
    if (cursorDistance < bestDistance) {
      bestDistance = cursorDistance;
      best = enemy;
    }
  }
  return best;
}

/**
 * Compute the next perimeter position around an enemy from the cursor direction.
 *
 * The full arc from the last valid angle toward the requested angle is walked in
 * small steps, so the token can never jump across a wall or another enemy that
 * blocks the arc. If the direct position is valid but an intermediate step is
 * not, the result is clamped to the last legal step.
 *
 * @param {object} options
 * @param {Enemy} options.enemy
 * @param {Point} options.cursor
 * @param {number} options.movingRadius
 * @param {number | null} [options.lastAngle]
 * @param {(position: Point, angle: number) => boolean} [options.isPositionValid]
 * @param {number} [options.step] Radians per validation step.
 * @returns {{point: Point, angle: number, clamped: boolean} | null}
 */
export function resolveRotation({
  enemy,
  cursor,
  movingRadius,
  lastAngle = null,
  isPositionValid = () => true,
  step = Math.PI / 90
}) {
  const contactDistance = movingRadius + enemy.radius;
  const dx = cursor.x - enemy.center.x;
  const dy = cursor.y - enemy.center.y;
  const cursorLength = Math.hypot(dx, dy);

  const targetAngle = cursorLength < 1e-6
    ? (lastAngle ?? 0)
    : Math.atan2(dy, dx);
  const startAngle = lastAngle ?? targetAngle;

  const pointAtAngle = (angle) => ({
    x: enemy.center.x + Math.cos(angle) * contactDistance,
    y: enemy.center.y + Math.sin(angle) * contactDistance
  });

  const delta = angleDelta(startAngle, targetAngle);
  if (Math.abs(delta) < 1e-6) {
    const point = pointAtAngle(startAngle);
    return isPositionValid(point, startAngle)
      ? { point, angle: startAngle, clamped: false }
      : null;
  }

  const iterations = Math.max(1, Math.ceil(Math.abs(delta) / Math.max(1e-4, step)));
  let best = null;

  for (let index = 1; index <= iterations; index += 1) {
    const angle = startAngle + delta * (index / iterations);
    const point = pointAtAngle(angle);
    if (!isPositionValid(point, angle)) break;
    best = { point, angle };
  }

  if (!best) return null;

  return {
    ...best,
    clamped: Math.abs(angleDelta(best.angle, targetAngle)) > 1e-6
  };
}

/**
 * Whether two enemies are the same reference.
 * @param {Enemy} a @param {Enemy} b
 */
export function sameEnemy(a, b) {
  return Boolean(a && b && a.id === b.id);
}
