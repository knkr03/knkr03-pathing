/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Adapters between Foundry documents and the plain-data core. All access is
 * guarded so an API change degrades to "no data" rather than a broken drag.
 */

import { extractBlockingWalls } from "../core/walls.mjs";
import { filterEnemies } from "../core/enemies.mjs";
import { resolvePassageProfile } from "../core/footprint.mjs";
import { GAP_CLEARANCE, MODULE_ID } from "../constants.mjs";
import { gridSize } from "../compat.mjs";
import { readGapClearanceSettings } from "../settings.mjs";

/** Module whose remaining-movement budget we consume when it is active. */
export const MOVEMENT_LIMITER_MODULE_ID = "dnd5e-movement-limiter";

/** @typedef {{x: number, y: number}} Point */

/** Current Foundry wall enum values, with numeric fallbacks used by the core. */
export function wallEnums() {
  const constants = globalThis.CONST ?? {};
  const result = {};
  if (constants.WALL_MOVEMENT_TYPES) result.movement = constants.WALL_MOVEMENT_TYPES;
  if (constants.WALL_DOOR_TYPES) result.door = constants.WALL_DOOR_TYPES;
  if (constants.WALL_DOOR_STATES) result.doorState = constants.WALL_DOOR_STATES;
  return result;
}

/**
 * Caches blocking wall segments for the active scene. Invalidate on any wall
 * or scene change.
 */
export class WallCache {
  constructor() {
    this.sceneId = null;
    this.walls = [];
    this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  /**
   * @param {object | null} scene
   * @returns {import("../core/walls.mjs").WallSegment[]}
   */
  get(scene) {
    if (!scene) return [];
    if (!this.dirty && this.sceneId === scene.id) return this.walls;

    const placeables = globalThis.canvas?.walls?.placeables ?? [];
    const documents = [];
    for (const placeable of placeables) {
      const document = placeable?.document ?? placeable;
      if (document?.c) documents.push(document);
    }

    this.walls = extractBlockingWalls(documents, wallEnums());
    this.sceneId = scene.id;
    this.dirty = false;
    return this.walls;
  }
}

/**
 * Token center in pixels.
 * @param {object} token
 * @returns {Point | null}
 */
export function getTokenCenter(token) {
  if (!token) return null;
  const center = token.center;
  if (center && Number.isFinite(center.x) && Number.isFinite(center.y)) {
    return { x: center.x, y: center.y };
  }
  const document = token.document;
  try {
    const point = document?.getCenterPoint?.();
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return { x: point.x, y: point.y };
    }
  } catch {
    // Fall through to the size-based calculation.
  }
  try {
    const size = document?.getSize?.();
    if (size && Number.isFinite(document?.x) && Number.isFinite(document?.y)) {
      return { x: document.x + size.width / 2, y: document.y + size.height / 2 };
    }
  } catch {
    // Fall through.
  }
  if (Number.isFinite(token.x) && Number.isFinite(token.y)) {
    return { x: token.x + (Number(token.w) || 0) / 2, y: token.y + (Number(token.h) || 0) / 2 };
  }
  return null;
}

/**
 * Document center in pixels. Unlike token.center this is stable during a drag,
 * because Foundry does not update the document until drop.
 * @param {object} token
 * @returns {Point | null}
 */
export function getDocumentCenter(token) {
  const document = token?.document;
  if (!document) return null;
  try {
    const point = document.getCenterPoint?.();
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return { x: point.x, y: point.y };
    }
  } catch {
    // Fall through.
  }
  if (Number.isFinite(document.x) && Number.isFinite(document.y)) {
    const sizePx = gridSize(globalThis.canvas?.scene);
    return {
      x: document.x + (Number(document.width) || 1) * sizePx / 2,
      y: document.y + (Number(document.height) || 1) * sizePx / 2
    };
  }
  return null;
}

/**
 * The token's actual footprint in canvas pixels.
 *
 * TokenDocument#getSize() is the authoritative pixel size in Foundry v13+; it
 * accounts for the scene's grid scaling and any special token shape. Fall back
 * to the placeable's w/h and only then to document grid units. Texture scale
 * is art scaling and is deliberately not part of the collision footprint.
 *
 * @param {object} token
 * @param {object | null} [scene]
 * @returns {{width: number, height: number}}
 */
export function getTokenSizePixels(token, scene = null) {
  const document = token?.document;
  try {
    const size = document?.getSize?.();
    const width = Number(size?.width);
    const height = Number(size?.height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return { width, height };
    }
  } catch {
    // Fall through to the placeable dimensions.
  }

  const placeableWidth = Number(token?.w);
  const placeableHeight = Number(token?.h);
  if (Number.isFinite(placeableWidth) && placeableWidth > 0
      && Number.isFinite(placeableHeight) && placeableHeight > 0) {
    return { width: placeableWidth, height: placeableHeight };
  }

  const sizePx = gridSize(scene ?? globalThis.canvas?.scene);
  return {
    width: Math.max(0.1, Number(document?.width) || 1) * sizePx,
    height: Math.max(0.1, Number(document?.height) || 1) * sizePx
  };
}

/**
 * Move a token so its center lands on the given point. Foundry stores the
 * top-left position in pixels.
 * @param {object} token
 * @param {Point} center
 */
export function setTokenCenter(token, center) {
  if (!token || !center) return;
  let { width, height } = getTokenSizePixels(token);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    const sizePx = gridSize(globalThis.canvas?.scene);
    width = (Number(token.document?.width) || 1) * sizePx;
    height = (Number(token.document?.height) || 1) * sizePx;
  }
  const x = center.x - (Number(width) || 0) / 2;
  const y = center.y - (Number(height) || 0) / 2;
  if (typeof token.position?.set === "function") token.position.set(x, y);
  else {
    token.x = x;
    token.y = y;
  }
}

/**
 * Tag-based clearance exceptions. Empty by default: ordinary tokens are
 * limited strictly by their size. A future token tag (for example an
 * "amorphous" or "incorporeal" trait) can be registered with a factor below 1
 * to let that token use a narrower gap.
 * @type {Map<string, {factor: number}>}
 */
const passageExceptions = new Map();

/**
 * Register a token-tag passage exception.
 * @param {string} tag Tag name as it appears on the token or actor.
 * @param {number} factor Clearance factor in (0, 1]. 0.5 lets the token use a gap half its size.
 * @returns {boolean}
 */
export function registerPassageException(tag, factor) {
  const name = String(tag ?? "").trim();
  const value = Number(factor);
  if (!name || !Number.isFinite(value) || value <= 0) return false;
  passageExceptions.set(name, { factor: Math.min(1, value) });
  return true;
}

/** @param {string} tag */
export function clearPassageException(tag) {
  return passageExceptions.delete(String(tag ?? "").trim());
}

/** @returns {Record<string, {factor: number}>} */
export function listPassageExceptions() {
  return Object.fromEntries(passageExceptions);
}

/**
 * Collect token tags from the document and actor. Supports a future core
 * `document.tags` collection as well as module flags on either document.
 * @param {object} token
 * @returns {string[]}
 */
export function getTokenTags(token) {
  const tags = new Set();
  const add = (value) => {
    if (value == null) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) tags.add(trimmed);
      return;
    }
    if (typeof value[Symbol.iterator] === "function") {
      for (const entry of value) add(entry);
      return;
    }
    if (typeof value === "object") {
      for (const entry of Object.keys(value)) add(entry);
    }
  };

  const document = token?.document;
  const actor = token?.actor;
  add(document?.tags);
  try {
    add(document?.getFlag?.(MODULE_ID, "tags"));
  } catch {
    // Flags are optional.
  }
  add(document?.flags?.[MODULE_ID]?.tags);
  try {
    add(actor?.getFlag?.(MODULE_ID, "tags"));
  } catch {
    // Flags are optional.
  }
  add(actor?.flags?.[MODULE_ID]?.tags);
  return [...tags];
}

/**
 * Resolve the D&D 5e size category used for the per-size gap override.
 * Foundry's token dimensions cannot distinguish Small from Medium (both are
 * usually one square), so the actor's `system.traits.size` is authoritative.
 * A footprint fallback keeps non-dnd5e tokens working.
 *
 * @param {object} token
 * @param {object | null} [scene]
 * @returns {string} One of GAP_CLEARANCE.buckets.
 */
export function getTokenSizeKey(token, scene = null) {
  const actor = token?.actor ?? token?.document?.actor;
  const rawSize = String(actor?.system?.traits?.size ?? "").toLowerCase().trim();
  const mapped = GAP_CLEARANCE.actorSizes[rawSize];
  if (mapped) return mapped;

  const { width, height } = getTokenSizePixels(token, scene);
  const sizePx = gridSize(scene ?? globalThis.canvas?.scene);
  const squares = Math.max(width, height) / Math.max(1, sizePx);
  if (squares <= 0.5) return "tiny";
  if (squares >= 4) return "gargantuan";
  if (squares >= 3) return "huge";
  if (squares >= 2) return "large";
  return "medium";
}

/**
 * Passage profile for a token: physical body size, the gap clearance ratio
 * (global default plus per-size override), and registered tag exceptions. A
 * `knkrPathingPassageProfile` hook may adjust the profile for future tag rules
 * implemented by other modules.
 *
 * @param {object} token
 * @param {object | null} scene
 * @param {object | null} [runtime] Settings snapshot from readRuntimeSettings().
 * @returns {{
 *   radius: number,
 *   baseRadius: number,
 *   diameter: number,
 *   passageRadius: number,
 *   passageDiameter: number,
 *   factor: number,
 *   gapRatio: number,
 *   gapRatioSource: string,
 *   sizeKey: string,
 *   tags: string[],
 *   appliedTags: string[]
 * }}
 */
export function getPassageProfile(token, scene, runtime = null) {
  // Use the token's actual pixel footprint, not a manually reconstructed
  // width * grid constant. Foundry already owns the conversion and it stays
  // correct for unusual grid sizes and token shapes.
  const { width: widthPx, height: heightPx } = getTokenSizePixels(token, scene);
  const gapSettings = runtime ?? readGapClearanceSettings();
  const profile = resolvePassageProfile({
    widthPx,
    heightPx,
    tags: getTokenTags(token),
    exceptions: listPassageExceptions(),
    gapRatio: gapSettings.gapClearance,
    gapRatioOverrides: gapSettings.gapClearanceOverrides,
    sizeKey: getTokenSizeKey(token, scene)
  });

  try {
    globalThis.Hooks?.call?.("knkrPathingPassageProfile", token, profile);
  } catch (error) {
    console.warn("Knkr03's pathing | a passage profile hook failed", error);
  }

  if (!Number.isFinite(profile.radius) || profile.radius <= 0) profile.radius = profile.baseRadius;
  if (!Number.isFinite(profile.passageRadius) || profile.passageRadius <= 0) {
    profile.passageRadius = profile.radius * (profile.gapRatio ?? GAP_CLEARANCE.defaultRatio);
  }
  profile.passageRadius = Math.min(profile.radius, profile.passageRadius);
  profile.diameter = profile.radius * 2;
  profile.passageDiameter = profile.passageRadius * 2;
  return profile;
}

/**
 * Remaining movement reported by dnd5e-movement-limiter, in scene units.
 *
 * That module exposes only a read-only `status(token)` API; it has no clamp or
 * path hook. We therefore use its budget as a route length limit and commit a
 * truncated route, which keeps its straight-line clamp from being bypassed
 * when pathfinding reroutes around a wall. Absent, inactive, or unconstrained
 * modules return null so this module keeps its standalone behavior.
 *
 * @param {object} token
 * @returns {{remaining: number, speed: number | null, action: string | null, source: string} | null}
 */
export function getMovementLimit(token) {
  try {
    const module = globalThis.game?.modules?.get?.(MOVEMENT_LIMITER_MODULE_ID);
    if (!module || module.active === false) return null;
    const status = module.api?.status?.(token);
    if (!status || typeof status !== "object" || status.remaining == null) return null;

    const remaining = Number(status.remaining);
    if (!Number.isFinite(remaining)) return null;

    const speed = Number(status.speed);
    return {
      remaining: Math.max(0, remaining),
      speed: Number.isFinite(speed) ? speed : null,
      action: status.action == null ? null : String(status.action),
      source: MOVEMENT_LIMITER_MODULE_ID
    };
  } catch (error) {
    console.warn("Knkr03's pathing | could not read the movement budget", error);
    return null;
  }
}

/** @param {object} token */
export function getDisposition(token) {
  const value = token?.document?.disposition;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

/** @param {object} token */
export function isHiddenToken(token) {
  return Boolean(token?.document?.hidden) || getDisposition(token) === -2;
}

/**
 * Build the eligible enemy list for a moving token.
 * @param {object} movingToken
 * @param {object | null} scene
 * @param {object} runtime Settings snapshot.
 * @returns {Array<{id: string, center: Point, radius: number, disposition: number, hidden: boolean}>}
 */
export function getEnemies(movingToken, scene, runtime) {
  const placeables = globalThis.canvas?.tokens?.placeables ?? [];
  const candidates = [];

  for (const token of placeables) {
    if (!token || token === movingToken) continue;
    if (token.id === movingToken?.id) continue;
    const center = getTokenCenter(token);
    if (!center) continue;
    const profile = getPassageProfile(token, scene, runtime);
    candidates.push({
      id: String(token.id),
      center,
      radius: profile.radius,
      disposition: getDisposition(token),
      hidden: isHiddenToken(token)
    });
  }

  const filtered = filterEnemies(candidates, {
    policy: runtime.enemyPolicy,
    includeHidden: runtime.includeHiddenEnemies
  });

  return filtered.map((candidate) => ({
    id: candidate.id,
    center: candidate.center,
    radius: candidate.radius
  }));
}

/**
 * Cursor position in canvas coordinates.
 * @param {object} [event]
 * @returns {Point}
 */
export function getCursorPoint(event) {
  // The event's own pointer position is the least stale source. The canvas
  // mousePosition global is updated on the same pointer event in Foundry, but
  // another module may have moved or throttled the drag before us.
  const global = event?.global;
  if (global && Number.isFinite(global.x) && Number.isFinite(global.y)) {
    return { x: global.x, y: global.y };
  }
  const mouse = globalThis.canvas?.mousePosition;
  if (mouse && Number.isFinite(mouse.x) && Number.isFinite(mouse.y)) {
    return { x: mouse.x, y: mouse.y };
  }
  return { x: 0, y: 0 };
}

/**
 * Movement action configured on the token, normalized to a string id.
 * Foundry validates committed waypoint actions against
 * CONFIG.Token.movement.actions.
 * @param {object} token
 * @returns {string}
 */
export function getMovementAction(token) {
  let action = token?.document?.movementAction ?? "walk";
  if (action && typeof action === "object") {
    action = action.id ?? action.type ?? action.key ?? "walk";
  }
  return String(action);
}
