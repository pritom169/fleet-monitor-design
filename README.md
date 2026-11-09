# Fleet Monitor

A live dashboard for a fleet manager who watches warehouse robots.
The manager has one question: **"Which robots need my attention right now?"**
They should get the answer in under 3 seconds.

The rule behind every choice: **calm when all is fine, loud only when something is wrong.**

This file is the only document. It holds how to run the project, every design step in the order it happened, the reason for each decision, the load test, what is not done, and how the system would grow.

The challenge inputs are kept as they were given: [BRIEF.md](BRIEF.md), [HANDOFF.md](HANDOFF.md) and the prototypes in [reference/](reference/).

## Contents

- [Part 1 — How to review it](#part-1--how-to-review-it) (about 15 minutes)
- [Part 2 — How it was built, step by step](#part-2--how-it-was-built-step-by-step)
  - [Step 1. Read the brief](#step-1-read-the-brief-3-nov)
  - [Step 2. Goals first](#step-2-write-the-goals-first-3-nov)
  - [Step 3. One status model](#step-3-one-status-model-3-nov)
  - [Step 4. One shared package](#step-4-one-shared-package-3-nov)
  - [Step 5. Simulator and demo backend](#step-5-the-robot-simulator-and-the-demo-backend-4-nov)
  - [Step 6. Frontend foundation](#step-6-the-frontend-foundation-45-nov)
  - [Step 7. The screens](#step-7-the-screens-57-nov)
  - [Step 8. Production backend design](#step-8-design-the-production-backend-7-nov)
  - [Step 9. Build the server](#step-9-build-the-server-78-nov)
  - [Step 10. Security and monitoring](#step-10-security-and-monitoring-9-nov)
  - [Step 11. Load test](#step-11-load-test-89-nov)
  - [Step 12. Tests, lint and CI](#step-12-tests-lint-and-ci-9-nov)
- [Part 3 — All decisions in one place](#part-3--all-decisions-in-one-place)
- [Part 4 — What is not done yet](#part-4--what-is-not-done-yet)
- [Part 5 — If traffic grows 10× to 1000×](#part-5--if-traffic-grows-10-to-1000)
- [Repository structure](#repository-structure)

---

# Part 1 — How to review it

## What you need

- **Docker** is enough. You do not need Node.
- To run tests or work on the code: **Node 24** (see `.nvmrc`) and Docker.

## A. Start the demo (1 minute)

The demo is one container. Its backend is a simulator, and the scripted incidents are already on screen when the page opens.

```bash
docker compose --profile demo up --build demo
```

Open **http://localhost:8788**.

## B. Look at the screens (5 minutes)

| What to see | Where |
|---|---|
| Overview, dark | `/`, with your system in dark mode, or click the moon in the top bar |
| Overview, light | `/`, click the sun. The choice is remembered. |
| Offline filter | `/?status=offline` |
| Connection lost | Run the command below, then watch the banner for 20 s |
| Robot with low battery | `/robots/R-017` |
| Robot that is offline | `/robots/R-041` |
| Robot that never reported | `/robots/R-051` |
| Site with no robots | `/?site=be` |
| Search with no results | `/?site=hh&status=error&q=R-09` |
| Floor plan | `/floor-plan?site=le&robot=R-024` |
| Component sheet | `/dev/components` (built from the real components) |
| 1024 px laptop | Make the window narrow. Two columns hide and the site moves under the robot ID. |

To cut the connection for 20 seconds:

```bash
curl -X POST 'http://localhost:8788/control/outage?seconds=20'
```

While it is cut, check that **no robot turns offline** because of it. The banner shows, values turn grey, and "last seen" keeps counting.

The scripted incidents:

| Robot | What happens | What it shows |
|---|---|---|
| R-009 | Offline for 34 s | Offline, short |
| R-041 | Offline for 3 min, after a weak Wi-Fi warning | Offline, long. The event log says why. |
| R-017 | 14 % battery, on its way to charge | Low battery on the detail page |
| R-032 | 9 % battery, all docks busy. A dock frees up after 10 min. | Low battery, then recovery |
| R-024 | Error: "Motor overcurrent" | Error |
| R-028 | Drops below 20 % about 7 s after start | The row highlight on a status change |
| R-051 | Registered, never reported | The `never` state |

Restart the container to replay them. After about 10 minutes the low robots charge and recover, like a real fleet.

## C. Run the real stack (5 minutes)

This is the production design: robots talk MQTT to a broker, a server saves data to PostgreSQL, and the browser gets live data from the server.

```bash
docker compose up --build        # http://localhost:8787
```

Here the incidents happen **live** in the first minute, so you can watch them start:

- **+8 s:** R-024 reports a fault.
- **+20 s:** R-041 warns about weak Wi-Fi.
- **+35 s:** R-009 goes silent but stays connected.
- **+45 s:** R-041 drops its link, so the broker announces it is gone.

Try a broker outage:

```bash
docker compose stop mosquitto    # the dashboard says "Robot data paused". No robot turns offline.
docker compose start mosquitto   # it recovers by itself
docker compose down -v           # stop everything and delete the database
```

If a port is busy, move it: `APP_PORT=9787 PG_PORT=15432 MQTT_PORT=11883 docker compose up --build` (or `DEMO_PORT=…` for the demo).

Set `ROBOTS=1000` to simulate a bigger fleet.

## D. Optional: the secure stack

This adds MQTT over TLS with one certificate per robot, HTTPS, and a token on `/metrics`.

```bash
docker compose -f docker-compose.yml -f docker-compose.secure.yml up --build
# app: https://localhost:8443
# The certificates come from a development CA. Accept the browser warning, or trust the CA:
docker compose -f docker-compose.yml -f docker-compose.secure.yml cp server:/certs/ca.crt ./fleet-dev-ca.crt
```

In production, set `TLS_CERT_FILE` / `TLS_KEY_FILE` and `METRICS_TOKEN`. For the broker, set `MQTT_URL=mqtts://…` with `MQTT_CA_FILE`, `MQTT_CERT_FILE` and `MQTT_KEY_FILE`.

## E. Optional: run the checks and tests

CI runs the same commands on every push and pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

```bash
npm install
npm run lint:install             # once: ESLint has its own install (step 12 says why)
npx playwright install chromium  # once, before the first e2e run

npm run typecheck                # TypeScript, strict. The only type check: Vitest does not check types.
npm run lint                     # ESLint, zero warnings allowed
npm test                         # unit and component tests, no Docker needed
npm run test:int -w backend      # integration tests against real Postgres + Mosquitto (needs Docker)
npm run test:coverage            # all tests, fails below 95 % coverage (needs Docker)
npm run test:e2e                 # Playwright: the production build in Chromium
```

To run from source instead of Docker:

```bash
npm run dev          # demo: simulator backend on :8787 + app on http://localhost:5173
npm run outage       # drop all browser connections for 20 s

npm run infra        # only Postgres :5432 + Mosquitto :1883 in Docker
npm run seed         # database tables + robot list
npm run dev:prod     # server :8787 + 50 MQTT robots + app on :5173
```

The load test is in [step 11](#step-11-load-test-89-nov).

---

# Part 2 — How it was built, step by step

The steps follow the git history, from 3 to 9 November 2026.

## Step 1. Read the brief (3 Nov)

Input: [BRIEF.md](BRIEF.md), [HANDOFF.md](HANDOFF.md) and the prototypes in [reference/](reference/).

What I took from it:

- **One user, one question.** A fleet manager does not want to watch 50 robots. They want to know which few need them.
- **A control room tool, not a marketing page.** Long sessions, often at night. Dense, but quiet.
- **Colour is only for problems.** If 47 robots are fine and 1 is offline, the eye must land on the offline one.
- **Never colour alone.** Every status has an icon, a word and a colour.

The prototypes are used for colours, sizes, copy and motion, not for code structure. They copy the same fleet data into three files. The real app has one data layer.

**The interface is the main part of the work.** The server exists to make the interface truthful: correct "now" data, and an honest signal when the data is not fresh.

## Step 2. Write the goals first (3 Nov)

Before any code, I wrote down what the system must do and must not do.

| # | Goal |
|---|---|
| G1 | A new robot report reaches the screen in under 1 s. |
| G2 | A robot is `offline` when it has not reported for more than 10 s. |
| G3 | A robot is **never** marked offline because **our own** link is down (browser to server, or server to broker). |
| G4 | Show one robot's recent history: battery 15 min, path 4 min, events today. |
| G5 | One status model, one source of truth, used by server and client. |
| G6 | Write down every trade-off and what would change it. |

**Not goals:** exactly-once delivery, sending commands to robots, user accounts and roles, mobile layout.

**Why G3 matters most.** If the dashboard's own Wi-Fi drops and 50 robots turn "offline", the manager panics for nothing. Worse, they learn to ignore the offline signal. So the system must tell "the robot is gone" apart from "we cannot hear anyone".

**Two parts.** The work is split in two:

| | Part A: demo | Part B: production |
|---|---|---|
| Robots to server | Simulator inside the server process | MQTT through a Mosquitto broker |
| Server to browser | WebSocket `/ws` | The same WebSocket, the same messages |
| Current state | Memory | Memory, also saved to Postgres |
| History | Ring buffers in memory (15 min battery, 4 min path, 80 events per robot) | Postgres, one partition per day |
| Status rules | `shared/src/status.ts` | The same file |
| Run | `npm run dev` | `docker compose up --build` |
| Fleet size | 51 robots, 4 sites (one empty) | Target 1,000 robots |

**The browser cannot tell them apart.** Swapping Part A for Part B changes no client code.

## Step 3. One status model (3 Nov)

```ts
type Status = 'ok' | 'low' | 'error' | 'offline' | 'never';
```

| Status | Rule (first match wins) | Meaning for the manager |
|---|---|---|
| `never` | Registered, no report yet | Unknown but expected. Not counted as "needs attention". |
| `offline` | No report for more than 10 s | **We do not know.** Not "it broke". |
| `error` | The robot reports an error | Something broke. |
| `low` | Battery under 20 % | Needs to charge soon. |
| `ok` | Everything else | Quiet. |

Sort order: offline, error, low, never, ok. Then by ID.

**Decisions and reasons**

- **One list, not two (D1).** I could split it into "connection" and "battery". That is more exact, but the manager wants one answer per robot. The page still shows the last known battery of an offline robot.
- **Offline wins over error and low.** If we cannot hear the robot, its old battery value is a guess. It is shown, but labelled *last known*.
- **Offline is never sent by a robot.** It is worked out from time. A dead robot cannot say it is dead.
- **Offline looks different from error.** Error is solid red. Offline is grey, dashed and outlined, because it means "unknown", not "broken".
- **The sort key is only status and ID.** A battery or position update never moves a row.

## Step 4. One shared package (3 Nov)

The repo is three npm workspaces: `shared`, `frontend` and `backend`.

`shared/` holds the code both sides must agree on:

- `status.ts`: the status rules and the freshness clock
- `protocol.ts`: the messages between server and browser
- `telemetry.ts`: MQTT topics and payload checks
- `sites.ts`: the floor plans, used to draw the map and to move robots

**Why (D10):** if the server and the browser each had their own copy of the rules, one day the server would say "low battery" while the pill says "OK". With one module, that cannot happen.

**Why no build step:** Vite (client) and tsx (server) both read the TypeScript source directly. A built package would add a step that can go stale.

## Step 5. The robot simulator and the demo backend (4 Nov)

### The robot model (`backend/src/sim/fleet.ts`)

- 50 robots at Hamburg DC, Leipzig Hub and Munich North, plus R-051, which never reports.
- A fourth site, **Berlin South, has no robots**, so the empty state is real data, not a mock-up.
- Robots drive along aisles, use battery, go to a dock when low, and charge.
- Each robot reports at its own moment inside the second, like real radios.
- The random numbers are seeded, so every run is the same. That makes the demo and the tests repeatable.
- On start it simulates the last 15 minutes, so charts and trails are full right away.

Each event has an origin. **Robot events** (task, charging, fault, Wi-Fi) come from the robot. **Server events** (low, back to OK, offline) are status changes. The demo makes them from the model. In Part B the server works them out from the data.

### The demo backend (`backend/src/demo/simulator.ts`)

| Path | Purpose |
|---|---|
| `ws /ws` | `hello` on connect, then one `report` per robot per second, and an `event` on each change |
| `GET /api/robots/:id/history` | Battery (15 min, every 5 s), path (4 min, every 2 s), the last 40 events |
| `GET /api/health` | Robot and client counts |
| `POST /control/outage?seconds=N` | Drops all sockets and refuses new ones for N seconds. Demo only. |

With `STATIC_DIR` set, the same process also serves the built client.

### The messages to the browser (`shared/src/protocol.ts`)

All times are **server** time in epoch milliseconds.

```ts
type ServerMessage =
  | { type: 'hello'; serverTime: number; robots: RobotInfo[]; reports: Report[]; ingest?: Ingest }
  | { type: 'report'; r: Report }
  | { type: 'event'; e: RobotEvent }
  | { type: 'ingest'; ingest: Ingest }          // Part B: robot data paused or live again
  | { type: 'heartbeat'; serverTime: number };  // every 2 s

interface RobotInfo {   // the registry, sent once per connection
  id: string; model: string; modelFull: string; siteKey: string;
  firmware: string; network: string; registeredAt: number;
  lastCharge: [start: number, end: number] | null;
}

interface Report {      // about 1 per robot per second
  id: string; t: number; battery: number; x: number; y: number;
  state: 'ok' | 'error';                 // "offline" is never sent; it is worked out
  fault?: string; task: string; taskKind: TaskKind; since: number;
  skew?: number;                         // Part B: robot clock vs server clock, ms
}

interface RobotEvent {
  id: string; eventId: string; t: number;
  kind: 'info' | 'low' | 'warn' | 'error' | 'off' | 'ok';
  code: EventCode; text: string; sub?: string; bay?: number;
}

interface Ingest { state: 'live' | 'paused'; frozenAt: number | null }
```

**Decisions and reasons**

- **WebSocket, not Server-Sent Events (D2).** Both would work. WebSocket leaves room to send commands from the UI later.
- **A full snapshot on every connect, no replay (D2).** After a reconnect the server sends everything again instead of the missed messages. The snapshot is small (one row per robot), always correct, and removes a whole class of reconnect bugs. A robot with no report in `hello` is `never`.
- **All times are server time.** `hello` carries `serverTime`. The browser stores `offset = serverTime − Date.now()` and keeps "now" in server time. So a laptop with a wrong clock does not make robots look offline.
- **A heartbeat every 2 s.** The browser treats 5 s of silence as a dead link. But when no robot is sending (say, robot data is paused), the link is fine and still silent. The heartbeat proves the link is alive. It also moves the "last message" time forward, so a later outage freezes the clock at the right moment.
- **Keep the demo backend (D9)** even after Part B is built. The interface then runs with one command and no Docker.

## Step 6. The frontend foundation (4–5 Nov)

### Design tokens and theme

All colours, sizes and motion curves come from the prototypes and live in one file, `tokens.css`. Plain CSS with CSS Modules, no UI kit. The design is custom, and a kit would fight it.

- **Grey means fine. Amber and red mean a problem. Blue means a link or a selection,** never a status.
- **The theme follows the system setting**, with a switch that is remembered. The brief says "dark by default". The handoff says "follow the system". I chose the system setting: it respects the user, and dark is one click away.
- **Error red is solid on white but tinted on black,** so it does not glare at night.
- **Tabular numbers everywhere,** so columns do not shift when a value changes.
- Motion respects `prefers-reduced-motion`.

### The store, and why there is no state library

There is no Redux, Zustand or React Query. The app does not need one.

- **There is one source of data.** Almost all changes come from the WebSocket. The only thing the UI writes to the shared store is which robot is under the mouse (`hover`).
- **The logic is pure functions.** `applyHello`, `applyReports`, `applyTick`, `applyLost`, `applyIngest`, `applyHeartbeat` and `applyEvent` take a state and return a new one. They are tested without React.
- **React already has what a store needs.** The store is about 50 lines on top of `useSyncExternalStore`. A component re-renders only when the part it reads changes, like a Zustand selector.
- **Other state has a better home.** Filter, site and search live in the URL, so "everything offline in Munich" is a link you can send. Screen-only state uses `useState`. The theme is in `localStorage`.
- **Server data is small.** Only the detail page fetches over HTTP: one endpoint, every 10 s. React Query would add a library for one call.

*When to add one:* if many screens start to fetch and cache different server data, or the shared client state grows past "one stream plus hover".

**Robot type.** A robot is either `{ status: 'never', report: null }` or `{ status: <any other>, report: Report }`. Checking one tells TypeScript the other, so no code has to force `report!`.

### Client files and their jobs (`frontend/src/`)

| File | Job |
|---|---|
| `data/socket.ts` | The connection, backoff, message checks, batching, the one clock |
| `data/store.ts` | Pure reducers and the small store. A status change stamps `changedAt`, which drives the row highlight. |
| `data/types.ts` | The `Robot` type above |
| `data/history.ts` | Fetches history on open, every 10 s and after a reconnect, and checks it against the schema. Extends the path from live reports. Merges live events into history by `eventId`. |
| `lib/status.ts` | The shared status rules plus `statusClock()`, `isStale()` and colours |
| `lib/sort.ts` | Sort by severity, then ID |
| `components/Clock.tsx` | `<Ago>` and `useWithin()`: the only parts that read the clock (see render cost in step 7) |

### The socket and the one clock (`data/socket.ts`)

- **Reconnect with backoff:** 1, 2, 5, then 10 s. The banner shows the attempt count and a "Retry now" button.
- **Stall watchdog:** an open socket that is silent for 5 s counts as dead.
- **Every message is checked** against the shared schema. A broken message is dropped with one warning per type. An unknown message type (from a newer server) is ignored.
- **Reports are applied in batches every 250 ms.** The store changes about 4 times a second, not 50.
- **One clock for the whole page:** one `setInterval(1000)`, lined up with the second. Every "last seen" is `now − report time`. There is no timer per row.
- **The watchdog runs before the clock moves.** After a laptop wakes up, a dead link is noticed before any robot can look silent.

**How G3 is kept.** `statusClock()` returns "now" while the link is live. When the link is lost, or robot data is paused, it returns the time of the last message we got. So robots can only turn offline on evidence about the robot, never because of our own link. "Last seen" still counts up, so you can see the data getting old.

### Sorting, so rows do not jump (`lib/sort.ts`)

The sort key is **status + ID only**. A battery or position update never moves a row. Only a status change does, and then the row slides to its new place. A unit test checks this.

### Small parts and the top bar (5 Nov)

- Status pill, battery glyph, icons. One `StatusPill` and one set of icons are used everywhere, so a status always looks the same.
- The connection indicator says "Live", "Reconnecting…" or "Robot data paused".
- When our link drops, a banner appears at the top. It does not block the page: the manager can still read the last known state.

## Step 7. The screens (5–7 Nov)

### Fleet overview (5 Nov)

- **The headline is the answer.** It is built from live data: "5 robots need your attention. 45 of 51 are running normally across 3 sites." It is read out to screen readers (`aria-live="polite"`).
- **Cards appear only for problems.** A calm day looks almost empty, and that is the point.
- **Filter chips with counts.** Each count is a filter. Filter, site and search live in the URL.
- **Problem rows get a 3 px left line** (dashed for offline). Healthy rows stay plain.
- **Status change highlight.** When a robot's status changes, its row gets a tint that fades over 1.8 s. New problem cards rise in.
- **Hover sync.** One `hover` value in the store. Rows, cards, map pins and floor plan items all read and write it. Hovering a pin scrolls its row into view inside the table, not the whole page.
- **Quiet updates.** Battery bars ease. Nothing flashes when a value changes.
- **Rows are 40 px,** inside the brief's 36–40 px.
- **At 1024 px** the Site and Position columns hide, the site moves under the ID, and the site tabs become a menu.
- **States:** skeleton rows while connecting (not a spinner on an empty page), empty site, "no results" with "Clear filters", never reported, connection lost, robot data paused.

### Robot detail (6 Nov)

- **The page starts with a sentence:** "R-017 is low on battery. 14 % left and falling. It is on its way to charge."
- **The battery chart** shows the last 15 minutes, with the 20 % line. Below the line it turns amber. There is no fill under the line: the brief says no gradients, and a line is enough.
- **The trail map** shows where the robot has been in the last 4 minutes, fading out.
- **The event log** is newest first, each line with a severity icon.
- **Offline robots:** the marker and pill are dashed, values say *last known*, and the chart shows a hatched "No data since 14:00:08" gap. It never draws a line it does not have.
- **It works for any robot.** The text, rates and events come from history the server keeps, not from hard-coded examples.

### Floor plan (6 Nov)

A full-size map of one site, with a list of robots next to it. It shares the same hover and status rules.

### Component sheet (6 Nov)

`/dev/components` shows every variant: pills, all row states (including "just changed" and "stale"), filters, connection states, banner, cards, map pins, empty and loading states. It renders the **real** components, so it cannot drift from the app.

### Crash screen (7 Nov)

**A control room screen must never go blank.** A blank page looks like an empty fleet.

- If a page throws an error, the router shows "This view stopped working" with a Reload button, a link to the overview, and the error.
- An error boundary above the routes catches anything else.
- The socket and clock run outside React, so they keep working. The crash screen uses no router and no top bar, because either could be what failed.
- **No auto reload.** A reload loop on a wall screen is worse than a clear error.

### Render cost

The target is 1,000 robots in one view.

- Robot data reaches the store about 4 times a second, and the clock once a second.
- **A clock tick re-renders no rows and no map pins.** Rows and pins are `memo` and do not take "now" as a prop. Only small leaf parts like "3 s ago" read the clock, and they re-render only when their own text changes. A test counts renders to prove it.
- **A report batch re-renders only the rows that changed.** Robots that did not change keep the same object, so `memo` works.
- **Known cost:** the overview page itself reads the clock for the attention cards (at most 8), so it re-renders once a second. Its lists are memoized and do not recompute on a tick.

## Step 8. Design the production backend (7 Nov)

```
Robots (MQTT clients, last will)
   │
   ▼
Mosquitto broker
   │
   ▼
Ingest + API server (Node, TypeScript)
   MQTT adapter → checks → dedupe and order → status rules → current state (memory)
        │                                         │
        ▼                                         ▼
   save queue → PostgreSQL 16              WebSocket → browsers (same messages as the demo)
```

### MQTT topics

| Topic | Direction | QoS | Kept by broker | Why |
|---|---|---|---|---|
| `fleet/{site}/{robot}/telemetry` | robot → server | 0 | no | 1 report per second. The newest wins, so resending an old one is useless. |
| `fleet/{site}/{robot}/event` | robot → server | 1 | no | Rare, and the log must not miss "Task started". |
| `fleet/{site}/{robot}/status` | robot / broker → server | 1 | yes | "online" on connect. The broker sends "offline" (the last will) if the robot drops. |
| `fleet/{site}/{robot}/cmd`, `…/cmd/ack` | both | 1 | no | Reserved for commands. Not built. |

- **The last will is a hint, not proof.** It makes a crash show fast. But a robot can stay connected and send nothing, so the 10 s rule stays the real test.
- **Sessions:** `clean: true` for robots and the server. Keepalive 10 s.
- **One server subscribes to `fleet/+/+/#`.** To scale, each server takes its own sites with `fleet/{site}/#` (the `SITES` setting). Not MQTT shared subscriptions: they give each message to *any* server, not the same server for each robot, and that breaks per-robot state and dedupe.

### What a robot sends (`shared/src/telemetry.ts`)

```ts
const Telemetry = z.object({
  id: z.string().min(1).max(64),
  siteId: z.string().min(1).max(64),
  boot: z.number().int().nonnegative(),   // +1 on each restart, stored on the robot
  seq: z.number().int().nonnegative(),    // +1 per message, back to 0 on restart
  robotTs: z.number().int(),              // robot clock; stored, never used for order
  battery: z.number().min(0).max(100),
  x: z.number(), y: z.number(),
  state: z.enum(['ok', 'error']),
  fault: z.string().max(128).optional(),
  task: z.string().max(128),
  since: z.number().int(),
});
```

The server turns each accepted message into a browser `Report` with `t` = the server's receive time. The browser messages do not change.

- **`boot` is a counter, not a random ID.** "Newer" means a bigger `(boot, seq)`. A random ID has no order.
- **The robot clock is never used for order or freshness.** Robot clocks drift. The difference `receivedAt − robotTs` is kept, smoothed (about 10 s of memory), and shown on the detail page as "Robot clock · 1.4 s behind the server". Under 0.5 s it says "In sync", because the value includes network time. It is plain text, not a warning colour: it explains odd times, it is not a problem for the manager.

### Decisions and reasons

| # | Decision | Rejected, and why | Change when |
|---|---|---|---|
| D3 | **MQTT with Mosquitto** | HTTP POST: no last will, no way to talk back to the robot. EMQX or HiveMQ: built for huge clusters we do not need. | About 100k robots, or the broker must be clustered |
| D5 | **One server; scale by site** | MQTT shared subscriptions (no per-robot affinity). Redis for current state: an extra service with no need at one server. | The measured limit gets close |
| D6 | **Plain PostgreSQL** with daily partitions | TimescaleDB: good, but not needed for 7 days. InfluxDB: a second database. | More than 30 days, or more than 10k messages/s |
| D7 | **Order by `(boot, seq)`, freshness by server time** | Robot time: clocks drift. | Robots without sequence numbers: order by receive time and accept small errors |

## Step 9. Build the server (7–8 Nov)

### Layers (`backend/src/server/`)

| Module | Job |
|---|---|
| `transport/mqtt.ts` | Connects, subscribes, reads topics, checks payloads |
| `domain/seqWindow.ts` | The `(boot, seq)` dedupe window |
| `domain/fleet.ts` | Current state, status, change events, the ingest clock. Pure. |
| `persist/batchWriter.ts` | Save queue and batch writer, timers passed in |
| `repo/pg.ts` | Migrations, partitions, writes, history queries |
| `http/server.ts`, `http/fanout.ts` | Routes, errors, HTTPS, WebSocket fan-out, slow browsers |
| `metrics.ts`, `log.ts` | Prometheus metrics, JSON logs with sampling |
| `app.ts` | Wires it all, runs the 1 s ticker, re-reads the robot list, shuts down cleanly. Tests and the load test start it in process. |
| `main.ts` | Reads the env (fails at start if TLS is only half set), handles signals |

- Only `transport/mqtt` knows MQTT. Only `repo/` knows Postgres. Only `http/` knows HTTP (plain `node:http` + `ws`; no framework was needed).
- `domain/` is pure. It gets the clock passed in, so tests use a fake clock and never sleep.
- The status rules are the **same module** the browser uses. Server events and browser pills cannot disagree.

### What happens to each message

```
MQTT message
  → check shape (zod)       bad      → count, drop
  → known robot?            no       → count, drop
  → seen (boot, seq)?       yes      → count, drop
  → older than the newest?  yes      → history only, not current state
  → update current state, work out status, create events   (in memory)
  → send to browsers
  → put in the save queue   full     → drop the oldest, count
```

**Current state is updated before saving (D4).** A slow database can leave gaps in history. It can never make the live view wrong.

**Duplicates.** Per robot, the server keeps the newest `(boot, seq)` and a 256-entry window of recent `seq` values. A bigger `boot` resets it. `robot_state` stores the newest `(boot, seq)`, so the order survives a restart. The window itself is empty after a restart, so a rare duplicate can reach history. That is accepted: QoS 0 means the broker never resends, and one repeated point does not change a chart.

### Keeping G3 true on the server (D8)

A 1 s ticker re-checks every robot's status, because offline depends on time. It uses the same rule as the browser:

- **Broker link up:** freshness is judged against now.
- **Broker link down:** freshness is frozen at the last message. The dashboard says "Robot data paused". No false "Went offline" events.

Two more rules came from running the build:

- **Settle window (3 s).** When the broker comes back, freshness stays frozen for 3 s while robots report again. Without it, the first tick sees every old report and marks the whole fleet offline for one second.
- **Stall watchdog (5 s).** If the link looks "up" but no robot at all has sent anything for 5 s, that silence is about our path, not about every robot. The state goes to "paused". I found this when a laptop slept and woke for two days: the server logged about 4,900 false offline/online pairs. A pause-and-resume test now produces none.
  *Trade-off:* if every robot really goes silent at once (say, one power cut), the dashboard says "paused", not "offline". Both mean "we do not know".

### Battery flapping

At 1 report per second, a battery near 20 % can jump between low and OK. So a robot **enters** low below 20 % and **leaves** it at 22 % or more. The line on the chart stays at 20 %, so the chart stays true. The rule is in the shared module (`nextLow(battery, wasLow)`), so the demo and the browser use it too. The event says "Battery back above 22%".

### Logic reads codes, not text

Each message carries a code for logic and a text for people. The browser only branches on the code.

| Field | Used for | Never used for |
|---|---|---|
| `Report.taskKind` (`picking`, `returning_to_dock`, `waiting_for_dock`, `charging`, `idle`, `other`) | "It is on its way to charge", the charging icon | `Report.task` is shown as is and may change wording |
| `RobotEvent.code` and `bay` | Which dock a returning robot heads to | `text` and `sub` are shown as is |
| `RobotEvent.eventId` | Merging live events with history, React keys | "time + text" is not unique |

An unknown code from a newer server reads as `other`, so an old client still shows the plain text instead of dropping the message.

### Database (8 Nov)

```sql
CREATE TABLE robots (                 -- the registry; needed to know who has "never reported"
  id text PRIMARY KEY, site_id text NOT NULL, model text NOT NULL, model_full text NOT NULL,
  firmware text NOT NULL, network text, registered_at timestamptz NOT NULL
);

CREATE TABLE telemetry (
  robot_id text NOT NULL, boot integer NOT NULL, seq bigint NOT NULL,
  received_at timestamptz NOT NULL, robot_ts timestamptz NOT NULL,
  battery real NOT NULL, x real NOT NULL, y real NOT NULL,
  state text NOT NULL, fault text, task text NOT NULL
) PARTITION BY RANGE (received_at);
CREATE INDEX telemetry_robot_time ON telemetry (robot_id, received_at DESC);

CREATE TABLE robot_state (            -- the last report of each robot, to load on restart
  robot_id text PRIMARY KEY REFERENCES robots(id), report jsonb NOT NULL,
  boot integer NOT NULL, seq bigint NOT NULL, status text NOT NULL, last_seen_at timestamptz NOT NULL
);

CREATE TABLE robot_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  robot_id text NOT NULL, t timestamptz NOT NULL, kind text NOT NULL, text text NOT NULL, sub text
);
CREATE INDEX robot_events_robot_time ON robot_events (robot_id, t DESC, id DESC);  -- for paging
```

A second migration adds `code`, `event_id` and `bay` to events.

- **Daily partitions by server receive time.** A robot with a bad clock cannot write into the wrong day.
- **Keep 7 days.** A job on start and every hour creates the next 2 days and drops days older than 7. Dropping a partition is instant. Deleting millions of rows is not.
- **No unique key on `(robot, boot, seq)`.** Postgres needs every unique key on a partitioned table to include the time column. A resent sample has a new time, so the key would never catch it. Dedupe happens in memory instead.

**History query.** The server picks a bucket size so the answer has at most 500 points:

```sql
SELECT date_bin($bucket, received_at, $from) AS t,
       min(battery) AS battery_min, avg(battery) AS battery_avg,
       (array_agg(x ORDER BY received_at DESC))[1] AS x,
       (array_agg(y ORDER BY received_at DESC))[1] AS y
FROM telemetry
WHERE robot_id = $1 AND received_at >= $from AND received_at < $to
GROUP BY 1 ORDER BY 1;
```

- **Position uses the last value in each bucket, not the average.** The average of two positions can be inside a rack.
- **Gaps stay gaps.** An empty bucket returns no point, so the chart does not invent a line.

**Size at 1,000 robots** (measured in step 11):

| | First estimate | Measured |
|---|---|---|
| Bytes per row, with index | 200–250 | **157–161** |
| Rows per day | 86.4 M | 86.4 M |
| Storage per day | 17–22 GB | **about 14 GB** |
| 7 days | 120–150 GB | **about 97 GB** |

### Save queue and batch writer (8 Nov)

- Holds up to 50,000 samples (about 50 s at 1,000 messages per second).
- Writes at 1,000 rows or every 500 ms, one write at a time, with one multi-row `INSERT … SELECT FROM unnest(…)`.
- **On a database error:** retry with backoff (100 ms to 5 s). When full, drop the oldest.
  *Why not block or grow forever (D4)?* Blocking the MQTT client makes the broker drop data without control. An endless queue grows until the server crashes.
- **A batch that can never succeed** (SQL error classes 21, 22, 23 or 42) is dropped and counted. One bad batch must not block the queue forever. The integration test found this: a state batch built up during an outage held two rows for one robot, and Postgres refused it on every retry. State writes now also keep one row per robot.
- **Every query has a 10 s timeout.** A database that hangs (instead of refusing) must fail the write, so the writer retries and `/readyz` turns red.
- **Database down over midnight:** the insert fails for the missing day, the writer creates the partition and retries once. Partition upkeep also runs when the database comes back.
- `robot_state` is saved at most once per second per robot. Events are saved at once.
- The robot list is re-read every 15 s. New robots appear as "never", removed ones disappear, and browsers get a fresh snapshot.

### API (8 Nov)

The browser messages from the demo stay the same. Production adds range queries.

| Method | Path | Purpose |
|---|---|---|
| WS | `/ws` | `hello` snapshot, then `report` and `event`. Same as the demo. |
| GET | `/api/robots/:id/history` | Default ranges, same as the demo (15 min battery, 4 min path, today's events) |
| GET | `/api/robots/:id/telemetry?from&to` | History, at most 500 points, range at most 7 days |
| GET | `/api/robots/:id/events?from&to&cursor` | Event timeline, paged with a cursor over `(t, id)` |
| GET | `/healthz` | The process is up |
| GET | `/readyz` | Database and broker connected, state loaded |
| GET | `/metrics` | Prometheus. Needs `Authorization: Bearer $METRICS_TOKEN` when that is set. |

Errors use `application/problem+json` (RFC 9457). `from` and `to` take epoch ms or ISO 8601.

### Fan-out to browsers (8 Nov)

- **One report per robot per second per browser.** Extra reports are merged; the newest wins.
- **Slow browsers:** past 1 MB of unsent data, the server keeps only the newest report per robot. If it does not drain in 10 s, the server closes the socket. The browser reconnects and gets a fresh snapshot. One slow screen never slows the others.
- `hello` also carries the ingest state (`live` or `paused`), and an `ingest` message carries later changes. When paused, the browser shows "Robot data paused", freezes statuses, greys values, and keeps "last seen" counting.

### MQTT robots, seed and Docker (8 Nov)

- `mqtt-robots.ts` runs one MQTT client per robot, each with a last will, a boot counter, a sequence number and a 1.5 s clock skew (to show the skew display works).
- `seed.ts` creates the tables and the robot list. It stands in for real provisioning.
- `docker compose up` starts everything in order: Postgres and Mosquitto, then seed, then the server, then the robots.

### Failure modes

| Failure | What happens | Data lost |
|---|---|---|
| Browser to server link lost | Banner, grey values, "last seen" keeps counting, statuses frozen. Reconnect with backoff, then a fresh `hello`. | None |
| Server to broker link lost | "Robot data paused". Clock frozen. No false offline events. | Nothing arrives during the outage |
| One robot goes silent, still connected | Offline after 10 s, from the ticker | None |
| One robot crashes | Last will after about 15 s; the 10 s rule usually fires first | None |
| Robot reboots | Bigger `boot` resets the dedupe window | None |
| Duplicate sample | Dropped. After a server restart a rare one can reach history. | None visible |
| Sample out of order | History only | None |
| Robot clock wrong | Order by `(boot, seq)`, freshness by server time, skew shown | None |
| Bad payload | Dropped, counted, logged with sampling | That sample |
| Database slow or down | Queue grows, then drops the oldest. `/readyz` red. Live view continues. History returns 503. | Gaps in history |
| Database hangs | Queries time out after 10 s, writes retried, live view continues | None, if it comes back before the queue fills |
| Database down over midnight | Missing partition created, batch retried | None |
| A batch the database can never accept | Dropped and counted; the queue continues | That batch |
| Server crash | On restart, state loads from `robot_state` | The queue: under 1 s normally, up to 50 s if the database was slow |
| Server paused (laptop sleep) or link stalled | Stall watchdog: paused, frozen clock, settle window on resume | None |
| Slow browser | Merged, then disconnected | None for other browsers |

## Step 10. Security and monitoring (9 Nov)

### Security

| Area | Plain stack | Secure stack (`docker-compose.secure.yml`) |
|---|---|---|
| Robot identity | None | One certificate per robot (mTLS). The certificate name is the robot ID. |
| What a robot may publish | Anything | Only `fleet/{its site}/{its id}/…`. The rule list is generated from the robot registry. Only the server's certificate may read `fleet/#`. |
| Transport | Plain HTTP, WS, MQTT on 1883 | MQTT over TLS only (8883, TLS 1.2 or newer, no plain port), HTTPS/WSS with HSTS |
| Metrics | Open | Bearer token, compared in constant time |
| Control endpoints | `/control/outage` (demo only) | Not in the real server |
| Input checks | zod at the MQTT edge | Same |
| User sign-in | None | None (a non-goal). Keep it on a trusted network or behind a sign-in proxy. |

**Why certificates and a generated rule list (D11).** Passwords per robot are secrets to rotate on every robot. A dynamic auth plugin adds moving parts. *Change when* there are thousands of provisioning changes a day.

`backend/src/ops/pki.ts init` makes a dev CA and the broker, server and web certificates. `pki.ts robots` issues one certificate per registered robot and writes the rule list; after that, send the broker `SIGHUP`. In production, certificates come from the company's PKI, and the rule generator stays.

### Monitoring

| Metric | Meaning |
|---|---|
| `ingest_messages_total{result}` | `accepted`, `invalid`, `unknown`, `duplicate`, `out_of_order` |
| `ingest_dropped_total` | Dropped because the queue was full |
| `ingest_queue_depth` | Current queue size |
| `ingest_lag_seconds` | `received_at − robot_ts` |
| `db_batch_write_seconds` | Time per batch write |
| `robots_by_status{status}` | Current counts |
| `ws_clients`, `ws_disconnects_total{reason}` | Browser connections |
| `mqtt_connected` | 1 or 0 |

Logs: pino, JSON, one line per event, with request IDs. Noisy warnings are sampled.

## Step 11. Load test (8–9 Nov)

**Question:** at 1,000 and 5,000 robots, what are the messages per second, the p99 delay, the queue depth, and the first point where data is dropped, and why?

### How it was measured

- **Real connections.** Every simulated robot is its own MQTT connection, sending JSON at its own moment inside the second. Robots are spread over several worker processes so the generator is not the bottleneck.
- **Inside the Docker network**, so Docker Desktop's port forwarding is not what gets measured.
- **Server numbers come from the server's own `/metrics`**, as the difference between the start and end of each 60 s window, after 15 s of warm-up.
  - *Delay* = `received_at − robot_ts`. Generator and server share one clock here, so this is broker time plus waiting in the server.
  - *Queue* = the save queue, sampled every 2 s.
  - *CPU* = 100 % is one full core. Node runs the ingest path on one thread.
- **Browser fan-out** is measured by a WebSocket client: receive time minus the server's receive time.
- **Machine:** Apple M1 (8 cores), Docker with 8 CPUs and 8 GB. Generator, broker, server and Postgres all share those cores, so real numbers would be better.
- The load robots are added to the registry before the run (picked up within 15 s, no restart) and removed after.

### Results (60 s per step)

| Robots × Hz | Target/s | Accepted/s | Delay p50 / p99 | Fan-out p50 / p99 | Queue max | Dropped | DB batch p99 | CPU | Memory | Event loop p99 |
|---|---|---|---|---|---|---|---|---|---|---|
| **1,000 × 1** (target) | 1,000 | 1,000 | 1.1 / 18.8 ms | 0 / 1 ms | 481 | 0 | 48.6 ms | 15 % | 153 MB | 19.5 ms |
| 2,000 × 1 (first run) | 2,000 | 1,996 | 1.3 / 324.5 ms | 0 / 755 ms | 813 | 0 | 89.5 ms | 22 % | 158 MB | 460.8 ms |
| 2,000 × 1 (rerun) | 2,000 | 2,004 | 2.2 / 35.5 ms | 0 / 335 ms | 887 | 0 | 89.9 ms | 23 % | 163 MB | 64.6 ms |
| **5,000 × 1** | 5,000 | 5,004 | 0.7 / 22.2 ms | 0 / 313 ms | 494 | 0 | 47.9 ms | 31 % | 184 MB | 23.6 ms |
| 5,000 × 2 | 10,000 | 10,000 | 8.8 / 87.7 ms | 0 / 501 ms | 1,169 | 0 | 77.0 ms | 34 % | 237 MB | 101.8 ms |
| 5,000 × 4 | 20,000 | 19,918 | 3.2 / 156.3 ms | 0 / 248 ms | 17,798 | 0 | 115.7 ms | 56 % | 258 MB | 559.4 ms |

Fan-out p99 includes the merge wait (at most one report per robot per second, sent every 250 ms), so a few hundred ms there is by design. Robot to screen stays under G1's 1 s in every step except the first 2,000 × 1 run (about 1.1 s, one stall). The rerun was 0.4 s.

### The first drop point (5,000 × 1, database frozen for 30 s)

Postgres was frozen with `docker pause` (sockets stay open, queries hang, like a stuck database):

| Time | Accepted/s | Queue | Dropped (total) | What happens |
|---|---|---|---|---|
| 0–26 s | ~5,000 | < 1,000 | 0 | Normal |
| 28 s | 5,006 | 8,109 | 0 | Database frozen, queue fills |
| 36 s | 5,000 | **50,000** | 3,109 | **Full after 10 s** = 50,000 ÷ 5,000/s. Oldest dropped from here. |
| 54 s | 5,003 | 50,000 | 93,489 | Dropping 5,000/s. Live view fine. |
| 56 s | 5,000 | 26,099 | 101,247 | Database back, writer drains |
| 58 s | 5,000 | 97 | 101,247 | **50,000 rows written in under 4 s** |

Dropped ≈ (30 s − 10 s) × 5,000/s, as planned. The live view did not move. `/readyz` went red and history returned 503 while the database was frozen.

### What it shows

1. **The target has a wide margin.** 1,000 robots use 15 % of one core. One server handled 20,000 messages per second (20× the target) with no drops, on a laptop.
2. **The first drop is caused by the database, not by load.** Drops start only when the database is away longer than queue size ÷ rate: 50 s at 1,000/s, 10 s at 5,000/s. That is D4 working: history gets a gap, the live view does not.
3. **Rare one-second stalls** appeared twice and did not come back on a rerun. Most likely garbage collection or CPU sharing on the laptop, not the ingest path. In production, watch the event loop p99.
4. **Storage is lower than estimated:** about 160 bytes per row (4 M rows, 642 MB).
5. **The next limit is the event loop,** not CPU: CPU went 15 % → 56 %, event loop p99 went 20 ms → 559 ms. Past about 20,000 messages per second per server, split sites across servers (see Part 5).

### Run it yourself

```bash
docker compose up -d && docker compose stop robots   # the demo robots add 1.5 s of clock skew to the delay
docker compose --profile load run --rm loadtest --steps 1000x1,2000x1,5000x1,5000x2,5000x4 --duration 60 --warmup 15
# drop point: a 5000x1 step for 120 s, and 40 s after it connects, `docker pause` the postgres container for 30 s
```

Raw numbers: [docs/load/steps-2026-11-08.json](docs/load/steps-2026-11-08.json) and [docs/load/db-outage-2026-11-08.json](docs/load/db-outage-2026-11-08.json). New runs write `docs/load/load-<timestamp>.json`.

## Step 12. Tests, lint and CI (9 Nov)

### Unit and component tests (238 tests; the client is at 99.9 % lines, 97.6 % branches)

| Test | What it proves |
|---|---|
| `lib/sort.test.ts` | Battery and position updates never change row order. Only a status change does. |
| `lib/status.test.ts` | The status rules. A lost link never marks robots offline, and "last seen" keeps counting. Flapping 19 ↔ 22 %. Paused freezes freshness. |
| `data/store.test.ts` | Every reducer. A reconnect `hello` keeps the old status, so a change during an outage is still highlighted. The event log keeps the newest 300. A component re-renders only when its slice changes. |
| `data/socket.test.ts` | Fake socket and timers: batching, broken messages dropped, unknown types ignored, backoff 1, 2, 5, 10 s, a 5 s silent socket dropped, "Retry now". |
| `data/history.test.ts` | Loads, refreshes every 10 s, a bad response is an error not data, a failed refresh keeps old data, live events merged by `eventId`. |
| `lib/fleet.test.ts`, `time.test.ts`, `theme.test.tsx` | Headline for every state, search, time formats, theme follows the system until picked |
| `components/RobotTable.render.test.tsx` | A hover re-renders two rows, a clock tick none, a report only that robot's row |
| `components/*.test.tsx`, `pages/*.test.tsx`, `App.test.tsx` | Every component in every status, and every page in every state (loading, empty, no results, lost, paused, never), built with the real reducers. The crash screen. |
| `domain/fleet.test.ts` | Dedupe, restart reset, order check, server time, unknown robot, flapping events, frozen clock, settle window, stall watchdog, state reload |
| `persist/batchWriter.test.ts` | Write by size or time, drop oldest when full, retry in order, one write at a time |
| `http/fanout.test.ts` | One report per robot per second, newest wins, slow browser held then cut, fast browsers unaffected |

### Integration tests (20 tests, real Postgres 16 and Mosquitto 2 via Testcontainers)

- `pipeline.int.test.ts`: a message reaches a browser in under 1 s (G1) and is saved with server time and skew. Duplicates dropped, late samples in history only. Last will logged, then offline by the 10 s rule. Partitions made and dropped. History at most 500 points, gaps kept. Event paging. A frozen database: live view continues, `/readyz` red, history 503, then recovery with nothing queued lost.
- `security.int.test.ts`: the TLS broker refuses robots without a certificate or with a foreign one. A robot cannot publish for another robot. HTTPS with HSTS, every robot streamed over WSS, metrics token.

### End-to-end tests (Playwright, Chromium, against the production build and the demo backend)

| Spec | What it proves |
|---|---|
| `overview.spec.ts` | Skeleton rows, then the fleet in severity order. Filter and search in the URL. No results and "Clear filters". Row to detail and back. The 1024 px layout. Not found page. |
| `detail.spec.ts` | R-017: low battery headline, chart, log, "Charging bay 3". R-041: "We do not know its state", battery labelled last known. Unknown ID. |
| `outage.spec.ts` | **G3 in a real browser:** a 14 s outage, longer than the 10 s offline limit, shows the banner, the offline count does not move, then it reconnects. |

The specs run one at a time, because the outage spec changes the shared demo server.

Also checked by hand on the running stack: restart with state reload, clean shutdown, broker stop and start, pausing the server for 30 s, two days with the database and broker gone then recovery, and the main screens in Chrome at 1440 px and 1024 px in both themes.

**Not tested on purpose:** framework internals, and pixel snapshots outside the component sheet.

### Lint, types and CI

| Check | Command | Catches |
|---|---|---|
| Types | `npm run typecheck` (TypeScript 7, strict) | The only type gate: Vitest does not check types |
| Lint | `npm run lint` (ESLint 10, zero warnings) | React hooks and React Compiler rules, typescript-eslint, no `!` assertions in app code, `eqeqeq` |
| Tests | `npm test` | The tables above |
| Coverage | `npm run test:coverage` | Fails below 95 % lines, statements, functions and branches |
| Browser | `npm run test:e2e` | The table above |

**ESLint has its own install in `lint/`.** typescript-eslint parses with TypeScript 6, while the code uses TypeScript 7. As a workspace, npm would mix the two and break. So lint uses no type-aware rules, and `tsc` checks the types.

**CI** runs three jobs on every push and pull request: (1) typecheck, lint, unit tests and build; (2) the coverage gate with the integration tests; (3) the end-to-end tests.

---

# Part 3 — All decisions in one place

Each decision names what would make me change it.

| # | Decision | Rejected | Change when |
|---|---|---|---|
| D1 | **One status list** (`ok · low · error · offline · never`) in one shared module | Separate connection and battery fields: more exact, but the manager needs one answer per robot | A new independent signal matters, like position accuracy |
| D2 | **WebSocket with a full snapshot on each connect**, no replay | Server-Sent Events (would work; WebSocket leaves room for commands). Replay of missed messages (more state, more edge cases). | The snapshot passes about 10k robots per view → streams filtered per site |
| D3 | **MQTT with Mosquitto** | HTTP POST (no last will, no way back to the robot). EMQX or HiveMQ (for huge clusters). | About 100k robots, or the broker must be clustered |
| D4 | **Current state before saving; drop the oldest when full** | Blocking the MQTT client (the broker then drops without control). An endless queue (memory grows until a crash). | Full history is required, for example for compliance → a durable log (Kafka) between broker and writer |
| D5 | **One server; scale by site** | MQTT shared subscriptions (no per-robot affinity). Redis for current state (an extra service). | The measured limit gets close → one server per site group, or Kafka keyed by robot ID |
| D6 | **Plain PostgreSQL**, daily partitions, `date_bin` | TimescaleDB (not needed at 7 days). InfluxDB (a second database). | More than 30 days, or more than 10k messages/s → TimescaleDB with compression and continuous aggregates |
| D7 | **Order by `(boot, seq)`; freshness by server time** | Robot time (clocks drift) | Robots without sequence numbers |
| D8 | **Freeze freshness when our own link is down**, in browser and server, including a stalled link and a 3 s settle window | Treating all silence as offline | One broker per site → judge fleet-wide silence per site |
| D9 | **Keep the demo backend** next to the real one | Only the real one (the interface would need Docker) | — |
| D10 | **One `shared/` package**, read as TypeScript source | Copying files; publishing a built package | A client in another language → generate from a schema |
| D11 | **Broker rules generated from the registry**, certificate name = robot ID | Passwords per robot; a dynamic auth plugin | Thousands of provisioning changes a day |

## Where I chose differently from the brief or prototypes

- **The theme follows the system setting** instead of always starting dark (the handoff asks for this; the brief says dark).
- **No fill under the battery line.** The brief says no gradients.
- **A fourth site with no robots,** so the empty state is real.
- **A fifth status, `never`,** for robots that are registered but have not reported yet.
- **Detail pages work for any robot,** not only the two in the prototypes.

## What I disagree with

- **Raw 1 per second history is mostly noise for a manager.** They need status changes and exceptions. So the event log is the main history, and charts are on the detail page.
- **Battery percentage alone is a weak signal.** The real question is "can this robot finish its task?" That needs an energy model and the task plan. I kept one simple threshold and left this as a product question.

## Open questions

1. What fleet size and data retention does a real deployment need?
2. Do robots have a boot counter and a sequence number? If not, ordering falls back to server receive time (D7).
3. Do task events come from the robot or from a separate task system? That decides who publishes to `…/event`.
4. Is 10 s the right offline limit for every site? Sites with weak Wi-Fi may need their own value.
5. Do robots at one site share one uplink? That affects where to place the broker.

---

# Part 4 — What is not done yet

**Running the server**
- **One server only.** If it stops, every dashboard stops.
- **Splitting by site is not finished.** "All sites" cannot show sites that run on other servers.
- **Two servers may clash.** The broker client name comes from the process ID. Two containers can get the same name and keep kicking each other off.
- **TypeScript runs through `tsx`.** The server is not compiled first.

**Data that can be lost**
- **Events during a server restart are lost.** The broker does not keep them for us.
- **History is lost if the database is down too long.** The oldest data is dropped. The live view is fine.
- **One bad character can drop a whole batch.** A null character in a text makes Postgres refuse the batch. Up to one second of history for every robot is lost.

**Wrong status**
- **A robot can get stuck as offline.** If its boot counter goes back (say, after a re-flash), the server ignores it.
- **A new tab can disagree with the server** for a robot at 20–21 %: the tab starts its flapping latch from the snapshot, so it shows OK while the server says low. Fixing it means sending the latch in `Report`.
- **Fleet-wide silence shows as "paused",** not "offline".

**Database**
- **Events are kept forever.** Telemetry is deleted after 7 days.
- **Too many state writes.** The last state of each robot is saved every second. Every 10 s would be enough.
- **Reads and writes share one database.** Long history requests can slow down saving. There is no rate limit.
- **"Today" uses the server's time zone,** not the site's.

**Security**
- **No user sign-in.** Anyone who can reach the port sees every site.
- **A stolen robot certificate cannot be blocked** (no CRL or OCSP). The only fix is to remove the robot and rebuild the broker rules.

**Tests**
- **End-to-end tests cover the demo backend only.** The real stack is covered by integration tests, not a browser.
- **No browser profile at 1,000 robots,** and the table is not virtualized. *Change when* a render takes over 16 ms at that size: virtualize the table and move the attention cards onto `<Ago>`.

**Client**
- **One error boundary for the whole view.** If the map crashes, the whole page shows the crash screen.

---

# Part 5 — If traffic grows 10× to 1000×

## Where we are today

| | Today (1×) |
|---|---|
| Robots | 1,000 |
| Messages per second | 1,000 (1 per robot) |
| Server CPU | 15 % of one core |
| Storage | about 14 GB per day |
| Measured limit of one server | about 20,000 messages per second, no drops |

"Traffic" grows in two directions, and they break different things:

1. **More robots** → more messages in: broker, server, database.
2. **More people watching** → more messages out: the WebSocket fan-out.

## What stays the same at every size

These rules do not depend on size, so they stay:

- The one status model in `shared/` (D1, D10).
- G3: never mark robots offline because our own path is down (D8). At larger sizes it is judged per site or per region.
- Current state before saving (D4): the live view never waits for the database.
- Order by `(boot, seq)` and freshness by server time (D7).
- The interface stays exception-first. At 1 million robots nobody reads every row. The design already shows only the problems, so it scales by design.

## What breaks first at each size

| Size | Robots | Messages/s | What breaks first | Main change |
|---|---|---|---|---|
| 1× | 1,000 | 1,000 | Nothing | — |
| 10× | 10,000 | 10,000 | The browser (every robot goes to every tab), database size and state writes, one server with no backup | Per-view streams, TimescaleDB, a standby server |
| 100× | 100,000 | 100,000 | One broker, one server, the database write rate | Broker and server per site group, Kafka, separate live, write and gateway services, store less raw data |
| 1000× | 1,000,000 | 1,000,000 | One central system at all, and the network to it | Cells and edge servers, robots report on change, storage in tiers |

## How I would change it

**First, measure.** The server already has the metrics that show when a limit is near:

| Signal | Limit that means "act now" |
|---|---|
| Event loop p99 (`nodejs_eventloop_lag_p99_seconds`) | Over 100 ms for minutes |
| `db_batch_write_seconds` p99 | Over 500 ms |
| `ingest_queue_depth` | Does not go back near zero between writes |
| `ingest_dropped_total` | Grows while the database is up |
| Browser render time (React Profiler) | Over 16 ms per update |

**Then change one thing at a time, cheapest first.** Before each step, run the load test at the new target (`--steps 10000x1` and so on), and keep each step easy to undo.

### 10× — 10,000 robots, 10,000 messages per second

*One server still copes* (the load test reached 20,000/s). The edges break first.

1. **Stop sending every robot to every browser.** Today each tab gets every report: at 10,000 robots that is 10,000 messages a second per tab, and a 2 MB snapshot on connect.
   - The browser sends `subscribe { site, filter }`. The server sends only that site's robots.
   - The "All sites" view gets counts per site plus the robots with problems, not every row. This is what the manager needs anyway.
   - Send one message every 250 ms with all changed reports in it, instead of one message per report. That cuts the per-message cost.
   - This is the D2 change point: "about 10k robots per view".
2. **Make the browser cheap at size.** Virtualize the table (only draw the rows on screen). Draw map pins on a canvas instead of one SVG element per robot. Profile at 10,000 robots first.
3. **Database.**
   - Save `robot_state` every 10 s, not every 1 s. At 10,000 robots that is 1,000 writes a second instead of 10,000. On restart, the state is at most 10 s old, and the next report fixes it.
   - Raw data becomes about 140 GB per day and 1 TB per week. This hits the D6 change point (10k messages per second): move to **TimescaleDB** with compression (often about 10× smaller) and continuous aggregates (1 minute buckets), so history reads the small summary, not raw rows.
   - Add a **read replica** for the history API, so long reads do not slow down writes. Add a rate limit on history requests.
   - Delete events after a set time, like telemetry.
   - Write batches with `COPY` instead of `INSERT`. It is faster for bulk rows.
4. **No single server.**
   - Give each server a unique broker client name (host name plus a random part). Today it is the process ID, which can clash.
   - Run a **standby server**. Only the server that holds a Postgres advisory lock reads from the broker. If it dies, the standby takes the lock, loads `robot_state` and goes on. Browsers reconnect and get a fresh snapshot.
   - Compile the server to JavaScript instead of running it through `tsx`.

### 100× — 100,000 robots, 100,000 messages per second

*One server and one broker are no longer enough.* Split the work.

1. **Broker per site group.** Mosquitto runs on one thread and has no clustering. Around 100,000 connections it is near its limit (the D3 change point). Sites are independent, so the simple step is one broker per group of sites. If one site alone is too big, use a clustered broker (EMQX, HiveMQ or VerneMQ).
2. **Server per site group (D5).** The `SITES` setting already exists: each server subscribes only to `fleet/{site}/#` for its sites. A small table in Postgres maps site → server, and each server holds a lease on its sites, so only one server owns a site at a time. Not MQTT shared subscriptions: they break per-robot state.
3. **Put Kafka (or Redpanda) between the brokers and the servers**, keyed by robot ID. This is the D4 change point. It solves three problems at once:
   - Events are no longer lost when a server restarts. Kafka keeps them.
   - When the database is down, the writer catches up from Kafka later, instead of dropping the oldest data.
   - Live state and saving become separate services that scale on their own.
4. **Three kinds of service instead of one server:**
   - **Live service:** reads Kafka, keeps current state in memory, works out status and events. Same domain code as today.
   - **Writer service:** reads Kafka, writes batches to the database.
   - **Gateway service:** holds the browser WebSockets. It gets per-site report batches and per-site summaries from the live services, and sends each browser only what it subscribed to. It keeps no robot state of its own, so you can add gateways behind a load balancer. A reconnect gets a fresh snapshot.
   - "All sites" is built from the small per-site summaries.
5. **Store less raw data.** At 100,000 per second, raw rows are about 1.4 TB per day. A manager needs events and trends, not every second (see "What I disagree with"). So:
   - Keep the raw 1 per second stream in Kafka for 24 hours, for debugging.
   - Save to the database one sample every 10 s per robot, plus every status change. That is about 10× less.
   - Use TimescaleDB multi-node or ClickHouse for telemetry. Keep events and the registry in Postgres.
6. **Binary messages.** Reading JSON is the biggest CPU cost per message. Switch robots and browsers to Protobuf or CBOR. Generate the types from one schema, so `shared/` stays the single source (the D10 change point).

### 1000× — 1,000,000 robots, 1,000,000 messages per second

*No single central system should see every message.* Build in cells.

1. **Cells.** A cell is a full copy of the 100× setup (brokers, Kafka, live, writer and gateway services, database) for a set of sites, for example 20,000 to 50,000 robots. All cells are the same. A site lives in exactly one cell. A small global directory maps site → cell.
   - A failure hurts one cell, not the whole fleet.
   - To grow, add a cell. Nothing else changes.
2. **Edge servers at big sites or regions.** Put the broker and a small live service close to the robots.
   - The site keeps working if the link to the cloud drops.
   - The edge sends up only status changes, events and downsampled data. Raw data stays at the edge for a short time.
   - G3 is judged per site: if one site's uplink drops, only that site shows "paused" (the D8 change point).
3. **Robots report on change, not every second.** Send a report when something changes, plus a heartbeat every few seconds. A charging or idle robot then sends much less. The offline rule becomes "no heartbeat for 2 intervals". This needs a firmware change, so it is a product decision as much as a technical one.
4. **A global view from summaries.** Each cell sends a tiny summary every second (counts per status per site, plus the problem list). The global screen shows these. The manager drills down: region → site → robot. Search uses a global index from robot ID to cell. No browser ever loads a million rows.
5. **Storage in tiers.** Hot data (days) in each cell's time-series database. Older data as Parquet files in object storage, read only when someone asks.
6. **The offline check.** Scanning every robot once a second is fine at 50,000 robots per cell. If a cell gets bigger, use a timer wheel: each robot sits in the slot of the second when it would turn offline, and each tick reads only that slot.
7. **Things that become required, not optional:** user sign-in with access per site, automatic certificate issuing and revoking (the D11 change point), and running in more than one region.

### If many more people watch (10× to 1000× more browsers)

This grows apart from the robot count. Today 100 open tabs at 1,000 robots means about 100,000 WebSocket messages a second from one server.

1. **Batch:** one message per site every 250 ms instead of one per report. 1,000 tabs then get about 4 messages a second each instead of 1,000.
2. **Encode once:** build each site batch once and send the same bytes to every tab watching that site.
3. **Compress** WebSocket messages (`permessage-deflate`). Robot reports repeat a lot, so they compress well.
4. **Gateways scale out:** they hold no robot state, so add more behind a load balancer. A tab that reconnects to another gateway just gets a fresh snapshot (D2), so no sticky sessions are needed.
5. **Wall screens and shared displays** can use the "All sites" summary stream, which is tiny at any fleet size.

---

# Repository structure

```
shared/      @fleet/shared: protocol.ts (browser messages), status.ts (status rules),
             telemetry.ts (MQTT topics + checks), sites.ts (floor plans)
frontend/    React + Vite client
  src/data/        store.ts (pure reducers + small store), socket.ts (connection, batching, backoff, the one clock), history.ts
  src/lib/         status.ts, sort.ts, time.ts, fleet.ts (headline), theme.ts
  src/components/  StatusPill, BatteryGlyph, TopBar, RobotTable, FleetMap, BatteryChart, Clock, ErrorScreen, …
  src/pages/       Overview, RobotDetail, FloorPlan, Components
backend/
  src/demo/simulator.ts   demo backend (Part A)
  src/sim/                robot model + incidents, MQTT robots, seed
  src/server/             ingest + API server (Part B): transport, domain, persist, repo, http
  src/ops/pki.ts          certificates + broker rules from the registry
  src/load/loadtest.ts    load generator
  migrations/             SQL schema
e2e/                      Playwright tests
lint/                     ESLint with its own install
docs/load/                raw load test results (JSON)
reference/                design prototypes (challenge input, not production code)
BRIEF.md, HANDOFF.md      challenge input
.github/workflows/ci.yml  CI
docker-compose.yml, docker-compose.secure.yml, Dockerfile, deploy/
```
