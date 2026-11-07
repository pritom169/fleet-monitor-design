import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('has development defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 8787,
      host: undefined,
      databaseUrl: 'postgres://fleet:fleet@localhost:5432/fleet',
      mqttUrl: 'mqtt://localhost:1883',
      sites: [],
      staticDir: undefined,
      migrate: true,
      registryRefreshMs: 15_000,
      queue: { telemetryCapacity: 50_000, batchSize: 1000, batchWaitMs: 500 },
    });
  });

  it('reads every setting from the environment', () => {
    const c = loadConfig({
      PORT: '9000', HOST: '0.0.0.0', DATABASE_URL: 'postgres://db', MQTT_URL: 'mqtt://broker', SITES: ' hh, le ,,',
      STATIC_DIR: '/srv/app', MIGRATE: 'false', REGISTRY_REFRESH_MS: '1000', QUEUE_CAPACITY: '10',
    });
    expect(c).toMatchObject({ port: 9000, host: '0.0.0.0', databaseUrl: 'postgres://db', mqttUrl: 'mqtt://broker', sites: ['hh', 'le'], staticDir: '/srv/app', migrate: false, registryRefreshMs: 1000 });
    expect(c.queue.telemetryCapacity).toBe(10);
  });
});
