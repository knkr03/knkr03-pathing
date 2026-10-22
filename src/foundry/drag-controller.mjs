/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Drag controller for the Foundry v13+ token drag workflow.
 *
 * Foundry v13 does not move the token document while dragging. It clones the
 * token into the preview layer, moves the clone to the cursor, and commits a
 * list of waypoints on drop through TokenDocument#update({movement}).
 *
 * Passage is limited by the token's size: its body keeps full wall clearance,
 * while a gap must be at least `gapClearance` (75% by default) of the token's
 * width. A narrower gap is not a valid route. The reduced-radius crossing is
 * confined to the opening; ordinary walls still use the full body radius.
 */

import { CLEARANCE_EPSILON, MIN_REPLAN_INTERVAL_MS, PLAN_STATUS, REPLAN_THRESHOLD } from "../constants.mjs";
import { getTokenClass, isGridlessScene, sceneUnits, unitsPerPixel } from "../compat.mjs";
import { limitRoute, planMovement } from "../core/planner.mjs";
import { buildSegments } from "../core/cost.mjs";
import { angleDelta, polylineLength } from "../core/geometry.mjs";
import { angleOf, distance } from "../core/vec.mjs";
import { clearanceAtPoint } from "../core/walls.mjs";
import { findEnemyUnderCursor, isTouchingEnemy, resolveRotation } from "../core/enemies.mjs";
import { debugLog, readRuntimeSettings } from "../settings.mjs";
import {
  getCursorPoint,
  getDocumentCenter,
  getEnemies,
  getMovementAction,
  getMovementLimit,
  getPassageProfile,
  getTokenCenter,
  getTokenSizePixels,
  setTokenCenter
} from "./adapters.mjs";

const ROTATION_STEP = Math.PI / 90;
const ROTATION_PREVIEW_STEP = Math.PI / 18;
const CONTACT_TOLERANCE = 3;

/** Methods wrapped on the Token placeable. All are present in Foundry v13. */
export const DRAG_METHODS = Object.freeze([
  "_initializeDragLeft",
  "_updateDragDestination",
  "_prepareDragLeftDropUpdates",
  "_finalizeDragLeft"
]);

export class DragController {
  /**
   * @param {object} options
   * @param {import("./preview.mjs").PreviewRenderer} options.preview
   * @param {import("./adapters.mjs").WallCache} options.wallCache
   */
  constructor({ preview, wallCache }) {
    this.preview = preview;
    this.wallCache = wallCache;
    this.patches = [];
    this.session = null;
    this.failure = null;
    this.installed = false;
    this.errorNotified = false;
  }

  /** @returns {boolean} */
  install() {
    if (this.installed) return true;
    const TokenClass = getTokenClass();
    if (!TokenClass) return false;

    const proto = TokenClass.prototype;
    for (const method of DRAG_METHODS) {
      if (typeof proto[method] !== "function") return false;
    }

    const controller = this;

    for (const method of DRAG_METHODS) {
      const original = proto[method];
      const wrapped = function knkrPathingDragWrapper(...args) {
        if (method === "_initializeDragLeft") {
          const result = original.apply(this, args);
          try {
            controller.onDragStart(this, args[0]);
          } catch (error) {
            controller.handleError(this, error);
          }
          return result;
        }

        if (method === "_updateDragDestination") {
          const result = original.apply(this, args);
          try {
            controller.onDragMove(this, args[0]);
          } catch (error) {
            controller.handleError(this, error);
          }
          return result;
        }

        if (method === "_prepareDragLeftDropUpdates") {
          const result = original.apply(this, args);
          try {
            return controller.beforeDrop(this, result);
          } catch (error) {
            controller.handleError(this, error);
            return controller.suppressDrop(this, result);
          }
        }

        // _finalizeDragLeft covers both a committed drop and a cancelled drag.
        try {
          controller.afterDrop(this);
        } catch (error) {
          controller.handleError(this, error);
        }
        return original.apply(this, args);
      };

      wrapped.__knkrPathingWrapped = true;
      proto[method] = wrapped;
      this.patches.push({ proto, method, original });
    }

    this.installed = true;
    debugLog("drag controller installed", { methods: [...DRAG_METHODS] });
    return true;
  }

  uninstall() {
    for (const { proto, method, original } of this.patches) {
      if (proto[method]?.__knkrPathingWrapped) proto[method] = original;
    }
    this.patches = [];
    this.installed = false;
    this.failure = null;
    this.endSession();
  }

  /** Called by hooks when wall geometry or scene state changes. */
  invalidate() {
    this.wallCache.invalidate();
    if (this.session) this.session.forceReplan = true;
  }

  /** @param {object} token */
  isEligible(token) {
    const scene = globalThis.canvas?.scene;
    if (!scene || !token?.document) return false;
    if (token.isPreview) return false;
    if (token.document.parent?.id && token.document.parent.id !== scene.id) return false;
    if (!isGridlessScene(scene)) return false;
    const controlled = globalThis.canvas?.tokens?.controlled ?? [];
    if (controlled.length > 1) {
      debugLog("multi-token drag ignored", controlled.length);
      return false;
    }
    return true;
  }

  /**
   * Start a session once Foundry has created the drag clone and its context.
   * @param {object} token
   * @param {object} [event]
   */
  onDragStart(token, event) {
    this.endSession();
    this.failure = null;

    if (!this.isEligible(token)) return;

    const scene = globalThis.canvas.scene;
    const runtime = readRuntimeSettings(scene, unitsPerPixel(scene));
    if (!runtime.enabled) return;

    const document = token.document;
    const context = event?.interactionData?.contexts?.[document.id] ?? null;
    const origin = getDocumentCenter(token);
    if (!origin) return;

    const profile = getPassageProfile(token, scene, runtime);
    const { width: widthPx, height: heightPx } = getTokenSizePixels(token, scene);
    const movementLimit = getMovementLimit(token);

    this.session = {
      token,
      documentId: String(document.id),
      context,
      previewToken: context?.clonedToken ?? null,
      sceneId: scene.id,
      origin,
      widthPx,
      heightPx,
      radius: profile.radius,
      passageRadius: profile.passageRadius,
      passage: profile,
      movementLimit,
      runtime,
      action: getMovementAction(token),
      walls: this.wallCache.get(scene),
      enemies: [],
      rotationEnemyId: null,
      rotationAngle: null,
      rotationStartAngle: null,
      rotationApproach: null,
      commitPoints: null,
      committedCenter: null,
      appliedCenter: origin,
      lastGoal: null,
      lastCursor: null,
      lastPlan: null,
      lastPlanAt: 0,
      forceReplan: true
    };

    this.preview.attach();
    debugLog("drag start", {
      token: document.id,
      origin,
      radius: profile.radius,
      passageRadius: profile.passageRadius,
      gapRatio: profile.gapRatio,
      gapRatioSource: profile.gapRatioSource,
      sizeKey: profile.sizeKey,
      baseRadius: profile.baseRadius,
      tags: profile.tags,
      tagExceptions: profile.appliedTags,
      action: this.session.action,
      movementLimit: movementLimit?.remaining ?? null,
      foundry: globalThis.game?.version
    });
  }

  /**
   * The center of the position the user is dragging toward.
   *
   * The raw cursor is preferred over the drag context destination. Other
   * modules (notably the movement limiter) rewrite the context destination to
   * clamp it, and a clamped goal makes the planned route stop tracking the
   * pointer. Planning from the cursor and applying the movement budget to the
   * route keeps the preview stable and consistent from frame to frame.
   *
   * @param {object} session
   * @param {{x: number, y: number}} [cursor]
   * @param {boolean} [hasCursor]
   * @returns {{x: number, y: number} | null}
   */
  getGoal(session, cursor = null, hasCursor = false) {
    if (hasCursor && Number.isFinite(cursor?.x) && Number.isFinite(cursor?.y)) {
      return { x: cursor.x, y: cursor.y };
    }

    const goal = session.context?.destination;
    if (goal && Number.isFinite(goal.x) && Number.isFinite(goal.y)) {
      // The drag context reports top-left pixels. Use the moving token's own
      // actual size rather than trusting an optional context width/height.
      return {
        x: goal.x + session.widthPx / 2,
        y: goal.y + session.heightPx / 2
      };
    }
    return getTokenCenter(session.previewToken ?? session.token);
  }

  /**
   * Called after Foundry has moved the preview clone to the cursor.
   * @param {object} token
   * @param {object} [event]
   */
  onDragMove(token, event) {
    const session = this.session;
    if (!session || session.token !== token) return;

    const scene = globalThis.canvas?.scene;
    if (!scene || scene.id !== session.sceneId || !isGridlessScene(scene)) {
      this.endSession();
      return;
    }

    const runtime = readRuntimeSettings(scene, unitsPerPixel(scene));
    if (!runtime.enabled) {
      this.endSession();
      return;
    }
    session.runtime = runtime;

    const cursor = getCursorPoint(event);
    const hasCursor = Boolean(
      (Number.isFinite(globalThis.canvas?.mousePosition?.x)
        && Number.isFinite(globalThis.canvas?.mousePosition?.y))
      || (Number.isFinite(event?.global?.x) && Number.isFinite(event?.global?.y))
    );
    const proposed = this.getGoal(session, cursor, hasCursor);
    if (!proposed) return;

    const unchanged = !session.forceReplan
      && session.lastGoal
      && distance(proposed, session.lastGoal) < REPLAN_THRESHOLD
      && session.lastCursor
      && distance(cursor, session.lastCursor) < REPLAN_THRESHOLD;

    if (unchanged) {
      this.applyCenter(session, session.appliedCenter);
      return;
    }

    const now = globalThis.performance?.now?.() ?? Date.now();
    const cursorMoved = session.lastCursor ? distance(cursor, session.lastCursor) : Infinity;
    const goalMoved = session.lastGoal ? distance(proposed, session.lastGoal) : Infinity;
    const smallStep = Math.max(REPLAN_THRESHOLD, session.radius * 0.15);
    if (
      !session.forceReplan
      && session.lastPlanAt
      && now - session.lastPlanAt < MIN_REPLAN_INTERVAL_MS
      && cursorMoved < smallStep
      && goalMoved < smallStep
    ) {
      // Throttle graph construction only for small pointer movements. Larger
      // jumps replan immediately. The preview is re-applied to its last legal
      // center, so throttling cannot leak motion.
      this.applyCenter(session, session.appliedCenter);
      return;
    }

    session.forceReplan = false;
    session.lastGoal = proposed;
    session.lastCursor = cursor;
    session.lastPlanAt = now;
    session.walls = this.wallCache.get(scene);

    const frame = this.computeFrame(session, proposed, cursor);
    session.lastPlan = frame.plan;
    session.commitPoints = frame.commitPoints ?? frame.plan.points;
    session.appliedCenter = frame.appliedCenter;

    this.applyCenter(session, frame.appliedCenter);
    try {
      this.preview.draw(frame.plan, {
        units: sceneUnits(scene),
        showDistanceLabel: runtime.showDistanceLabel,
        appliedCenter: frame.appliedCenter
      });
    } catch (error) {
      // The overlay is cosmetic. A PIXI/render failure must never disable route
      // planning and leave the native preview sitting at the cursor.
      console.warn("Knkr03's pathing | failed to draw the drag preview", error);
    }
  }

  /**
   * @param {object} session
   * @param {{x: number, y: number}} proposed
   * @param {{x: number, y: number}} cursor
   */
  computeFrame(session, proposed, cursor) {
    const scene = globalThis.canvas.scene;
    const runtime = session.runtime;
    const walls = session.walls;
    const enemies = getEnemies(session.token, scene, runtime);
    session.enemies = enemies;
    // The budget is a snapshot from drag start, matching the snapshot the
    // movement limiter took when it wrapped the same drag. Re-reading it
    // mid-drag could diverge if another module edits movement history.

    const rotation = this.tryRotation(session, cursor, enemies, walls);
    if (rotation) {
      // Commit the shorter arc from where the rotation began to the current
      // perimeter position, not the full trace of every cursor wiggle.
      const meta = rotation.plan.rotation;
      const arc = buildArcPoints(
        meta.center,
        meta.contactDistance,
        meta.startAngle ?? meta.angle,
        meta.angle
      );
      const approach = session.rotationApproach ?? session.commitPoints ?? [session.origin];
      const commitPoints = appendArc(approach, arc);
      return this.limitRotationPlan(session, rotation, commitPoints)
        ?? { ...rotation, commitPoints };
    }

    session.rotationEnemyId = null;
    session.rotationAngle = null;
    session.rotationStartAngle = null;
    session.rotationApproach = null;

    const plan = this.plan(session, proposed);
    return {
      plan,
      executedPlan: plan,
      appliedCenter: plan.endpoint,
      commitPoints: plan.points
    };
  }

  /**
   * Apply an external movement budget to a rotation route. The visible plan is
   * rebuilt from the full committed route (approach plus arc) so the preview
   * and waypoint commit stop at the same budgeted point.
   *
   * @param {object} session
   * @param {object} frame Result of tryRotation().
   * @param {Array<{x: number, y: number}>} commitPoints
   * @returns {object | null} A replacement frame when the route was truncated.
   */
  limitRotationPlan(session, frame, commitPoints) {
    const available = session.movementLimit?.remaining;
    if (available == null) return null;

    const route = limitRoute(commitPoints, {
      maxDistance: available,
      unitsPerPixel: session.runtime.unitsPerPixel
    });
    if (!route.limited) return null;

    const points = route.points;
    const endpoint = points[points.length - 1] ?? { ...session.origin };
    const segments = buildSegments(points, { unitsPerPixel: session.runtime.unitsPerPixel });
    const plan = {
      ...frame.plan,
      status: PLAN_STATUS.limited,
      routeMode: PLAN_STATUS.limited,
      complete: false,
      points,
      segments,
      endpoint,
      totalDistance: route.limit.distance,
      totalCost: route.limit.distance,
      physicalDistancePx: polylineLength(points),
      movementLimit: route.limit
    };

    const meta = plan.rotation;
    if (meta) {
      const distanceFromCenter = Math.hypot(endpoint.x - meta.center.x, endpoint.y - meta.center.y);
      if (Math.abs(distanceFromCenter - meta.contactDistance) <= 1) {
        // Stay in rotation mode at the angle actually reached.
        session.rotationAngle = Math.atan2(endpoint.y - meta.center.y, endpoint.x - meta.center.x);
      } else {
        // The budget ran out before the perimeter: the next frame is ordinary
        // pathfinding from the stopped position.
        session.rotationEnemyId = null;
        session.rotationAngle = null;
        session.rotationStartAngle = null;
        session.rotationApproach = null;
      }
    }

    return {
      plan,
      executedPlan: plan,
      appliedCenter: endpoint,
      commitPoints: points
    };
  }

  /**
   * @param {object} session
   * @param {{x: number, y: number}} goal
   */
  plan(session, goal) {
    return planMovement({
      start: session.origin,
      goal,
      walls: session.walls,
      radius: session.radius,
      passageRadius: session.passageRadius,
      enemies: session.enemies,
      unitsPerPixel: session.runtime.unitsPerPixel,
      maxDistance: session.movementLimit?.remaining ?? null,
      epsilon: CLEARANCE_EPSILON
    });
  }

  /**
   * Cursor-over-enemy perimeter rotation.
   * @param {object} session
   * @param {{x: number, y: number}} cursor
   * @param {Array<{id: string, center: {x: number, y: number}, radius: number}>} enemies
   * @param {import("../core/walls.mjs").WallSegment[]} walls
   */
  tryRotation(session, cursor, enemies, walls) {
    const current = session.appliedCenter;
    const movingRadius = session.radius;
    const touching = enemies.filter((enemy) => isTouchingEnemy(current, enemy, movingRadius, CONTACT_TOLERANCE));
    const candidate = findEnemyUnderCursor(touching, cursor);
    if (!candidate) return null;

    if (session.rotationEnemyId !== candidate.id) {
      session.rotationEnemyId = candidate.id;
      session.rotationAngle = angleOf({
        x: current.x - candidate.center.x,
        y: current.y - candidate.center.y
      });
      // The shortest committed route is measured from the angle at which the
      // rotation began, so direction changes or back-and-forth cursor motion
      // cannot record a longer way around the enemy.
      session.rotationStartAngle = session.rotationAngle;
      session.rotationApproach = session.commitPoints ?? [session.origin];
    }

    const contactDistance = movingRadius + candidate.radius;
    const isValid = (position) => {
      if (clearanceAtPoint(position, walls) < movingRadius - 0.75) return false;
      for (const enemy of enemies) {
        if (enemy.id === candidate.id) continue;
        if (distance(position, enemy.center) < movingRadius + enemy.radius - 1) return false;
      }
      return true;
    };

    const rotation = resolveRotation({
      enemy: candidate,
      cursor,
      movingRadius,
      lastAngle: session.rotationAngle,
      isPositionValid: isValid,
      step: ROTATION_STEP
    });
    if (!rotation) return null;

    const previousAngle = session.rotationAngle ?? rotation.angle;
    const arcPoints = buildArcPoints(candidate.center, contactDistance, previousAngle, rotation.angle);
    const arcLength = Math.abs(angleDelta(previousAngle, rotation.angle)) * contactDistance;
    const sceneDistance = arcLength * session.runtime.unitsPerPixel;
    session.rotationAngle = rotation.angle;

    const plan = {
      status: "normal",
      routeMode: "rotation",
      complete: true,
      start: session.origin,
      goal: cursor,
      points: arcPoints,
      segments: null,
      reachable: true,
      contact: { enemyId: candidate.id, point: rotation.point, distanceAlong: 0 },
      endpoint: rotation.point,
      totalDistance: sceneDistance,
      totalCost: sceneDistance,
      physicalDistancePx: arcLength,
      unitsPerPixel: session.runtime.unitsPerPixel,
      radius: movingRadius,
      rotation: {
        enemyId: candidate.id,
        angle: rotation.angle,
        startAngle: session.rotationStartAngle ?? rotation.angle,
        center: { ...candidate.center },
        contactDistance,
        clamped: rotation.clamped
      }
    };

    return { plan, appliedCenter: rotation.point };
  }

  /**
   * Replace Foundry's committed waypoints with the planned route. Called with
   * the result of the core Token#_prepareDragLeftDropUpdates.
   * @param {object} token
   * @param {Array | undefined} result
   * @returns {Array | undefined}
   */
  beforeDrop(token, result) {
    if (!result) {
      this.endSession();
      return result;
    }

    const documentId = String(token?.document?.id);
    if (this.failure && this.failure.tokenId === documentId) {
      const suppressed = this.suppressDrop(token, result);
      this.endSession();
      return suppressed;
    }

    const session = this.session;
    if (!session || session.token !== token) return result;

    let [updates, options] = Array.isArray(result[0]) ? result : [result, {}];
    if (!Array.isArray(updates)) return result;
    options ??= {};

    const waypoints = this.buildWaypoints(session, session.commitPoints ?? []);

    if (waypoints.length === 0) {
      // No legal movement from here: drop nothing rather than commit the raw
      // cursor destination.
      const suppressed = this.suppressDrop(token, [updates, options]);
      this.endSession();
      return suppressed;
    }

    const movement = options.movement?.[token.document.id];
    if (movement) {
      movement.waypoints = waypoints;
      // The route has already been constrained by this module, including its
      // reduced-radius opening crossings. Foundry's native wall pass uses the
      // token's full footprint and would trim the route back to the near side
      // of a squeeze gap. Trust the planned route and keep the other native
      // constraints (bounds, movement cost, token blocking) enabled.
      movement.constrainOptions = { ...(movement.constrainOptions ?? {}), ignoreWalls: true };
    } else {
      updates = updates.filter((update) => String(update?._id) !== documentId);
      updates.push({ _id: token.document.id });
      options.movement = {
        ...(options.movement ?? {}),
        [token.document.id]: {
          waypoints,
          method: "dragging",
          constrainOptions: { ignoreWalls: true }
        }
      };
    }

    session.committedCenter = session.lastPlan?.endpoint ?? session.appliedCenter;

    debugLog("drop waypoints committed", {
      count: waypoints.length,
      endpoint: session.committedCenter,
      radius: session.radius
    });

    // Foundry clears the drag preview without calling _finalizeDragLeft after a
    // successful drop, so the session and overlay are ended here.
    this.afterDrop(token);
    return [updates, options];
  }

  /**
   * Remove the dragged token from a drop so no movement is committed.
   * @param {object} token
   * @param {Array} result
   */
  suppressDrop(token, result) {
    const documentId = String(token?.document?.id);
    const array = Array.isArray(result) ? result : [];
    const updates = Array.isArray(array[0]) ? array[0] : array;
    const options = Array.isArray(array[0]) ? (array[1] ?? {}) : {};
    const filtered = updates.filter((update) => String(update?._id) !== documentId);
    if (options.movement) delete options.movement[token?.document?.id];
    return [filtered, options];
  }

  /**
   * Convert planned centers to Foundry movement waypoints (top-left pixels).
   * @param {object} session
   * @param {Array<{x: number, y: number}>} points
   */
  buildWaypoints(session, points) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const document = session.token.document;
    const allowedActions = globalThis.CONFIG?.Token?.movement?.actions;
    const action = allowedActions && !(session.action in allowedActions)
      ? Object.keys(allowedActions)[0] ?? "walk"
      : session.action;
    const elevation = Number(document.elevation ?? document._source?.elevation ?? 0);
    const width = Math.max(0.1, Number(document.width) || 1);
    const height = Math.max(0.1, Number(document.height) || 1);
    const shape = document.shape;

    const waypoints = [];
    let previous = points[0];
    for (const point of points.slice(1)) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
      // A zero-length final point (for example a drop on the origin) must not
      // become a movement record.
      if (previous && distance(previous, point) < 0.5) continue;
      previous = point;
      waypoints.push({
        x: point.x - session.widthPx / 2,
        y: point.y - session.heightPx / 2,
        elevation,
        width,
        height,
        shape,
        action,
        snapped: false,
        explicit: false,
        checkpoint: false
      });
    }

    const last = waypoints.at(-1);
    if (last) {
      last.explicit = true;
      last.checkpoint = true;
    }
    return waypoints;
  }

  /**
   * End the session after Foundry finalized the drag (drop or cancel).
   * @param {object} token
   */
  afterDrop(token) {
    const session = this.session;
    if (!session || session.token !== token) return;

    if (session.committedCenter) this.verifyCommit(session);
    this.endSession();
  }

  /**
   * Defensive check that Foundry committed the planned endpoint. Core can trim
   * a path during its constraint pass; that is worth surfacing rather than
   * silently disagreeing with the preview.
   * @param {object} session
   */
  verifyCommit(session) {
    const expected = session.committedCenter;
    const token = session.token;
    const timer = globalThis.setTimeout?.(() => {
      try {
        const current = getDocumentCenter(token);
        if (!current || distance(current, expected) <= 2) return;
        console.warn(
          "Knkr03's pathing | the committed drop differs from the planned endpoint; Foundry's movement constraint trimmed the route",
          { committed: current, planned: expected }
        );
      } catch {
        // The token may already be gone.
      }
    }, 1000);
    timer?.unref?.();
  }

  /** @param {object} token */
  onCancel(token) {
    if (this.session && this.session.token !== token) return;
    this.endSession();
  }

  endSession() {
    this.session = null;
    this.preview.clear();
  }

  /**
   * Move the preview clone (or, without a Foundry clone, the token) so its
   * center lands on the planned point.
   * @param {object} session
   * @param {{x: number, y: number}} center
   */
  applyCenter(session, center) {
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return;
    const target = session.previewToken ?? session.token;
    const document = target?.document;
    const x = center.x - session.widthPx / 2;
    const y = center.y - session.heightPx / 2;

    try {
      // Mirror Foundry's own drag-preview update: write the clone document and
      // refresh only its position. Updating source and refreshing the entire
      // token state on every pointer event fights the native preview (and the
      // combat turn marker), which is visible as flicker.
      if (document) {
        document.x = x;
        document.y = y;
      }
      if (target?.position?.x !== x || target?.position?.y !== y) {
        setTokenCenter(target, center);
        target?.renderFlags?.set?.({ refreshPosition: true });
      }
    } catch (error) {
      console.warn("Knkr03's pathing | failed to update the drag preview position", error);
    }
    session.appliedCenter = center;
  }

  /**
   * @param {object} token
   * @param {unknown} error
   */
  handleError(token, error) {
    console.error("Knkr03's pathing | drag planning failed", error);
    this.failure = { tokenId: String(token?.document?.id ?? "") };
    this.endSession();

    if (!this.errorNotified) {
      this.errorNotified = true;
      try {
        globalThis.ui?.notifications?.error(
          globalThis.game?.i18n?.format?.("KNKR_PATHING.Notifications.Incompatible", {
            reason: error instanceof Error ? error.message : String(error)
          }) ?? "Knkr03's pathing disabled after a planning error."
        );
      } catch {
        // Notifications are best-effort.
      }
    }
  }
}

/**
 * Append arc points to a route, skipping a duplicated joint.
 * @param {Array<{x: number, y: number}>} base
 * @param {Array<{x: number, y: number}>} arc
 */
function appendArc(base, arc) {
  const route = Array.isArray(base) && base.length > 0 ? base.slice() : [];
  if (!Array.isArray(arc) || arc.length === 0) return route;
  const last = route.at(-1);
  const first = arc[0];
  const start = last && distance(last, first) < 0.5 ? 1 : 0;
  for (const point of arc.slice(start)) {
    const previous = route.at(-1);
    if (previous && distance(previous, point) < 0.001) continue;
    route.push(point);
  }
  return route;
}

/**
 * Arc preview points around an enemy.
 * @param {{x: number, y: number}} center
 * @param {number} radius
 * @param {number} fromAngle
 * @param {number} toAngle
 */
function buildArcPoints(center, radius, fromAngle, toAngle) {
  const delta = angleDelta(fromAngle, toAngle);
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / ROTATION_PREVIEW_STEP));
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = fromAngle + delta * (index / steps);
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }
  return points;
}
