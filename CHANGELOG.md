# Changelog

> **AI notice:** This file was created with AI assistance. See [NOTICE.md](NOTICE.md).

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-22

First stable release of **Knkr03's pathing**. Live smoke-tested on Foundry 13.351 with dnd5e 5.3.3; the Foundry 14 side of the manual test matrix remains to be run.

### Renamed

- The module's display title is now **Knkr03's pathing**. The module id (`knkr-pathing`), setting keys, API namespace, and localization keys are unchanged, so existing worlds keep their configuration and an update is a drop-in replacement.
- The project moved to <https://github.com/knkr03/knkr03-pathing>; the manifest, readme, bugs, and changelog URLs point there.

### Changed

- **Breaking:** squeezing, squeeze markers, the squeeze radius, and the cost multiplier have been removed. Passage is now limited by a configurable gap clearance: by default a gap must be at least 75% of the token's width, and a narrower gap is not a valid route.
- Added **Default gap clearance** (`gapClearance`, default `0.75`) plus per-size overrides for Tiny, Small, Medium, Large, Huge, and Gargantuan. `0` means "use the default".
- Full body clearance is still enforced along ordinary walls. The reduced radius is confined to the measured opening, so a smaller gap setting cannot make tokens clip wall corners.
- Added a runtime tag-exception API (`registerPassageException`, `clearPassageException`, `listPassageExceptions`) and a `knkrPathingPassageProfile` hook so future token tags can use narrower gaps without changing the planner.
- The preview label now reports route distance; the settings key is `showDistanceLabel`.
- Dragging never maintains its own movement budget. When **D&D 5e Movement Limiter & Undo** is active, its public `status(token).remaining` value is consumed as a route-length limit; otherwise the route is unclamped.
- Passage clearance now comes from the token's actual `TokenDocument#getSize()` pixels. Texture art scale no longer changes the collision footprint.
- Rotation around an enemy commits the shorter arc from where the rotation began, so crossing the enemy or reversing direction cannot record the long way around.

### Fixed

- Drag integration now targets Foundry v13's actual pipeline (preview clone plus waypoint commit) instead of assuming the token document moves during the drag.
- The route line is always drawn from the plan polyline, with blocked segments layered over it; plans without segments and malformed segment lists no longer render as dots only.
- When no route exists, the token now advances toward the cursor along a clear straight line until its full body clearance meets the obstacle. The preview marks that potential stopping point with the same endpoint marker as a normal route, while the red X remains on the unreachable destination.
- A sealed room or an unreachable destination no longer leaves the token at the drag origin just because no generated waypoint is reachable; the partial move is committed on drop.
- A gap at the configured threshold (75% of the token's width by default) now passes at every approach angle. Portals are measured between real wall endpoints (or an endpoint and an opposing wall face) instead of relying on padded waypoint offsets.
- A gap just under the configured threshold is rejected instead of being accepted through the old 0.5 px clearance fudge.
- False openings formed by a corner or a wall length no longer create a reduced-radius portal that could tunnel through a wall.
- A too-narrow opening now leaves the partial route at the near-side approach point instead of falling back to the drag origin.
- Doorways with jamb returns or perpendicular walls attached at the opening corners are no longer mistaken for closed openings. Portal guidance extends two lead points beyond each side of the gap so a token can finish leaving a short, narrow doorway.
- Portal lead points are validated individually. A short pocket, return wall, or search bound that makes the longer lead unusable no longer discards the whole opening; the gap stays passable through its valid near lead.
- Foundry's native wall constraint no longer trims a committed squeezed route back to the near side of the opening. The planner already wall-checks the route, so the committed movement sets `ignoreWalls` while leaving bounds, cost, and dnd5e token blocking enabled.
- During combat, the preview now plans from the raw cursor instead of a drag destination clamped by Movement Limiter. This keeps the token following the planned route rather than stalling at the clamped cursor point.
- The preview clone is repositioned with a position-only refresh, and drawing failures are contained, so the token no longer flickers or falls back to native cursor dragging when the overlay has a bad frame.
- With Movement Limiter active, a path rerouted around a wall no longer bypasses its clamp. The pathfound route, preview endpoint, and committed waypoints are truncated to the remaining budget, including rotation routes.

## [0.1.0] - 2026-10-21

### Added

- Foundry v13/v14 module manifest, styles, localization, and settings.
- Gridless scene detection and safe disable when the scene uses a grid.
- Circle-footprint token model derived from document dimensions and texture scale.
- Blocking-wall extraction with open-door handling and a wall-geometry cache.
- Visibility-graph A* pathfinder with direct-path fast path, waypoint pruning, smoothing, and best-effort partial routes.
- Squeeze-only gap detection, squeeze markers, and drag-to-marker activation.
- Per-segment movement costs with the squeeze multiplier and budget clamping.
- Hostile-token contact clamping and cursor-relative rotation around an enemy.
- Canvas path preview with normal, squeeze, blocked, contact, and budget states.
- Unit tests for every pure engine, manifest validation, AI-notice coverage, and release packaging scripts.
