import fs from 'node:fs';

export interface TlsFiles {
  ca?: Buffer;
  cert: Buffer;
  key: Buffer;
}

export interface AppConfig {
  port: number;
  host?: string;
  databaseUrl: string;
  mqttUrl: string;
  mqttTls?: TlsFiles;
  sites: string[];
  staticDir?: string;
  https?: TlsFiles;
  metricsToken?: string;
  migrate: boolean;
  registryRefreshMs: number;
  queue: {
    telemetryCapacity: number;
    batchSize: number;
    batchWaitMs: number;
  };
}

const read = (path: string | undefined) => (path ? fs.readFileSync(path) : undefined);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];

  let mqttTls: TlsFiles | undefined;
  if (env.MQTT_CERT_FILE || env.MQTT_KEY_FILE) {
    if (!env.MQTT_CERT_FILE || !env.MQTT_KEY_FILE) problems.push('MQTT_CERT_FILE and MQTT_KEY_FILE go together');
    else mqttTls = { ca: read(env.MQTT_CA_FILE), cert: read(env.MQTT_CERT_FILE)!, key: read(env.MQTT_KEY_FILE)! };
  }

  let https: TlsFiles | undefined;
  if (env.TLS_CERT_FILE || env.TLS_KEY_FILE) {
    if (!env.TLS_CERT_FILE || !env.TLS_KEY_FILE) problems.push('TLS_CERT_FILE and TLS_KEY_FILE go together');
    else https = { cert: read(env.TLS_CERT_FILE)!, key: read(env.TLS_KEY_FILE)! };
  }

  if (problems.length) throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);

  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST,
    databaseUrl: env.DATABASE_URL ?? 'postgres://fleet:fleet@localhost:5432/fleet',
    mqttUrl: env.MQTT_URL ?? 'mqtt://localhost:1883',
    mqttTls,
    sites: (env.SITES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    staticDir: env.STATIC_DIR,
    https,
    metricsToken: env.METRICS_TOKEN || undefined,
    migrate: env.MIGRATE !== 'false',
    registryRefreshMs: Number(env.REGISTRY_REFRESH_MS ?? 15_000),
    queue: {
      telemetryCapacity: Number(env.QUEUE_CAPACITY ?? 50_000),
      batchSize: 1000,
      batchWaitMs: 500,
    },
  };
}
