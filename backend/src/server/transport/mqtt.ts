import mqtt from 'mqtt';
import { ConnStatus, RobotEventMsg, Telemetry, parseTopic } from '@fleet/shared/telemetry';
import type { TlsFiles } from '../config';

export interface MqttHandlers {
  telemetry: (t: Telemetry, receivedAt: number) => void;
  event: (e: RobotEventMsg, receivedAt: number) => void;
  status: (robotId: string, siteId: string, s: ConnStatus, retained: boolean, receivedAt: number) => void;
  invalid: (reason: string, topic: string) => void;
  link: (up: boolean) => void;
}

export interface MqttOptions {
  url: string;
  clientId?: string;
  sites?: string[];
  tls?: TlsFiles;
}

export function connectMqtt(o: MqttOptions, h: MqttHandlers) {
  const client = mqtt.connect(o.url, {
    clientId: o.clientId ?? `fleet-ingest-${process.pid}`,
    clean: true,
    keepalive: 10,
    reconnectPeriod: 1000,
    connectTimeout: 5000,
    ...(o.tls ? { ca: o.tls.ca, cert: o.tls.cert, key: o.tls.key, rejectUnauthorized: true } : {}),
  });
  const filters = o.sites?.length ? o.sites.map((s) => `fleet/${s}/#`) : ['fleet/+/+/#'];

  let up = false;
  const setUp = (v: boolean) => {
    if (v === up) return;
    up = v;
    h.link(v);
  };

  client.on('connect', () => {
    client.subscribe(Object.fromEntries(filters.map((f) => [f, { qos: 1 as const }])), (err) => {
      if (err) {
        h.invalid(`subscribe failed: ${err.message}`, filters.join(','));
        client.end(true);
        return;
      }
      setUp(true);
    });
  });
  client.on('close', () => setUp(false));
  client.on('offline', () => setUp(false));
  client.on('error', () => setUp(false));

  client.on('message', (topic, payload, packet) => {
    const receivedAt = Date.now();
    const tp = parseTopic(topic);
    if (!tp) return;
    if (tp.kind === 'status') {
      const s = ConnStatus.safeParse(payload.toString());
      if (!s.success) return h.invalid('status payload', topic);
      return h.status(tp.robotId, tp.siteId, s.data, packet.retain, receivedAt);
    }
    let json: unknown;
    try {
      json = JSON.parse(payload.toString());
    } catch {
      return h.invalid('not JSON', topic);
    }
    if (tp.kind === 'telemetry') {
      const t = Telemetry.safeParse(json);
      if (!t.success) return h.invalid(t.error.issues[0]?.message ?? 'schema', topic);
      if (t.data.id !== tp.robotId || t.data.siteId !== tp.siteId) return h.invalid('topic does not match payload', topic);
      return h.telemetry(t.data, receivedAt);
    }
    const e = RobotEventMsg.safeParse(json);
    if (!e.success) return h.invalid(e.error.issues[0]?.message ?? 'schema', topic);
    if (e.data.id !== tp.robotId) return h.invalid('topic does not match payload', topic);
    h.event(e.data, receivedAt);
  });

  return {
    get connected() {
      return up;
    },
    close: () => new Promise<void>((resolve) => client.end(false, {}, () => resolve())),
  };
}
