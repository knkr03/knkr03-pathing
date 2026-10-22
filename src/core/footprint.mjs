/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Token footprint and passage profile.
 *
 * A token's body clearance is derived from the larger of its actual pixel
 * dimensions. A gap is passable when its measured width reaches the token size
 * multiplied by the configured clearance ratio (0.75 by default), so a 5 ft
 * token can use a 3.75 ft gap while still keeping full wall clearance
 * everywhere outside that opening.
 *
 * Passage exceptions are a forward-compatible hook for token tags. A tag such
 * as a future "amorphous" or "incorporeal" trait can be registered with a
 * factor below 1 to let that token use a narrower gap. No exceptions are
 * registered by default.
 */

import { GAP_CLEARANCE } from "../constants.mjs";

const MIN_RADIUS = 0.5;

/**
 * @typedef {object} Footprint
 * @property {number} radius Normal clearance radius in pixels.
 * @property {number} diameter Normal diameter in pixels.
 */

/**
 * Build a footprint from actual token pixel dimensions.
 *
 * `widthPx`/`heightPx` are the token's canvas pixels (normally from
 * `TokenDocument#getSize()`). Optional texture scale is supported for callers
 * that explicitly want art-scaled clearance; the Foundry adapter does not pass
 * it, because art scaling is not the token's occupied footprint. Non-square
 * tokens use the larger half-extent so obstacles are never underestimated.
 *
 * @param {object} options
 * @param {number} options.widthPx
 * @param {number} options.heightPx
 * @param {number} [options.textureScaleX]
 * @param {number} [options.textureScaleY]
 * @param {number} [options.shapeRadiusPx] Explicit rendered circle radius, when available.
 * @returns {Footprint}
 */
export function createFootprint({
  widthPx = 100,
  heightPx = 100,
  textureScaleX = 1,
  textureScaleY = 1,
  shapeRadiusPx = null
} = {}) {
  const width = Math.abs(Number(widthPx) || 0) * Math.abs(Number(textureScaleX) || 1);
  const height = Math.abs(Number(heightPx) || 0) * Math.abs(Number(textureScaleY) || 1);
  const explicitRadius = Number(shapeRadiusPx);
  const radius = Number.isFinite(explicitRadius) && explicitRadius > 0
    ? explicitRadius
    : Math.max(MIN_RADIUS, Math.max(width, height) / 2);

  return {
    radius,
    diameter: radius * 2
  };
}

/**
 * Normalize a configured gap ratio to (0, 1]. A value outside that range is
 * treated as unset so a typo cannot make a token wider than its body or grant
 * an effectively infinite squeeze.
 *
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function normalizeGapRatio(value, fallback = GAP_CLEARANCE.defaultRatio) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const defaultNumber = Number(fallback);
    return Number.isFinite(defaultNumber) && defaultNumber > 0
      ? Math.min(1, defaultNumber)
      : GAP_CLEARANCE.defaultRatio;
  }
  return Math.min(1, number);
}

/**
 * Resolve the gap ratio for one token size. A positive per-size override wins;
 * otherwise the adjustable default applies.
 *
 * @param {object} [options]
 * @param {unknown} [options.gapRatio]
 * @param {Record<string, unknown>} [options.overrides]
 * @param {string | null} [options.sizeKey]
 * @returns {{ratio: number, source: "default" | "size", sizeKey: string | null}}
 */
export function resolveGapRatio({
  gapRatio = GAP_CLEARANCE.defaultRatio,
  overrides = {},
  sizeKey = null
} = {}) {
  const fallback = normalizeGapRatio(gapRatio);
  const key = sizeKey == null ? null : String(sizeKey).toLowerCase();
  if (!key || overrides == null || overrides[key] == null) {
    return { ratio: fallback, source: "default", sizeKey: key };
  }

  const override = Number(overrides[key]);
  if (!Number.isFinite(override) || override <= 0) {
    return { ratio: fallback, source: "default", sizeKey: key };
  }
  return { ratio: Math.min(1, override), source: "size", sizeKey: key };
}

/**
 * Normalize an exception definition to a clearance factor.
 * @param {number | {factor?: number}} exception
 * @returns {number | null} Factor in (0, 1], or null when unusable.
 */
function exceptionFactor(exception) {
  const raw = typeof exception === "number" ? exception : exception?.factor;
  const factor = Number(raw);
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return Math.min(1, factor);
}

/**
 * Resolve the clearance a token actually uses.
 *
 * `radius`/`diameter` are the token's physical wall clearance. `passageRadius`/
 * `passageDiameter` are the narrower values used only for fitting through an
 * opening. They are the same unless the gap ratio is below 1.
 *
 * When several tags grant an exception, the narrowest factor wins so a token
 * can never accidentally become wider through its tags.
 *
 * @param {object} options
 * @param {number} options.widthPx
 * @param {number} options.heightPx
 * @param {Iterable<string>} [options.tags] Tags carried by the token or actor.
 * @param {Record<string, number | {factor?: number}>} [options.exceptions]
 * @param {number} [options.textureScaleX]
 * @param {number} [options.textureScaleY]
 * @param {number} [options.shapeRadiusPx]
 * @param {unknown} [options.gapRatio] Default gap ratio for every size.
 * @param {Record<string, unknown>} [options.gapRatioOverrides] Per-size ratios.
 * @param {string | null} [options.sizeKey] Resolved D&D 5e size category.
 * @returns {{
 *   radius: number,
 *   baseRadius: number,
 *   diameter: number,
 *   passageRadius: number,
 *   passageDiameter: number,
 *   factor: number,
 *   tagFactor: number,
 *   gapRatio: number,
 *   gapRatioSource: "default" | "size",
 *   sizeKey: string | null,
 *   tags: string[],
 *   appliedTags: string[]
 * }}
 */
export function resolvePassageProfile({
  widthPx = 100,
  heightPx = 100,
  tags = [],
  exceptions = {},
  textureScaleX = 1,
  textureScaleY = 1,
  shapeRadiusPx = null,
  gapRatio = GAP_CLEARANCE.defaultRatio,
  gapRatioOverrides = {},
  sizeKey = null
} = {}) {
  const footprint = createFootprint({ widthPx, heightPx, textureScaleX, textureScaleY, shapeRadiusPx });
  const gap = resolveGapRatio({ gapRatio, overrides: gapRatioOverrides, sizeKey });
  const list = [];
  for (const tag of tags ?? []) {
    const value = String(tag ?? "").trim();
    if (value && !list.includes(value)) list.push(value);
  }

  let factor = 1;
  const appliedTags = [];
  for (const tag of list) {
    const candidate = exceptionFactor(exceptions?.[tag]);
    if (candidate == null || candidate >= factor) continue;
    factor = candidate;
    appliedTags.push(tag);
  }

  const radius = Math.max(MIN_RADIUS, footprint.radius * factor);
  const passageRadius = Math.max(0.0001, radius * gap.ratio);
  return {
    radius,
    baseRadius: footprint.radius,
    diameter: radius * 2,
    passageRadius,
    passageDiameter: passageRadius * 2,
    factor,
    tagFactor: factor,
    gapRatio: gap.ratio,
    gapRatioSource: gap.source,
    sizeKey: gap.sizeKey,
    tags: list,
    appliedTags
  };
}
