CREATE TABLE robots (
  id            text PRIMARY KEY,
  site_id       text        NOT NULL,
  model         text        NOT NULL,
  model_full    text        NOT NULL,
  firmware      text        NOT NULL,
  network       text,
  registered_at timestamptz NOT NULL
);

CREATE TABLE telemetry (
  robot_id     text        NOT NULL,
  boot         integer     NOT NULL,
  seq          bigint      NOT NULL,
  received_at  timestamptz NOT NULL,
  robot_ts     timestamptz NOT NULL,
  battery      real        NOT NULL,
  x            real        NOT NULL,
  y            real        NOT NULL,
  state        text        NOT NULL,
  fault        text,
  task         text        NOT NULL
) PARTITION BY RANGE (received_at);

CREATE INDEX telemetry_robot_time ON telemetry (robot_id, received_at DESC);

CREATE TABLE robot_state (
  robot_id     text PRIMARY KEY REFERENCES robots(id),
  report       jsonb       NOT NULL,
  boot         integer     NOT NULL,
  seq          bigint      NOT NULL,
  status       text        NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE robot_events (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  robot_id  text        NOT NULL,
  t         timestamptz NOT NULL,
  kind      text        NOT NULL,
  text      text        NOT NULL,
  sub       text
);

CREATE INDEX robot_events_robot_time ON robot_events (robot_id, t DESC, id DESC);
