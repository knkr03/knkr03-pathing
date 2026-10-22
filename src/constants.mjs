/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Shared constants for Knkr03's pathing. This module is safe to import outside Foundry.
 */

export const MODULE_ID = "knkr-pathing";
export const MODULE_TITLE = "Knkr03's pathing";
export const REQUIRED_FOUNDRY_GENERATION = 13;
export const TARGET_FOUNDRY_GENERATIONS = [13, 14];

/** Foundry setting keys. */
export const SETTING_KEYS = Object.freeze({
  enabled: "enabled",
  gapClearance: "gapClearance",
  enemyPolicy: "enemyPolicy",
  includeHiddenEnemies: "includeHiddenEnemies",
  showDistanceLabel: "showDistanceLabel",
  debug: "debug"
});

/**
 * Gap clearance settings. A gap is passable when its measured width is at
 * least the token's footprint width multiplied by the resolved ratio.
 *
 * The default applies to every size. Each D&D 5e size category can override
 * it; 0 means "use the default".
 */
export const GAP_CLEARANCE = Object.freeze({
  defaultRatio: 0.75,
  buckets: Object.freeze(["tiny", "small", "medium", "large", "huge", "gargantuan"]),
  settings: Object.freeze({
    tiny: "gapClearanceTiny",
    small: "gapClearanceSmall",
    medium: "gapClearanceMedium",
    large: "gapClearanceLarge",
    huge: "gapClearanceHuge",
    gargantuan: "gapClearanceGargantuan"
  }),
  /** D&D 5e actor size codes (and long names) mapped to setting buckets. */
  actorSizes: Object.freeze({
    tiny: "tiny",
    sm: "small",
    small: "small",
    med: "medium",
    medium: "medium",
    lg: "large",
    large: "large",
    huge: "huge",
    grg: "gargantuan",
    gargantuan: "gargantuan"
  })
});

/** Default values. Keep in sync with settings.mjs and README.md. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  gapClearance: GAP_CLEARANCE.defaultRatio,
  gapClearanceTiny: 0,
  gapClearanceSmall: 0,
  gapClearanceMedium: 0,
  gapClearanceLarge: 0,
  gapClearanceHuge: 0,
  gapClearanceGargantuan: 0,
  enemyPolicy: "hostile",
  includeHiddenEnemies: false,
  showDistanceLabel: true,
  debug: false
});

/** Planner status values. */
export const PLAN_STATUS = Object.freeze({
  normal: "normal",
  limited: "limited",
  contact: "contact",
  impassable: "impassable"
});

/** Enemy collision policies. */
export const ENEMY_POLICY = Object.freeze({
  hostile: "hostile",
  hostileNeutral: "hostile-neutral",
  nonFriendly: "non-friendly"
});

/** Foundry token dispositions (numeric fallbacks used when CONST is unavailable). */
export const TOKEN_DISPOSITION = Object.freeze({
  secret: -2,
  hostile: -1,
  neutral: 0,
  friendly: 1
});

/** Wall enums (numeric fallbacks; adapters prefer Foundry CONST values). */
export const WALL_MOVEMENT = Object.freeze({ none: 0, normal: 1, double: 2, limited: 3 });
export const WALL_DOOR = Object.freeze({ none: 0, door: 1, secret: 2 });
export const WALL_DOOR_STATE = Object.freeze({ closed: 0, open: 1, locked: 2 });

/** Geometry tolerance in canvas pixels. */
export const GEOMETRY_EPSILON = 0.5;

/**
 * Clearance tolerance in canvas pixels. This is deliberately much smaller than
 * the layout epsilon: a gap is measured against the token's actual size, not a
 * padded approximation of it. The value only absorbs floating-point noise.
 */
export const CLEARANCE_EPSILON = 0.01;

/** Drag replanning threshold in canvas pixels. */
export const REPLAN_THRESHOLD = 1.5;

/** Minimum time between full replans during a drag, in milliseconds. */
export const MIN_REPLAN_INTERVAL_MS = 24;

export const SOCKET_CHANNEL = `module.${MODULE_ID}`;
