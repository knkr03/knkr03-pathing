/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Knkr03's pathing entry point.
 *
 * Foundry hook lifecycle:
 *  - init: register settings and the keybinding.
 *  - ready: verify compatibility, install the drag controller, wire lifecycle hooks.
 *  - canvasReady / canvasTearDown: attach and destroy the preview overlay.
 *  - wall and token document hooks: invalidate caches and replan the active drag.
 */

import { MODULE_ID, SETTING_KEYS } from "./constants.mjs";
import { debugLog, getSetting, registerSettings } from "./settings.mjs";
import { checkCompatibility, isGridlessScene } from "./compat.mjs";
import { planMovement } from "./core/planner.mjs";
import { DragController } from "./foundry/drag-controller.mjs";
import { PreviewRenderer } from "./foundry/preview.mjs";
import {
  WallCache,
  clearPassageException,
  listPassageExceptions,
  registerPassageException
} from "./foundry/adapters.mjs";

const preview = new PreviewRenderer();
const wallCache = new WallCache();

let controller = null;
let compatibility = null;
let installed = false;

function localize(key) {
  try {
    return globalThis.game?.i18n?.localize(key) ?? key;
  } catch {
    return key;
  }
}

function notifyError(message) {
  try {
    globalThis.ui?.notifications?.error(message, { permanent: true });
  } catch {
    // Notifications are best-effort.
  }
  console.error("Knkr03's pathing |", message);
}

function registerKeybinding() {
  const keybindings = globalThis.game?.keybindings;
  if (!keybindings) return;

  try {
    keybindings.register(MODULE_ID, "toggle", {
      name: localize("KNKR_PATHING.Keybindings.Toggle.Name"),
      hint: localize("KNKR_PATHING.Keybindings.Toggle.Hint"),
      editable: [],
      restricted: false,
      onDown: () => {
        const enabled = !getSetting(SETTING_KEYS.enabled);
        globalThis.game?.settings?.set(MODULE_ID, SETTING_KEYS.enabled, enabled).catch(() => {});
        try {
          globalThis.ui?.notifications?.info(
            localize(enabled ? "KNKR_PATHING.Notifications.ToggledOn" : "KNKR_PATHING.Notifications.ToggledOff")
          );
        } catch {
          // Ignore notification failures.
        }
        return true;
      }
    });
  } catch (error) {
    console.warn("Knkr03's pathing | failed to register the toggle keybinding", error);
  }
}

function wireLifecycleHooks() {
  Hooks.on("canvasReady", () => {
    wallCache.invalidate();
    controller?.invalidate();
    preview.attach();
    debugLog("canvas ready", { gridless: isGridlessScene(globalThis.canvas?.scene) });
  });

  Hooks.on("canvasTearDown", () => {
    controller?.endSession();
    preview.detach();
    wallCache.invalidate();
  });

  for (const hook of ["createWall", "updateWall", "deleteWall"]) {
    Hooks.on(hook, () => {
      controller?.invalidate();
    });
  }

  Hooks.on("updateScene", (scene) => {
    if (scene?.id && scene.id === globalThis.canvas?.scene?.id) {
      controller?.invalidate();
    }
  });

  Hooks.on("updateToken", (token) => {
    const session = controller?.session;
    if (!session) return;
    if (String(token?.id) === String(session.token?.id)) return;
    session.forceReplan = true;
  });

  Hooks.on("knkrPathingSettingsChanged", () => {
    if (!getSetting(SETTING_KEYS.enabled)) controller?.endSession();
  });
}

function exposeApi() {
  const module = globalThis.game?.modules?.get(MODULE_ID);
  if (!module) return;

  module.api = {
    version: module.version,
    compat: compatibility,
    plan: planMovement,
    registerPassageException,
    clearPassageException,
    listPassageExceptions,
    diagnostics: () => ({
      compat: compatibility,
      installed,
      scene: globalThis.canvas?.scene?.id ?? null,
      gridless: isGridlessScene(globalThis.canvas?.scene),
      walls: wallCache.get(globalThis.canvas?.scene).length,
      activeDrag: Boolean(controller?.session),
      movement: controller?.session?.action ?? null,
      movementBudget: controller?.session?.movementLimit ?? null,
      bodyRadius: controller?.session?.radius ?? null,
      passageRadius: controller?.session?.passageRadius ?? null,
      gapClearance: controller?.session?.passage?.gapRatio ?? null,
      tokenSize: controller?.session?.passage?.sizeKey ?? null,
      passageTags: controller?.session?.passage?.appliedTags ?? [],
      passageExceptions: listPassageExceptions()
    })
  };
}

Hooks.once("init", () => {
  registerSettings();
  registerKeybinding();
});

Hooks.once("ready", () => {
  compatibility = checkCompatibility();

  if (!compatibility.ok) {
    notifyError(
      `${localize("KNKR_PATHING.Notifications.IncompatibleTitle")}: ${compatibility.errors.join(" ")}`
    );
    exposeApi();
    return;
  }

  for (const warning of compatibility.warnings) {
    console.warn("Knkr03's pathing |", warning);
  }
  if (compatibility.warnings.length > 0) {
    try {
      globalThis.ui?.notifications?.warn(
        `${localize("KNKR_PATHING.Notifications.IncompatibleTitle")}: ${compatibility.warnings[0]}`,
        { console: false }
      );
    } catch {
      // Notifications are best-effort.
    }
  }

  controller = new DragController({ preview, wallCache });
  installed = controller.install();
  if (!installed) {
    notifyError(
      localize("KNKR_PATHING.Notifications.Incompatible").replace(
        "{reason}",
        "the token drag methods could not be wrapped"
      )
    );
    exposeApi();
    return;
  }

  wireLifecycleHooks();
  exposeApi();

  if (globalThis.canvas?.ready) {
    wallCache.invalidate();
    preview.attach();
  }

  debugLog("ready", compatibility.details);
});

// The public API remains available for troubleshooting even if the module
// disabled itself, so a GM can inspect why from the console.
exposeApi();
