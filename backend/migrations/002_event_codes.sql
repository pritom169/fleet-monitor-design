ALTER TABLE robot_events
  ADD COLUMN event_id text,
  ADD COLUMN code     text NOT NULL DEFAULT 'other',
  ADD COLUMN bay      integer;

UPDATE robot_events SET event_id = 'legacy-' || id;

ALTER TABLE robot_events
  ALTER COLUMN event_id SET NOT NULL,
  ALTER COLUMN code DROP DEFAULT;

CREATE UNIQUE INDEX robot_events_event_id ON robot_events (event_id);
