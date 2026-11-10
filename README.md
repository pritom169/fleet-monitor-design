# Fleet Monitor

A live dashboard for a fleet manager who watches warehouse robots.
The manager has one question: **"Which robots need my attention right now?"**
They should get the answer in under 3 seconds.

The rule behind every choice: **calm when all is fine, loud only when something is wrong.**

This file is the only document. It holds how to run the project, the reason for each decision, what is not done, and how the system would grow.

The challenge inputs are kept as they were given: [BRIEF.md](BRIEF.md), [HANDOFF.md](HANDOFF.md) and the prototypes in [reference/](reference/).

## Contents

- [Part 1 — Running it](#part-1--running-it)
- [Part 2 — All decisions in one place](#part-2--all-decisions-in-one-place)
- [Part 3 — What is not done yet](#part-3--what-is-not-done-yet)
- [Part 4 — If traffic grows 10× to 1000×](#part-4--if-traffic-grows-10-to-1000)
- [Repository structure](#repository-structure)

---

# Part 1 — Running it

## Requirements

- **Docker** runs everything. Node is not needed.
- To run tests or work on the code: **Node 24** (see `.nvmrc`) and Docker.

## A. The demo

The demo is one container. Its backend is a simulator, and the scripted incidents are already on screen when the page opens.

```bash
docker compose --profile demo up --build demo
```

Open **http://localhost:8788**.

## B. Screens and states

| State | Where |
|---|---|
| Overview, dark | `/`, with your system in dark mode, or click the moon in the top bar |
| Overview, light | `/`, click the sun. The choice is remembered. |
| Offline filter | `/?status=offline` |
| Connection lost | The outage command below |
| Robot with low battery | `/robots/R-017` |
| Robot that is offline | `/robots/R-041` |
| Robot that never reported | `/robots/R-051` |
| Site with no robots | `/?site=be` |
| Search with no results | `/?site=hh&status=error&q=R-09` |
| Floor plan | `/floor-plan?site=le&robot=R-024` |
| Component sheet | `/dev/components` (built from the real components) |
| 1024 px laptop | A narrow window. Two columns hide and the site moves under the robot ID. |

To cut the connection for 20 seconds:

```bash
curl -X POST 'http://localhost:8788/control/outage?seconds=20'
```

While it is cut, **no robot turns offline** because of it. The banner shows, values turn grey, and "last seen" keeps counting.

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

## C. The production stack

This is the production design: robots talk MQTT to a broker, a server saves data to PostgreSQL, and the browser gets live data from the server.

```bash
docker compose up --build        # http://localhost:8787
```

Here the incidents happen **live** in the first minute:

- **+8 s:** R-024 reports a fault.
- **+20 s:** R-041 warns about weak Wi-Fi.
- **+35 s:** R-009 goes silent but stays connected.
- **+45 s:** R-041 drops its link, so the broker announces it is gone.

A broker outage:

```bash
docker compose stop mosquitto    # the dashboard says "Robot data paused". No robot turns offline.
docker compose start mosquitto   # it recovers by itself
docker compose down -v           # stop everything and delete the database
```

If a port is busy, move it: `APP_PORT=9787 PG_PORT=15432 MQTT_PORT=11883 docker compose up --build` (or `DEMO_PORT=…` for the demo).

Set `ROBOTS=1000` to simulate a bigger fleet.

## D. The secure stack

This adds MQTT over TLS with one certificate per robot, HTTPS, and a token on `/metrics`.

```bash
docker compose -f docker-compose.yml -f docker-compose.secure.yml up --build
# app: https://localhost:8443
# The certificates come from a development CA. Accept the browser warning, or trust the CA:
docker compose -f docker-compose.yml -f docker-compose.secure.yml cp server:/certs/ca.crt ./fleet-dev-ca.crt
```

In production, set `TLS_CERT_FILE` / `TLS_KEY_FILE` and `METRICS_TOKEN`. For the broker, set `MQTT_URL=mqtts://…` with `MQTT_CA_FILE`, `MQTT_CERT_FILE` and `MQTT_KEY_FILE`.

## E. Checks and tests

CI runs the same commands on every push and pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

```bash
npm install
npm run lint:install             # once: ESLint has its own install
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

Load test:

```bash
docker compose up -d && docker compose stop robots   # the demo robots add 1.5 s of clock skew to the delay
docker compose --profile load run --rm loadtest --steps 1000x1,2000x1,5000x1,5000x2,5000x4 --duration 60 --warmup 15
# drop point: a 5000x1 step for 120 s, and 40 s after it connects, `docker pause` the postgres container for 30 s
```

Raw numbers: [docs/load/steps-2026-11-08.json](docs/load/steps-2026-11-08.json) and [docs/load/db-outage-2026-11-08.json](docs/load/db-outage-2026-11-08.json). New runs write `docs/load/load-<timestamp>.json`.

---

# Part 2 — All decisions in one place

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

# Part 3 — What is not done yet

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

# Part 4 — If traffic grows 10× to 1000×

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
- Never mark robots offline because our own path is down (D8). At larger sizes it is judged per site or per region.
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
   - "Our own link is down" is judged per site: if one site's uplink drops, only that site shows "paused" (the D8 change point).
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
