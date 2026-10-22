/**
 * AI notice: created with AI assistance (Freebuff / Codebuff). See NOTICE.md.
 *
 * Transient canvas overlay. The renderer is a pure consumer of a planner result:
 * it performs no geometry or collision work. It attaches to canvas.interface
 * after canvasReady and is destroyed on canvasTearDown.
 */

import { getCanvasInterface } from "../compat.mjs";

const COLORS = Object.freeze({
  normal: 0x48c8ff,
  limited: 0xffc857,
  blocked: 0xff5555,
  contact: 0xff7a7a,
  waypoint: 0xdff4ff,
  label: 0xffffff,
  labelBad: 0xff9a9a
});

function localize(key, fallback) {
  try {
    const value = globalThis.game?.i18n?.localize(key);
    return value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

function formatNumber(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isFinite(rounded) ? String(rounded) : "0";
}

/** Draw a stroked path using PIXI 7 or PIXI 8 APIs. */
function stroke(graphics, width, color, alpha, drawPath) {
  if (typeof graphics.lineStyle === "function") {
    graphics.lineStyle(width, color, alpha);
    drawPath(graphics);
    return;
  }
  drawPath(graphics);
  graphics.stroke({ width, color, alpha });
}

/** Draw a filled circle using PIXI 7 or PIXI 8 APIs. */
function fillCircle(graphics, x, y, radius, color, alpha = 1) {
  if (typeof graphics.beginFill === "function") {
    if (radius <= 0) return;
    graphics.beginFill(color, alpha);
    graphics.drawCircle(x, y, radius);
    graphics.endFill();
    return;
  }
  if (radius <= 0) return;
  if (typeof graphics.circle === "function") graphics.circle(x, y, radius);
  else graphics.drawCircle(x, y, radius);
  graphics.fill({ color, alpha });
}

/** Draw a stroked circle using PIXI 7 or PIXI 8 APIs. */
function strokeCircle(graphics, x, y, radius, width, color, alpha = 1) {
  if (radius <= 0) return;
  stroke(graphics, width, color, alpha, (target) => {
    if (typeof target.circle === "function") target.circle(x, y, radius);
    else target.drawCircle(x, y, radius);
  });
  graphics.finishPoly?.();
}

/**
 * Stroke a whole polyline in one style. Committing the path explicitly avoids
 * leaving the final segment pending in PIXI's current path until the next
 * style change or render.
 */
function strokePolyline(graphics, points, width, color, alpha = 1) {
  if (!Array.isArray(points) || points.length < 2) return;
  // Drop repeated points: a degenerate subpath can corrupt a batched stroke.
  const path = [];
  for (const point of points) {
    const previous = path.at(-1);
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.01) continue;
    path.push(point);
  }
  if (path.length < 2) return;
  stroke(graphics, width, color, alpha, (target) => {
    target.moveTo(path[0].x, path[0].y);
    for (const point of path.slice(1)) target.lineTo(point.x, point.y);
  });
  graphics.finishPoly?.();
}

/**
 * Whether a plan moved away from its origin. Used to avoid placing a terminal
 * marker on a blocked plan that has no legal movement at all.
 * @param {object} plan
 * @param {{x: number, y: number}} endpoint
 */
function movedFromStart(plan, endpoint) {
  const start = plan.start;
  if (!start || !Number.isFinite(start.x) || !Number.isFinite(start.y)) return true;
  return Math.hypot(endpoint.x - start.x, endpoint.y - start.y) > 1;
}

/**
 * Stroke a set of disjoint segments in one style. A single style change for
 * the whole set keeps PIXI's batched stroke state consistent.
 */
function strokeSegments(graphics, segments, width, color, alpha = 1) {
  if (!segments.length) return;
  stroke(graphics, width, color, alpha, (target) => {
    for (const segment of segments) {
      target.moveTo(segment.a.x, segment.a.y);
      target.lineTo(segment.b.x, segment.b.y);
    }
  });
  graphics.finishPoly?.();
}

export class PreviewRenderer {
  constructor() {
    this.container = null;
    this.graphics = null;
    this.label = null;
  }

  /** @returns {boolean} */
  attach() {
    const pixi = globalThis.PIXI;
    const parent = getCanvasInterface();
    if (!pixi?.Container || !pixi?.Graphics || !parent) return false;

    // A canvas re-render can replace the interface group without a teardown
    // hook. Re-parent the existing overlay instead of drawing into a detached
    // container (which would show no path).
    if (this.container) {
      if (this.container.parent !== parent) {
        try {
          parent.addChild(this.container);
        } catch {
          this.detach();
          return false;
        }
      }
      return true;
    }

    try {
      this.container = new pixi.Container();
      this.container.name = "knkr-pathing-preview";
      this.container.zIndex = 950;
      this.container.interactive = false;
      this.container.eventMode = "none";
      this.container.sortableChildren = false;

      this.graphics = new pixi.Graphics();
      this.graphics.interactive = false;

      this.label = new pixi.Text("", {
        fontFamily: "Signika, sans-serif",
        fontSize: 16,
        fill: COLORS.label,
        stroke: 0x000000,
        strokeThickness: 3,
        align: "left"
      });
      this.label.visible = false;
      this.label.interactive = false;

      this.container.addChild(this.graphics);
      this.container.addChild(this.label);
      parent.addChild(this.container);
      return true;
    } catch (error) {
      console.warn("Knkr03's pathing | failed to attach the preview overlay", error);
      this.detach();
      return false;
    }
  }

  detach() {
    try {
      this.container?.parent?.removeChild(this.container);
      this.container?.destroy?.({ children: true });
    } catch (error) {
      console.warn("Knkr03's pathing | failed to detach the preview overlay", error);
    }
    this.container = null;
    this.graphics = null;
    this.label = null;
  }

  clear() {
    try {
      this.graphics?.clear();
    } catch {
      // Rendering must never break a drag.
    }
    if (this.label) this.label.visible = false;
  }

  /**
   * Draw a complete frame.
   * @param {object | null} plan
   * @param {object} context
   */
  draw(plan, context = {}) {
    if (!this.attach()) return;
    this.clear();
    if (!plan || !this.graphics) return;

    this.drawPath(plan);
    this.drawIndicators(plan, context);
    this.drawLabel(plan, context);
  }

  /** @param {object} plan */
  drawPath(plan) {
    const points = Array.isArray(plan.points)
      ? plan.points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      : [];
    const segments = Array.isArray(plan.segments)
      ? plan.segments.filter((segment) =>
        Number.isFinite(segment?.a?.x) && Number.isFinite(segment?.a?.y)
        && Number.isFinite(segment?.b?.x) && Number.isFinite(segment?.b?.y))
      : [];

    // Always draw the route from its polyline first. Some plans (rotation) have
    // no costed segments, and a stale or partial segment list must never leave
    // the user with dots and no line.
    const routeColor = plan.status === "limited" ? COLORS.limited : COLORS.normal;
    if (points.length > 1) {
      strokePolyline(this.graphics, points, 8, 0x000000, 0.35);
      strokePolyline(this.graphics, points, 4.5, routeColor, 0.95);
    } else if (segments.length > 0) {
      strokeSegments(this.graphics, segments, 8, 0x000000, 0.35);
      strokeSegments(this.graphics, segments, 4.5, routeColor, 0.95);
    }

    // Overlay blocked segments in one pass so a partially valid route still
    // shows which portion is illegal.
    const blocked = segments.filter((segment) => segment.mode === "blocked");
    if (blocked.length > 0) strokeSegments(this.graphics, blocked, 4.5, COLORS.blocked, 0.95);

    // Waypoint dots make bends legible without cluttering the line.
    if (points.length > 2) {
      for (const point of points.slice(1, -1)) {
        fillCircle(this.graphics, point.x, point.y, 3.2, COLORS.waypoint, 0.9);
      }
    }
  }

  /** @param {object} plan @param {object} context */
  drawIndicators(plan, context) {
    const endpoint = plan.endpoint ?? plan.points?.[plan.points.length - 1];

    if (plan.status === "impassable" && plan.goal) {
      const { x, y } = plan.goal;
      stroke(this.graphics, 3.5, COLORS.blocked, 0.95, (graphics) => {
        graphics.moveTo(x - 9, y - 9);
        graphics.lineTo(x + 9, y + 9);
        graphics.moveTo(x + 9, y - 9);
        graphics.lineTo(x - 9, y + 9);
      });
    }

    if (endpoint) {
      if (plan.rotation) {
        strokeCircle(this.graphics, endpoint.x, endpoint.y, 9, 3, COLORS.contact, 0.95);
      } else if (plan.status === "contact") {
        strokeCircle(this.graphics, endpoint.x, endpoint.y, 9, 3, COLORS.contact, 0.95);
      } else if (plan.status !== "impassable" || movedFromStart(plan, endpoint)) {
        // A blocked plan still has a potential stopping point. Mark it the same
        // way as a normal route endpoint while the red X continues to show the
        // unreachable destination.
        fillCircle(this.graphics, endpoint.x, endpoint.y, 4, 0xffffff, 0.95);
      }
    }
  }

  /** @param {object} plan @param {object} context */
  drawLabel(plan, context) {
    if (!this.label || context.showDistanceLabel === false) return;

    const units = context.units ?? "ft";
    const distance = formatNumber(plan.totalDistance);
    const status = this.statusLabel(plan);
    const template = localize("KNKR_PATHING.Preview.Distance", "{distance} {units}");

    let text = template
      .replaceAll("{distance}", distance)
      .replaceAll("{units}", units);

    if (status) text = `${status} · ${text}`;
    if (!text) return;

    this.label.text = text;
    this.label.style.fill = plan.status === "impassable" || plan.status === "contact"
      ? COLORS.labelBad
      : (plan.status === "limited" ? COLORS.limited : COLORS.label);
    this.label.visible = true;

    const endpoint = plan.endpoint ?? plan.points?.[plan.points.length - 1] ?? { x: 0, y: 0 };
    let x = endpoint.x + 16;
    let y = endpoint.y - 30;
    const viewWidth = Number(globalThis.canvas?.dimensions?.width) || 0;
    if (viewWidth > 0 && x + this.label.width > viewWidth - 8) {
      x = Math.max(8, endpoint.x - this.label.width - 16);
    }
    y = Math.max(8, y);
    this.label.position.set(x, y);
  }

  /** @param {object} plan */
  statusLabel(plan) {
    if (plan.status === "impassable") {
      const endpoint = plan.endpoint ?? plan.points?.[plan.points.length - 1];
      if (endpoint && movedFromStart(plan, endpoint)) {
        return localize("KNKR_PATHING.Preview.Potential", "Potential move");
      }
      return localize("KNKR_PATHING.Preview.Blocked", "Blocked");
    }
    if (plan.status === "contact") return localize("KNKR_PATHING.Preview.Contact", "Enemy contact");
    if (plan.status === "limited") return localize("KNKR_PATHING.Preview.Limited", "Movement limit");
    return "";
  }
}
