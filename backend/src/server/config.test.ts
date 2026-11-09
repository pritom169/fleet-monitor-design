import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-config-'));
const file = (name: string) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, name);
  return p;
};
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('has development defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 8787,
      host: undefined,
      databaseUrl: 'postgres://fleet:fleet@localhost:5432/fleet',
      mqttUrl: 'mqtt://localhost:1883',
      mqttTls: undefined,
      sites: [],
      staticDir: undefined,
      https: undefined,
      metricsToken: undefined,
      migrate: true,
      registryRefreshMs: 15_000,
      queue: { telemetryCapacity: 50_000, batchSize: 1000, batchWaitMs: 500 },
    });
  });

  it('reads every setting from the environment', () => {
    const c = loadConfig({
      PORT: '9000', HOST: '0.0.0.0', DATABASE_URL: 'postgres://db', MQTT_URL: 'mqtts://broker', SITES: ' hh, le ,,',
      STATIC_DIR: '/srv/app', METRICS_TOKEN: 'tok', MIGRATE: 'false', REGISTRY_REFRESH_MS: '1000', QUEUE_CAPACITY: '10',
      MQTT_CA_FILE: file('ca.crt'), MQTT_CERT_FILE: file('ingest.crt'), MQTT_KEY_FILE: file('ingest.key'),
      TLS_CERT_FILE: file('web.crt'), TLS_KEY_FILE: file('web.key'),
    });
    expect(c).toMatchObject({ port: 9000, host: '0.0.0.0', databaseUrl: 'postgres://db', mqttUrl: 'mqtts://broker', sites: ['hh', 'le'], staticDir: '/srv/app', metricsToken: 'tok', migrate: false, registryRefreshMs: 1000 });
    expect(c.queue.telemetryCapacity).toBe(10);
    expect(String(c.mqttTls!.ca)).toBe('ca.crt');
    expect(String(c.mqttTls!.cert)).toBe('ingest.crt');
    expect(String(c.https!.key)).toBe('web.key');
  });

  it('makes the broker CA optional', () => {
    expect(loadConfig({ MQTT_CERT_FILE: file('a.crt'), MQTT_KEY_FILE: file('a.key') }).mqttTls!.ca).toBeUndefined();
  });

  it('refuses half a certificate pair, listing every problem', () => {
    expect(() => loadConfig({ MQTT_CERT_FILE: 'x', TLS_KEY_FILE: 'y' })).toThrow(
      /MQTT_CERT_FILE and MQTT_KEY_FILE go together[\s\S]*TLS_CERT_FILE and TLS_KEY_FILE go together/,
    );
    expect(() => loadConfig({ MQTT_KEY_FILE: 'x' })).toThrow(/go together/);
    expect(() => loadConfig({ TLS_CERT_FILE: 'x' })).toThrow(/go together/);
  });
});
