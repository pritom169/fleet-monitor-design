#!/usr/bin/env bash
# Database outage under load: 5000 robots at 1 Hz for 120 s. 40 s after the
# robots connect, Postgres is frozen (docker pause) for 30 s, then resumed.
# Expect: the live view keeps 5000 msg/s, the telemetry queue fills to its cap
# (QUEUE_CAPACITY, 50k), the oldest rows are dropped, and the queue drains
# within seconds of the resume. Result: docs/load/db-outage-<timestamp>.json
#
# Run from the repo root with the production stack up:
#   docker compose up -d && docker compose stop robots && scripts/db-outage.sh
set -euo pipefail

PAUSE_AFTER=${PAUSE_AFTER:-40}
PAUSE_FOR=${PAUSE_FOR:-30}
log=$(mktemp)
trap 'docker compose unpause postgres >/dev/null 2>&1 || true; rm -f "$log"' EXIT

docker compose --profile load run --rm loadtest \
  --name db-outage --steps 5000x1 --duration 120 --warmup 15 | tee "$log" &
run=$!

until grep -q 'connected in' "$log"; do
  kill -0 "$run" 2>/dev/null || { echo "load test exited before the robots connected" >&2; exit 1; }
  sleep 1
done
sleep "$PAUSE_AFTER"
echo "[outage] pausing postgres for ${PAUSE_FOR}s"
docker compose pause postgres
sleep "$PAUSE_FOR"
docker compose unpause postgres
echo "[outage] postgres resumed"
wait "$run"
