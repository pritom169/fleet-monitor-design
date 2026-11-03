# Project: Fleet Monitor — real-time robot fleet dashboard

## Context
I am building a fleet management web app for an engineering challenge. Robots are deployed across several sites (warehouses). Each robot reports its state about once per second: battery level, position, status. The user is a fleet manager. The evaluators care most about frontend design decisions, so every choice must have a clear reason.

## The user and the one question
The fleet manager does not want to watch 50 robots. He wants to answer one question in under 3 seconds: "Which robots need my attention right now?"

## Core design principle
Calm when everything is fine. Loud only when something is wrong.
- Control-room tool, not a marketing dashboard.
- Neutral, low-contrast interface. Colour is reserved for problems.
- If the screen shows 47 healthy robots and 1 offline robot, the eye must land on the offline robot immediately.
- Dense and information-rich, but quiet. No decorative charts, no gradients, no illustrations, no hero sections.

## Screens to design

### 1. Fleet overview (main screen)
- Top bar: app name, site selector (All sites / Site A / Site B / Site C), live connection indicator ("Live" with a subtle pulse, or "Reconnecting…").
- Summary strip: counts per status — e.g. "47 Online · 2 Low battery · 1 Error · 1 Offline". Each count is a clickable filter chip. Active filter is clearly visible.
- Main area split into two panels:
  - Left (about 60%): dense data table. Columns: Robot (name + ID), Site, Status, Battery (number + small inline bar), Last seen ("2 s ago"), Current task, Position (x, y in metres).
  - Right (about 40%): site floor plan as a simple 2D top-down map (grey outlines of aisles/zones). Robots shown as small dots coloured by status. Hover a dot highlights the table row, and the reverse.
- Default sort: by severity (Offline → Error → Low battery → OK), then by name.
- Search field to find a robot by name or ID.
- Rows with problems get a subtle left-border accent and a status icon. Healthy rows stay plain.

### 2. Robot detail (separate page, deep-linkable, e.g. /robots/R-017)
- Header: robot name, ID, site, large status badge, "Last seen 3 s ago", back link to fleet.
- Key metrics row: Battery (%), Status, Current task, Uptime, Position.
- Battery trend chart: last 15 minutes, simple line, a dashed threshold line at 20%.
- Site map with this robot highlighted and its position trail for the last few minutes (fading line).
- Event log (reverse chronological): "14:02:11 — Went offline", "13:55:40 — Battery below 20%", "13:40:02 — Task started: Pick order #4471". Each event has a severity icon.

## Status model (use consistently everywhere)
- OK — robot reports normally, battery ≥ 20%. Neutral/quiet styling, small green dot only.
- Low battery — battery < 20%. Amber.
- Error — robot reports an error state. Red.
- Offline — no report for more than 10 seconds. Grey with a strong outline or striped pattern, and "Last seen 47 s ago" emphasised. Offline must look different from "error": it means we do not know, not that something broke.
- Never rely on colour alone: every status has icon + text label + colour.

## States to design (important — evaluators will look for these)
- Loading (first connection): skeleton rows, not a spinner on an empty page.
- Empty: site with no robots.
- No results: filter or search matches nothing, with a "Clear filters" action.
- Connection lost: a non-blocking banner at the top — "Live updates paused. Reconnecting… Data shown may be outdated." The "last seen" values keep counting up so staleness is visible.
- Robot that has never reported.

## Real-time behaviour (show in the design how it is solved)
- Data updates every second. Rows must NOT jump around on every update. Re-order only when a robot's status changes. Show how a status change is communicated (e.g. brief highlight on the row that changed, then it settles).
- "Last seen" is relative time that ticks.
- Battery numbers update quietly, without flashing.

## Visual direction
- Dark theme as default (control-room use, long sessions), plus a light theme.
- One neutral sans-serif for UI; tabular (monospaced) numerals for all numbers so columns do not wobble when values change.
- 4/8 px spacing grid. Compact row height (about 36–40 px).
- Status colours must pass WCAG AA contrast on both themes.
- Desktop-first (1440 px), but the overview must still work on a 1024 px laptop. Mobile is out of scope.
- Original, neutral product name and logo mark: "Fleet Monitor". No real brand names.

## Sample data to use (realistic, not lorem ipsum)
3 sites: "Hamburg DC", "Leipzig Hub", "Munich North".
About 50 robots named like R-001 … R-050.
Mix: ~45 OK, 2 low battery (14%, 9%), 1 error ("Motor overcurrent"), 2 offline (last seen 34 s and 3 min ago).
Tasks like "Pick order #4471", "Charging", "Idle", "Returning to dock".

## Deliverables
1. Fleet overview — normal state (dark).
2. Fleet overview — filtered to "Offline" + connection-lost banner.
3. Fleet overview — light theme.
4. Robot detail — a low-battery robot.
5. Robot detail — an offline robot.
6. A small component sheet: status badges, table row variants (OK / low battery / error / offline / just-changed highlight), filter chips, connection indicator, banner.

For each screen, add a short note (2–3 lines) on the key design decision and why it serves the fleet manager.