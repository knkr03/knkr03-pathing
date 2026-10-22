/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Settings registration and typed accessors. All reads fall back to defaults
 * when Foundry is unavailable or a setting has not been registered yet.
 */

import { DEFAULTS, ENEMY_POLICY, GAP_CLEARANCE, MODULE_ID, SETTING_KEYS } from "./constants.mjs";

const SIZE_LABELS = Object.freeze({
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  huge: "Huge",
  gargantuan: "Gargantuan"
});

function localize(key) {
  try {
    return globalThis.game?.i18n?.localize(key) ?? key;
  } catch {
    return key;
  }
}

/** Register all module settings. Call during the init hook. */
export function registerSettings() {
  const settings = globalThis.game?.settings;
  if (!settings) return;

  const register = (key, options) => {
    try {
      settings.register(MODULE_ID, key, options);
    } catch (error) {
      console.warn(`Knkr03's pathing | failed to register setting "${key}"`, error);
    }
  };

  register(SETTING_KEYS.enabled, {
    name: localize("KNKR_PATHING.Settings.Enabled.Name"),
    hint: localize("KNKR_PATHING.Settings.Enabled.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: DEFAULTS.enabled,
    onChange: () => globalThis.Hooks?.callAll("knkrPathingSettingsChanged")
  });

  register(SETTING_KEYS.gapClearance, {
    name: localize("KNKR_PATHING.Settings.GapClearance.Name"),
    hint: localize("KNKR_PATHING.Settings.GapClearance.Hint"),
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.gapClearance,
    range: { min: 0.1, max: 1, step: 0.05 },
    onChange: () => globalThis.Hooks?.callAll("knkrPathingSettingsChanged")
  });

  for (const bucket of GAP_CLEARANCE.buckets) {
    const label = SIZE_LABELS[bucket] ?? bucket;
    register(GAP_CLEARANCE.settings[bucket], {
      name: localize(`KNKR_PATHING.Settings.GapClearance.${label}.Name`),
      hint: localize("KNKR_PATHING.Settings.GapClearance.OverrideHint"),
      scope: "world",
      config: true,
      type: Number,
      default: DEFAULTS[GAP_CLEARANCE.settings[bucket]] ?? 0,
      range: { min: 0, max: 1, step: 0.05 },
      onChange: () => globalThis.Hooks?.callAll("knkrPathingSettingsChanged")
    });
  }

  register(SETTING_KEYS.enemyPolicy, {
    name: localize("KNKR_PATHING.Settings.EnemyPolicy.Name"),
    hint: localize("KNKR_PATHING.Settings.EnemyPolicy.Hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [ENEMY_POLICY.hostile]: localize("KNKR_PATHING.Settings.EnemyPolicy.Hostile"),
      [ENEMY_POLICY.hostileNeutral]: localize("KNKR_PATHING.Settings.EnemyPolicy.HostileNeutral"),
      [ENEMY_POLICY.nonFriendly]: localize("KNKR_PATHING.Settings.EnemyPolicy.NonFriendly")
    },
    default: DEFAULTS.enemyPolicy
  });

  register(SETTING_KEYS.includeHiddenEnemies, {
    name: localize("KNKR_PATHING.Settings.IncludeHidden.Name"),
    hint: localize("KNKR_PATHING.Settings.IncludeHidden.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULTS.includeHiddenEnemies
  });

  register(SETTING_KEYS.showDistanceLabel, {
    name: localize("KNKR_PATHING.Settings.ShowDistanceLabel.Name"),
    hint: localize("KNKR_PATHING.Settings.ShowDistanceLabel.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: DEFAULTS.showDistanceLabel
  });

  register(SETTING_KEYS.debug, {
    name: localize("KNKR_PATHING.Settings.Debug.Name"),
    hint: localize("KNKR_PATHING.Settings.Debug.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: DEFAULTS.debug
  });
}

/**
 * Read a setting with a default fallback.
 * @param {string} key
 * @returns {boolean | number | string}
 */
export function getSetting(key) {
  try {
    const value = globalThis.game?.settings?.get(MODULE_ID, key);
    return value ?? DEFAULTS[key];
  } catch {
    return DEFAULTS[key];
  }
}

/**
 * Current gap-clearance settings. Per-size values of 0 mean "inherit the
 * default" and are omitted from the override map.
 * @returns {{gapClearance: number, gapClearanceOverrides: Record<string, number>}}
 */
export function readGapClearanceSettings() {
  const gapClearance = Number(getSetting(SETTING_KEYS.gapClearance));
  const gapClearanceOverrides = {};
  for (const bucket of GAP_CLEARANCE.buckets) {
    const value = Number(getSetting(GAP_CLEARANCE.settings[bucket]));
    if (Number.isFinite(value) && value > 0) gapClearanceOverrides[bucket] = value;
  }
  return {
    gapClearance: Number.isFinite(gapClearance) && gapClearance > 0
      ? gapClearance
      : DEFAULTS.gapClearance,
    gapClearanceOverrides
  };
}

/**
 * Snapshot of all runtime settings used by a drag.
 * @param {object | null} scene
 * @param {number} unitsPerPixelValue
 */
export function readRuntimeSettings(scene, unitsPerPixelValue) {
  const safeUnitsPerPixel = Number(unitsPerPixelValue) > 0 ? Number(unitsPerPixelValue) : 0.05;

  return {
    enabled: Boolean(getSetting(SETTING_KEYS.enabled)),
    ...readGapClearanceSettings(),
    enemyPolicy: String(getSetting(SETTING_KEYS.enemyPolicy) ?? DEFAULTS.enemyPolicy),
    includeHiddenEnemies: Boolean(getSetting(SETTING_KEYS.includeHiddenEnemies)),
    showDistanceLabel: Boolean(getSetting(SETTING_KEYS.showDistanceLabel)),
    debug: Boolean(getSetting(SETTING_KEYS.debug)),
    unitsPerPixel: safeUnitsPerPixel,
    scene: scene?.id ?? null
  };
}

/** @param {...unknown} args */
export function debugLog(...args) {
  try {
    if (getSetting(SETTING_KEYS.debug)) console.debug("Knkr03's pathing |", ...args);
  } catch {
    // Logging must never break a drag.
  }
}
