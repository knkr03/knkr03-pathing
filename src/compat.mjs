/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Foundry compatibility detection. Everything here is defensive: the module
 * disables itself with a clear reason rather than falling back to behavior that
 * permits illegal movement.
 */

import { REQUIRED_FOUNDRY_GENERATION, TARGET_FOUNDRY_GENERATIONS } from "./constants.mjs";

/** @returns {number} Major version of the running Foundry build, or 0. */
export function foundryGeneration() {
  const version = globalThis.game?.version ?? globalThis.game?.release?.version ?? "";
  const parsed = Number.parseInt(String(version), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** @returns {string} */
export function foundryVersion() {
  return String(globalThis.game?.version ?? globalThis.game?.release?.version ?? "unknown");
}

/** @returns {string} */
export function systemId() {
  return String(globalThis.game?.system?.id ?? "");
}

/** @returns {string} */
export function systemVersion() {
  return String(globalThis.game?.system?.version ?? globalThis.game?.system?.data?.version ?? "unknown");
}

/**
 * The token placeable class across v13/v14 namespaces, with a global fallback.
 * @returns {Function | null}
 */
export function getTokenClass() {
  const namespaced = globalThis.foundry?.canvas?.placeables?.Token;
  if (typeof namespaced === "function") return namespaced;
  return typeof globalThis.Token === "function" ? globalThis.Token : null;
}

/**
 * Required token drag methods for the v13+ clone-based drag workflow. Missing
 * any of them disables the module rather than half-installing it.
 */
export const REQUIRED_TOKEN_METHODS = Object.freeze([
  "_initializeDragLeft",
  "_updateDragDestination",
  "_prepareDragLeftDropUpdates",
  "_finalizeDragLeft"
]);

/**
 * @returns {{
 *   ok: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   details: object
 * }}
 */
export function checkCompatibility() {
  const errors = [];
  const warnings = [];
  const generation = foundryGeneration();
  const version = foundryVersion();
  const tokenClass = getTokenClass();
  const missingMethods = [];

  if (!globalThis.game) {
    errors.push("Foundry's game global is unavailable.");
  } else if (!globalThis.canvas) {
    errors.push("Foundry's canvas is unavailable.");
  }

  if (!generation) {
    errors.push(`Could not determine the Foundry version (reported "${version}").`);
  } else if (generation < REQUIRED_FOUNDRY_GENERATION) {
    errors.push(`Foundry v${REQUIRED_FOUNDRY_GENERATION} or newer is required; this world runs v${version}.`);
  } else if (generation > Math.max(...TARGET_FOUNDRY_GENERATIONS)) {
    warnings.push(`Foundry v${version} is newer than the tested targets (${TARGET_FOUNDRY_GENERATIONS.join(", ")}). Core token drag APIs may have changed.`);
  }

  if (!tokenClass) {
    errors.push("The Token placeable class could not be found.");
  } else {
    for (const method of REQUIRED_TOKEN_METHODS) {
      if (typeof tokenClass.prototype?.[method] !== "function") missingMethods.push(method);
    }
    if (missingMethods.length > 0) {
      errors.push(`Token drag methods are unavailable: ${missingMethods.join(", ")}.`);
    }
  }

  if (systemId() && systemId() !== "dnd5e") {
    warnings.push(`The active system is "${systemId()}", not dnd5e. Wall and enemy collision still work, but the manifest targets dnd5e.`);
  }

  if (!globalThis.PIXI?.Graphics) {
    warnings.push("PIXI Graphics is unavailable; the path preview will not be drawn.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    details: {
      foundry: version,
      generation,
      system: systemId(),
      systemVersion: systemVersion(),
      tokenClass: tokenClass?.name ?? null,
      missingMethods,
      targets: [...TARGET_FOUNDRY_GENERATIONS]
    }
  };
}

/**
 * Whether a scene is gridless. Uses the grid accessor when present and falls
 * back to the symbolic grid type.
 * @param {object | null} scene
 * @returns {boolean}
 */
export function isGridlessScene(scene) {
  const grid = scene?.grid;
  if (!grid) return false;
  if (grid.isGridless === true) return true;
  const gridlessType = globalThis.CONST?.GRID_TYPES?.GRIDLESS;
  return gridlessType !== undefined && grid.type === gridlessType;
}

/**
 * Scene units represented by one pixel.
 * @param {object | null} scene
 * @returns {number}
 */
export function unitsPerPixel(scene) {
  const grid = scene?.grid ?? globalThis.canvas?.grid;
  const size = Number(grid?.size) || 100;
  const distance = Number(grid?.distance) || 5;
  return distance / size;
}

/**
 * The scene's measurement unit label (for example "ft").
 * @param {object | null} scene
 * @returns {string}
 */
export function sceneUnits(scene) {
  return String(scene?.grid?.units ?? globalThis.canvas?.grid?.units ?? "ft");
}

/**
 * Grid size in pixels.
 * @param {object | null} scene
 * @returns {number}
 */
export function gridSize(scene) {
  const grid = scene?.grid ?? globalThis.canvas?.grid;
  return Number(grid?.size ?? grid?.sizeX ?? globalThis.canvas?.grid?.size) || 100;
}

/**
 * Container used for transient module graphics.
 * @returns {object | null}
 */
export function getCanvasInterface() {
  return globalThis.canvas?.interface ?? globalThis.canvas?.stage ?? null;
}
