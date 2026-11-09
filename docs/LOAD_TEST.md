# Fleet Monitor — Load test

> Date: 2026-11-08 · Tool: `backend/src/load/loadtest.ts` · Design target (SYSTEM_DESIGN.md §2–3): 1,000 robots at 1 Hz

## Question

§17 asks for four numbers at 1,000 and 5,000 robots: messages per second, p99 ingest lag, queue depth, and the first drop point with its cause.

## Method

- **Real connections.** Every simulated robot is its own MQTT connection, publishing JSON telemetry (QoS 0) at its own offset inside the period, like the fleet. Robots are spread over worker processes, so the generator is not the bottleneck: "Published/s" shows whether it kept up.
- **Inside the Docker network.** The generator runs as a container (`docker compose --profile load run --rm loadtest`) next to Mosquitto, the ingest server and Postgres. Through Docker Desktop's port forwarding, the forwarder would be measured instead of the server.
- **Server-side numbers** come from the server's own `/metrics`, as the difference between a scrape at the start and the end of each 60 s window (after 15 s of warm-up):
  - *Ingest lag* = `received_at − robot_ts`. Generator and server share one clock here (same VM), so this is broker transit plus waiting in the server's event loop.
  - *Queue* = the telemetry persistence queue, sampled every 2 s.
  - *DB batch* = duration of one multi-row `INSERT … unnest` of up to 1,000 rows.
  - *CPU* = `process_cpu_seconds_total` rate: 100 % is one full core. Node runs the ingest path on one thread.
- **Browser fan-out** is measured by a WebSocket client: receipt time minus `report.t` (the server's receive time). With ingest lag, that is the path from robot to screen (G1: under 1 s).
- **Environment.** Apple M1 (8 cores), Docker Desktop VM with 8 CPUs and 8 GB. Generator, broker, server and Postgres all share those 8 cores, so the numbers are a lower bound for a real deployment with separate machines.
- The load robots (`L-00001…`) are added to the registry before the run, which the server picks up within 15 s without a restart, and removed at the end.

## Results

### Throughput steps (60 s each)

| Robots × Hz | Target msg/s | Published/s | Accepted/s | Ingest lag p50 / p99 | Fan-out p50 / p99 | Queue max | Dropped | DB batch p99 | Server CPU | RSS | Event-loop p99 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **1,000 × 1** (design target) | 1,000 | 1,000 | 1,000 | 1.1 / 18.8 ms | 0 / 1 ms | 481 | 0 | 48.6 ms | 15 % | 153 MB | 19.5 ms |
| 2,000 × 1 (first run) | 2,000 | 2,000 | 1,996 | 1.3 / 324.5 ms | 0 / 755 ms | 813 | 0 | 89.5 ms | 22 % | 158 MB | 460.8 ms |
| 2,000 × 1 (rerun) | 2,000 | 2,000 | 2,004 | 2.2 / 35.5 ms | 0 / 335 ms | 887 | 0 | 89.9 ms | 23 % | 163 MB | 64.6 ms |
| **5,000 × 1** | 5,000 | 5,000 | 5,004 | 0.7 / 22.2 ms | 0 / 313 ms | 494 | 0 | 47.9 ms | 31 % | 184 MB | 23.6 ms |
| 5,000 × 2 | 10,000 | 9,990 | 10,000 | 8.8 / 87.7 ms | 0 / 501 ms | 1,169 | 0 | 77.0 ms | 34 % | 237 MB | 101.8 ms |
| 5,000 × 4 | 20,000 | 19,760 | 19,918 | 3.2 / 156.3 ms | 0 / 248 ms | 17,798 | 0 | 115.7 ms | 56 % | 258 MB | 559.4 ms |

Fan-out p99 includes the coalescing wait (reports leave at most once per robot per second, flushed every 250 ms), so a few hundred ms there is by design. Robot to screen (ingest p99 + fan-out p99) stays under G1's 1 s in every step except the first 2,000 × 1 run, where the one stall described below pushed it to about 1.1 s; the rerun of the same step was 0.4 s.

### First drop point and its cause (5,000 × 1, database paused for 30 s)

Postgres was frozen with `docker pause` (sockets stay open, queries hang, the way a stuck database behaves) from 26 s to 56 s:

| Time | Accepted/s | Queue | Dropped (total) | What happens |
|---|---|---|---|---|
| 0–26 s | ~5,000 | < 1,000 | 0 | Normal |
| 28 s | 5,006 | 8,109 | 0 | Database paused: queries hang, the queue fills |
| 36 s | 5,000 | **50,000** | 3,109 | **Full after 10 s** = capacity 50,000 ÷ 5,000 msg/s. Oldest samples are dropped from here. |
| 54 s | 5,003 | 50,000 | 93,489 | Dropping 5,000/s; live view unaffected |
| 56 s | 5,000 | 26,099 | 101,247 | Database back: the writer drains |
| 58 s | 5,000 | 97 | 101,247 | **Drained 50,000 rows in under 4 s** (≥ 12,500 rows/s) |

Dropped: 101,247 samples ≈ (30 s − 10 s) × 5,000/s, as §12 predicts. Accepted throughput, and therefore the live view, did not move during the outage. `/readyz` went red and history endpoints answered 503 while the database was frozen.

## Findings

1. **The design target has a wide margin.** 1,000 robots × 1 Hz uses 15 % of one core, with an ingest p99 of 19 ms and nothing queued for longer than one flush. One instance handled 20,000 msg/s (20× the target) without a drop, at 56 % of a core, on a laptop where four services share eight cores.
2. **The first drop is caused by the database, not by load.** Up to 20,000 msg/s the writer kept up (the queue always drained; batch p99 116 ms per 1,000 rows). Drops start only when the database is unavailable for longer than `capacity ÷ rate`: 50 s at 1,000 msg/s, 10 s at 5,000 msg/s. That is D4 working as intended: history gets a gap, the live view does not.
3. **Occasional stalls of about one second** appeared twice (the first 2,000 × 1 run, and once in 5,000 × 4): accepted throughput dipped for one 2 s sample, the queue spiked, and everything caught up. They did not reproduce on a rerun of 2,000 × 1. The likely cause is a full GC or CPU contention (seven generator processes, the broker and Postgres share the eight cores), not the ingest path. On production hardware, watch `nodejs_eventloop_lag_p99_seconds`; if such stalls are seen there, the next step is `--max-semi-space-size` tuning or splitting sites across instances (D5).
4. **Storage is lower than estimated.** Measured: **157–161 bytes per telemetry row** including the `(robot_id, received_at)` index (4 M rows, 642 MB). The §13 estimate was 200–250 B. At 1,000 robots: about **14 GB per day, 97 GB for 7 days**.
5. **Where the next limit is.** CPU on the ingest thread grows slowly (15 % → 56 % from 1k to 20k msg/s); the event-loop p99 grows faster (20 ms → 559 ms max). Past roughly 20,000 msg/s per instance, scale by site (D5) before tuning further.

## Reproduce

```bash
docker compose up -d && docker compose stop robots    # the 50 demo robots add 1.5 s of simulated clock skew to the lag histogram
docker compose --profile load run --rm loadtest --steps 1000x1,2000x1,5000x1,5000x2,5000x4 --duration 60 --warmup 15
# drop point: run a 5000x1 step for 120 s and, 40 s after it connects, `docker pause` the postgres container for 30 s
```

Raw results (per-step numbers and the 2 s time series): [`load/steps-2026-11-08.json`](load/steps-2026-11-08.json) and [`load/db-outage-2026-11-08.json`](load/db-outage-2026-11-08.json). New runs write `docs/load/load-<timestamp>.json`.
