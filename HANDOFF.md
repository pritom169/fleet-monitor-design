# Fleet Monitor — design handoff for implementation

Read this file first. Then read `BRIEF.md`. The files in `reference/` are design prototypes, not production code.

## How to use the reference files

- Each `reference/*.dc.html` file is one screen from the design canvas. It is HTML with inline styles, a `<helmet><style>` block for tokens and classes, and a small `class Component extends DCLogic` script.
- `{{name}}` is a template hole. `<sc-for>` is a loop. `<sc-if>` is a condition. The values come from `renderVals()` in the script at the bottom of each file.
- Use these files for: exact colours, sizes, spacing, radii, shadows, icon SVG paths, copy text, motion curves, and behaviour.
- Do not copy their structure. The prototypes duplicate the fleet generator and the site plans in three files. The real app must have one data layer.
- `Overview-Offline`, `Overview-Dark` and `Detail-Offline` only mount `Main` or `Detail` with other props. They are states, not separate screens.

| Reference file | Route | Notes |
|---|---|---|
| `Main.dc.html` | `/` | Overview. Props in the prototype: `theme`, `filter`, `connection`, `simulate` |
| `Detail.dc.html` | `/robots/:id` | Prototype covers R-017 (low battery) and R-041 (offline) |
| `FloorPlan.dc.html` | `/floor-plan?site=hh` | Map stage, sidebar, zoom, layers, site tiles |
| `Components.dc.html` | `/dev/components` (optional) | Living style guide. Build it from the real components |

## Target stack (recommended)

- React 18 + TypeScript + Vite. React Router for routes.
- Plain CSS with CSS custom properties (one `tokens.css`) and CSS Modules per component. No UI kit: the design is custom and a kit fights it.
- State: one small store (Zustand or `useSyncExternalStore`) that holds robots by ID.
- Real-time: a mock robot simulator in Node that sends one WebSocket message per robot per second. The client must not know it is a mock.
- Tests: Vitest for logic, Playwright for screenshots and the main flows.

## Design tokens

Copy the values from the `.fm` and `.fm[data-theme="dark"]` rules in `Main.dc.html`. Put them in `src/styles/tokens.css` on `:root` and `[data-theme="dark"]`. Follow the user's system setting by default and allow a manual switch.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--page` | #FFFFFF | #000000 | Page |
| `--tile` | #F5F5F7 | #161618 | Tiles, panels |
| `--raise` | #FFFFFF | #232325 | Hover row, lifted card, popover |
| `--ink` | #1D1D1F | #F5F5F7 | Text |
| `--ink2` | #6E6E73 | #A1A1A6 | Secondary text |
| `--ink3` | #86868B | #86868B | Grey part of headlines, 24 px and larger only |
| `--accent` | #0066CC | #2997FF | Links, selection, switches. Never a status |
| `--err` / `--err-text` | #D70015 | #FF453A / #FF5A4F | Error |
| `--amb` / `--amb-text` | #C77700 / #A15C00 | #FFB340 | Low battery. Mark colour / text colour |
| `--off` / `--off-text` | #8E8E93 / #636366 | #8E8E93 / #AEAEB2 | Offline. Always dashed or outlined |

Type: Inter from Google Fonts with `opsz` (optical size) on, `font-variant-numeric: tabular-nums` on the root, `letter-spacing: -0.011em` for body text. Sizes: 112 / 56 / 48 / 34 / 28 / 21 / 17 / 14 / 13 / 12 / 11.

Shape: tile 18 px, stage 22 px, popover 14 px, row 10 px, capsule = half the height. No borders on tiles.

Motion: spring `cubic-bezier(.32,.72,0,1)`, fade `cubic-bezier(.28,.11,.32,1)`. Respect `prefers-reduced-motion`.

## Status model (one source of truth)

```ts
type Status = 'ok' | 'low' | 'error' | 'offline' | 'never';
// offline: no report for more than 10 s (computed on the client from lastSeen)
// low: battery < 20 and the robot is reporting
// error: the robot reports an error state
// never: registered, but no report yet
const severity: Record<Status, number> = { offline: 0, error: 1, low: 2, never: 3, ok: 4 };
```

Every status shows icon + label + colour. Use one `<StatusPill>` and one `<StatusIcon>` component. The SVG paths are in the Icons section of `Components.dc.html` (16 px grid, 1.5 px stroke).

## Behaviour rules that the evaluators will check

1. **Rows do not jump.** Sort by severity, then ID. Compute the sort key only from status. A battery or position update must not change the order. Add a unit test for this.
2. **Status change highlight.** When a robot's status changes, add a class to its row for 1.8 s (status-tinted background fades out). Use the robot ID + status as the key.
3. **One clock.** One `setInterval(1000)` updates a `now` value. "Last seen" values derive from `now - lastSeen`. Do not run one timer per row.
4. **Connection lost.** On WebSocket close: show the banner, keep all values, turn values grey, and let "last seen" keep counting. Do not mark robots offline because of our own connection loss. Reconnect with backoff (1, 2, 5, 10 s) and show the attempt count.
5. **The headline is computed.** "N robots need your attention." comes from the store, with `aria-live="polite"`.
6. **Hover sync.** Hover on a row, card or map pin sets one `hoveredId` in the store. All three views read it.
7. **States.** Loading (skeleton rows, "Connecting to fleet…"), empty site, no results with "Clear filters", never reported, connection lost.
8. **1024 px.** Hide Site and Position columns, and show the site under the robot ID.

## Suggested folder structure

```
src/
  styles/tokens.css, global.css
  data/types.ts, store.ts, socket.ts, sites.ts      // sites.ts: racks, aisles, zones from the prototypes
  lib/status.ts, time.ts, sort.ts
  components/StatusPill, StatusIcon, BatteryGlyph, AttentionCard, FilterPills,
             RobotTable, FloorMap, MapPin, Popover, TopBar, Banner, Skeleton
  pages/Overview.tsx, RobotDetail.tsx, FloorPlan.tsx
server/simulator.ts                                 // 50 robots, 3 sites, 1 Hz, scripted incidents
tests/sort.test.ts, e2e/*.spec.ts
```

## Sample data

Use the data from `BRIEF.md` and the `fleet()` function in `Main.dc.html`: R-001 to R-050, Hamburg DC (R-001–R-018), Leipzig Hub (R-019–R-035), Munich North (R-036–R-050). Fixed incidents: R-009 offline, R-017 low 14 %, R-024 error "Motor overcurrent", R-032 low 9 %, R-041 offline 3 min. R-028 drops below 20 % about 6 s after start, to demonstrate the status-change highlight.
