-- Typed events (SYSTEM_DESIGN.md §13). The UI branches on `code` and dedupes on `event_id`;
-- `text` and `sub` are display text only.

ALTER TABLE robot_events
  ADD COLUMN event_id text,
  ADD COLUMN code     text NOT NULL DEFAULT 'other',   -- protocol EVENT_CODES
  ADD COLUMN bay      integer;

-- Rows written before this migration get an ID that cannot collide with a server UUID, and code `other`.
-- Their text is not parsed into a code: older rows only lose the bay hint on the detail page.
UPDATE robot_events SET event_id = 'legacy-' || id;

ALTER TABLE robot_events
  ALTER COLUMN event_id SET NOT NULL,
  ALTER COLUMN code DROP DEFAULT;

-- Makes a retried batch (the insert committed but the reply was lost) a no-op instead of a duplicate.
CREATE UNIQUE INDEX robot_events_event_id ON robot_events (event_id);
