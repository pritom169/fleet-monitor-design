# Fleet Monitor

A real-time dashboard for a fleet manager whose one question is: **"Which robots need my attention right now?"**
Calm when everything is fine. Loud only when something is wrong.

```bash
npm install
npm run dev          # demo: mock backend on :8787 + app on http://localhost:5173
npm test             # unit tests (shared + client + ingest server), no Docker
npm run test:int -w backend   # integration tests against real Postgres + Mosquitto (Testcontainers, needs Docker)
npm run outage       # demo only: drop every browser connection for 20 s
```

**Production stack** (SYSTEM_DESIGN.md Part B): robots → Mosquitto → ingest server → PostgreSQL.

```bash
docker compose up --build    # everything, app on http://localhost:8787
docker compose stop mosquitto   # see "Robot data paused"; `start` it again to recover

# or from source, with only the infrastructure in Docker:
npm run infra        # Postgres :5432 + Mosquitto :1883
npm run seed         # migrations + robot registry
npm run dev:prod     # ingest server :8787 + 50 MQTT robots + app on :5173
```

Server endpoints: `/healthz`, `/readyz`, `/metrics` (Prometheus), `/api/robots/:id/history`, `/api/robots/:id/telemetry?from&to`, `/api/robots/:id/events?from&to&cursor`. `ROBOTS=1000` scales the simulated fleet.

Restarting the demo backend replays the scripted incidents. After about 10 minutes the low-battery robots charge and recover, the same way a real fleet would.

## Where to look

| Deliverable (BRIEF.md) | URL |
|---|---|
| 1. Overview, normal (dark) | `/`, with the system in dark mode or the moon toggle in the top bar |
| 2. Overview, Offline filter + connection lost | `/?status=offline`, then `npm run outage` |
| 3. Overview, light theme | `/`, sun toggle (the choice is remembered) |
| 4. Detail, low battery | `/robots/R-017` |
| 5. Detail, offline | `/robots/R-041` |
| 6. Component sheet | `/dev/components` (built from the real components) |
| Extra: floor plan | `/floor-plan?site=le&robot=R-024` |
| States | Empty site: `/?site=be` · No results: `/?site=hh&status=error&q=R-09` · Never reported: `R-051` · Loading: stop the simulator and reload |

Scripted incidents: **R-009** offline (34 s), **R-041** offline (3 min), **R-017** 14 % and returning to dock, **R-032** 9 % and waiting for a dock, **R-024** "Motor overcurrent", **R-028** drops below 20 % about 7 s after the simulator starts (the status-change highlight), **R-051** registered but never reported.

## Key decisions, one per screen

**Fleet overview.** The headline is the answer. It is computed from live data ("5 robots need your attention. 45 of 51 are running normally across 3 sites.") so the question is answered before the eye reaches a table. Cards appear only for problems, so a calm day looks almost empty. Colour is spent only where the eye should land.

**Overview, offline filter + connection lost.** Filter, site and search live in the URL, so "everything offline in Munich" is a link someone can send. When *our* connection drops, a non-blocking banner says so, values turn grey and "last seen" keeps counting up. Robots are never marked offline because of our own outage: freshness is judged against the last message we received.

**Overview, light theme.** Same tokens, same rules. Grey means fine, amber and red mean a problem, blue means a link or a selection. The error capsule is solid red on white but tinted on black, so it does not glare during a night shift.

**Robot detail, low battery.** The page leads with a sentence ("R-017 is low on battery. 14 % left and falling. It is on its way to charge."). The chart (with the 20 % threshold, amber below it) and the trail map answer the follow-up questions: how fast is it falling, and where is the robot now.

**Robot detail, offline.** Offline means "we do not know", not "it broke". So the marker and capsule are dashed and outlined, values are labelled *last known*, and the chart shows a hatched "No data since 14:00:08" gap instead of an invented line.

**Component sheet.** Every variant is rendered by the production component (status pills, all row states including "just changed" and "stale", filters, connection states, banner, cards, map pins, empty/loading states). The sheet cannot drift from the app.

## Behaviour rules and where they live

| Rule | Implementation |
|---|---|
| Rows do not jump | `lib/sort.ts`: the sort key is status + ID only. Tested in `lib/sort.test.ts`. When a status does change, the row slides to its new place (FLIP, `RobotTable.tsx`). |
| Status-change highlight | `store.ts` stamps `changedAt`. The row renders a tint overlay keyed by `id-status-changedAt` that fades over 1.8 s. New problem cards rise in. |
| One clock | `socket.ts` `startFleet()`: one `setInterval(1000)`, aligned to the second. Every "last seen" is `now − report.t`. |
| Connection lost | `socket.ts`: backoff 1, 2, 5, 10 s, attempt count, "Retry now", and a 5 s stall watchdog. `lib/status.ts` `statusClock()` freezes freshness at the last message. Tested. |
| Computed headline | `lib/fleet.ts` `overviewHeadline()`, rendered with `aria-live="polite"`. |
| Hover sync | One `hover` in the store. Table rows, cards, map pins and floor-plan list items all read and write it. Hovering a pin scrolls its row into view inside the table, not the page. |
| Quiet updates | Reports are applied in 250 ms batches. Tabular numerals keep columns still. Battery bars ease. Nothing flashes on a value update. |
| 1024 px | Site and Position columns hide, the site moves under the ID, and the site tabs become a menu. |

## Why there is no state library

There is no Redux, Zustand, Jotai or React Query. The app does not need one.

- **There is one source of data.** Almost every change comes from the WebSocket (`socket.ts`). The only state the UI writes to the shared store is `hover`. So there is one small store, not many stores to coordinate.
- **The logic is pure functions.** `applyHello`, `applyReports`, `applyTick` and the other reducers in `store.ts` take a state and return a new one. They are tested without React and without a library.
- **React already has the hook a store needs.** The store is about 50 lines on top of `useSyncExternalStore`. `useFleet(select, eq)` re-renders a component only when the slice it reads changes, the same as a Zustand selector. Reports are applied in 250 ms batches, so the table renders a few times a second, not 50.
- **Other state has a better home.** Filters, site and search live in the URL (`useSearchParams`), so a view can be sent as a link. Per-screen UI uses `useState`. The theme is saved in `localStorage`.
- **Server data is small.** Only the detail page fetches over HTTP: one history endpoint, refreshed every 10 s and after a reconnect (`history.ts`). Caching and deduping from React Query would add a dependency for one call.

When to add one: when many screens fetch and cache different server data, or the shared client state grows past one stream plus `hover`. Then React Query (for server data) or Zustand (for client state) would earn their place.

## Status model

`ok · low (< 20 %) · error · offline (no report for > 10 s, derived on the client) · never (registered, no report yet)`.
Every status has an icon, a label and a colour. Severity order: offline, error, low, never, ok. "Never reported" does not count toward "needs attention": it is unknown but expected.

## Deliberate departures from the prototypes

- **Rows are 40 px**, not 44: the brief asks for 36 to 40.
- **Problem rows have a 3 px left accent** (dashed for offline), as the brief asks.
- **No area gradient under the battery line.** The brief says no gradients, and a plain line is enough.
- **The theme follows the system setting by default** (HANDOFF.md) instead of always starting dark (BRIEF.md), with a remembered manual switch.
- **A fourth site, Berlin South, with no robots**, so the empty state is real data, not a mock.
- **Robot detail works for any robot.** Copy, rates, threshold crossings and events are computed from history the server keeps (`GET /api/robots/:id/history`).

