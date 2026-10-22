# Knkr03's pathing

> **AI notice:** This repository and every file in it were created with AI assistance (Freebuff / Codebuff). See [NOTICE.md](NOTICE.md).

A Foundry VTT module for **D&D 5e gridless scenes** that turns token dragging into constrained movement: wall-aware pathfinding, token-size passage limits, and hostile-token collision with cursor-relative rotation around an enemy.

## Status

`1.0.0` is the first stable release. The module has been loaded and smoke-tested live on Foundry **13.351** with dnd5e **5.3.3**, including live wall geometry, gap clearance, and partial moves. Foundry **v14** and the full drag/drop workflow should still be exercised before relying on it in a long-running game.

This repository contains the module exactly as it ships inside `Data/modules/knkr-pathing/`: the manifest, ES modules, styles, localization, and license/notice files. Development tooling (unit tests, build scripts, design docs) is not included here.

## Features

- **Gridless-only** operation, with automatic disable when the active scene uses a grid.
- **Wall-aware pathfinding** using an expanded-obstacle visibility graph and A*, with direct-path fast path, waypoint pruning, and path smoothing.
- **Configurable gap clearance**: a gap is measured between the actual wall points and compared with the token's actual pixel footprint. By default a gap is passable at 75% of the token's width, from any approach angle. The default ratio is adjustable, and each D&D 5e size category can override it. Doorways with jamb returns work, and the committed movement trusts the planned route instead of letting Foundry re-check it with the full token footprint. Full wall clearance is still enforced outside the opening, so this is not a general wall-hugging squeeze.
- **Tag exceptions**: `game.modules.get('knkr-pathing').api.registerPassageException(tag, factor)` lets a future token tag (for example an amorphous or incorporeal trait) use a narrower gap. No tags are registered by default.
- **Movement-limiter compatibility**: when [Knkr03-Movement Constraint](https://github.com/knkr03/knkr03-movement-constraint) (formerly *D&D 5e Movement Limiter & Undo*) is active, its remaining movement budget also truncates the pathfound route, including routes rerouted around walls. The preview turns amber and stops at the budget instead of bypassing that module's clamp.
- **Partial moves**: when the destination is unreachable, the token still advances as far as its full body clearance allows, and the preview marks the reachable stopping point just like a normal route endpoint. Sealed rooms and too-narrow openings no longer leave the token at the drag origin.
- **Hostile-token collision**: the preview and the token stop at the first contact point along the path.
- **Rotate around an enemy**: while touching an enemy, drag the cursor over that enemy to orbit it along the shorter arc; wall and other-enemy collisions are still enforced.
- **Live preview** drawn on the canvas: normal, movement-limited (amber), blocked, rotation, and contact states, with an optional distance label.

## Installation

### From a release (recommended)

1. Download `knkr-pathing-v<version>.zip` from [Releases](https://github.com/knkr03/knkr03-pathing/releases).
2. In Foundry's **Add-on Modules** tab, use **Install Module** and point it at the release manifest URL:
   `https://github.com/knkr03/knkr03-pathing/releases/latest/download/module.json`.
3. Enable **Knkr03's pathing** in your world.

The manifest URLs point at `knkr03/knkr03-pathing`; if the module is forked or moved to another GitHub account, update `url`, `manifest`, `download`, `readme`, `bugs`, and `changelog` in `module.json` before publishing.

### Manual development install

Keep the checkout folder name identical to the manifest id (`knkr-pathing`) inside `Data/modules/`:

```text
Data/modules/knkr-pathing/
  module.json
  src/
  styles/
  lang/
```

Then launch Foundry with the module enabled in a **gridless** D&D 5e scene.

## Usage

1. Open a gridless scene whose walls have the **Normal** movement restriction (doors work: open doors are ignored, closed and locked doors block).
2. Drag a single token. A path preview appears.
3. If the destination requires passing through a gap narrower than 75% of the token's width (or the configured value), the route stops at the last legal point before the gap and the destination is marked blocked. Use a smaller token, a wider gap, adjust the setting, or register a tag exception for that token.
4. If Knkr03-Movement Constraint is active and the route costs more than the actor's remaining movement, the route stops at the budget and the preview label shows **Movement limit**. The committed waypoints stop at the same point.
5. Dragging over a hostile token while touching it orbits that token instead of crossing it.

Settings are under **Configure Settings → Module Settings → Knkr03's pathing**:

| Setting | Default | Purpose |
| --- | --- | --- |
| Enable pathfinding | on | Master client-side toggle. |
| Default gap clearance | 0.75 | A gap is passable at this fraction of the token's width. Applies to every size. |
| Tiny/Small/Medium/Large/Huge/Gargantuan gap clearance | 0 | Optional per-size override. `0` uses the default. |
| Enemy collision | Hostile only | Which dispositions block movement (hostile, hostile + neutral, all non-friendly). |
| Include hidden enemies | off | Whether hidden hostile tokens block movement. |
| Show distance label | on | Draw the route distance beside the preview. |
| Debug logging | off | Verbose console diagnostics. |

A keybinding (**Knkr03's pathing: Toggle pathfinding**) is registered and unbound by default.

## How it works (short version)

- Blocking wall segments are treated as capsules expanded by the moving token's radius. Clearance between a path and a wall is the minimum segment-to-segment distance.
- The body radius is half of the token's larger **actual** pixel dimension from `TokenDocument#getSize()`. A 1×1 token on a 100 px grid has a 50 px radius; a 2×2 token has 100 px. Art texture scale does not change the collision footprint.
- A direct start→goal segment is used when clear. Otherwise candidate waypoints are generated around expanded wall endpoints and connected by visibility, then A* finds the shortest valid route.
- Each wall opening is also measured directly between its actual endpoints (or an endpoint and an opposing wall face). If the opening reaches the configured threshold (75% of the token's width by default), its midpoint and two perpendicular lead-in points on either side become a portal. The extra lead points let the token finish leaving a doorway with short jamb returns. Only the portal's own crossing edges use the reduced gap radius and ignore the walls that form the opening; every other edge keeps full body clearance. A perpendicular wall touching the opening at a corner does not close it. The token can cross and then leave toward any angle instead of only perpendicular to the gap.
- The planned route is committed with Foundry's native wall pass disabled, because that pass only knows the token's full footprint and would trim the route at a squeeze opening. Bounds, movement cost, and dnd5e token blocking remain in effect.
- Enemy tokens are not pathfinding obstacles; they are clamp obstacles. The route stops at first contact, which keeps behavior predictable and enables perimeter rotation.
- Remaining movement is read from Knkr03-Movement Constraint's public `status(token)` API when that module is active. The route is then truncated by actual scene distance before the preview and waypoints are committed. The planned goal comes from the raw cursor, not that module's clamped drag destination, so a wall detour is still found instead of stalling at the clamped cursor point.

## Compatibility

### Knkr03-Movement Constraint

Formerly *D&D 5e Movement Limiter & Undo*; the module id is unchanged. Knkr03's pathing reads `game.modules.get("dnd5e-movement-limiter").api.status(token)` when that module is active. Its `remaining` value is in scene units and is treated as a maximum route length from the drag origin. This is deliberately a read-only integration: Knkr03-Movement Constraint remains the single owner of turn resources and movement history. When it is absent, inactive, bypassing the limit, or reporting `Infinity`, Knkr03's pathing leaves the route unclamped.

Because the limit is applied to the pathfound route rather than only to the cursor's straight line, rerouting around a wall cannot exceed the remaining distance. The committed waypoints are truncated at the same point the preview shows. The module plans toward the raw cursor and applies the budget itself; the clamped destination from Knkr03-Movement Constraint is not used as the path goal.

## Development

No bundler is used. The module is plain ES modules, so the files here can be loaded directly by Foundry and committed back to this repository without a build step. Keep the checkout folder name identical to the manifest id (`knkr-pathing`), and bump `version` in `module.json` when the code changes.

## License

MIT. See [LICENSE](LICENSE). All files are AI-generated; see [NOTICE.md](NOTICE.md).
