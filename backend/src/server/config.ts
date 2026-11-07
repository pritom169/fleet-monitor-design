export interface AppConfig {
  port: number;
  host?: string;
  databaseUrl: string;
  mqttUrl: string;
  /** Site keys this instance owns (scale by site, D5). Empty: all sites. */
  sites: string[];
  /** Built client to serve, e.g. ../frontend/dist. Unset: API only. */
  staticDir?: string;
  migrate: boolean;
  /** How often the robot registry is re-read, so newly provisioned robots appear without a restart. */
  registryRefreshMs: number;
  queue: {
    telemetryCapacity: number;
    batchSize: number;
    batchWaitMs: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST,
    databaseUrl: env.DATABASE_URL ?? 'postgres://fleet:fleet@localhost:5432/fleet',
    mqttUrl: env.MQTT_URL ?? 'mqtt://localhost:1883',
    sites: (env.SITES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    staticDir: env.STATIC_DIR,
    migrate: env.MIGRATE !== 'false',
    registryRefreshMs: Number(env.REGISTRY_REFRESH_MS ?? 15_000),
    queue: {
      telemetryCapacity: Number(env.QUEUE_CAPACITY ?? 50_000),
      batchSize: 1000,
      batchWaitMs: 500,
    },
  };
}
