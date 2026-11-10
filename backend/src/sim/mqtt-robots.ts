import fs from 'node:fs';
import path from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import { topic, type RobotEventMsg, type Telemetry } from '@fleet/shared/telemetry';
import { isRobotEventCode } from '@fleet/shared/protocol';
import { createFleet, type SimRobot } from './fleet';

const URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const COUNT = Number(process.env.ROBOTS ?? 50);
const SKEW = Number(process.env.CLOCK_SKEW_MS ?? 0);
const CERT_DIR = process.env.MQTT_CERT_DIR;
const CA = CERT_DIR ? fs.readFileSync(path.join(CERT_DIR, 'ca.crt')) : undefined;

function tlsFor(id: string) {
  if (!CERT_DIR) return {};
  return {
    ca: CA,
    cert: fs.readFileSync(path.join(CERT_DIR, 'robots', `${id}.crt`)),
    key: fs.readFileSync(path.join(CERT_DIR, 'robots', `${id}.key`)),
    rejectUnauthorized: true,
  };
}

const BOOT = Math.floor(Date.now() / 1000);

interface Radio {
  r: SimRobot;
  client: MqttClient;
  seq: number;
  skew: number;
  dropped: boolean;
}

const radios = new Map<string, Radio>();

const fleet = createFleet({
  incidents: 'live',
  count: COUNT,
  onEvent(e) {
    if (!isRobotEventCode(e.code)) return;
    const radio = radios.get(e.id);
    if (!radio || radio.dropped) return;
    const msg: RobotEventMsg = {
      id: e.id, robotTs: Date.now() + radio.skew, kind: e.kind as RobotEventMsg['kind'], code: e.code, text: e.text,
      ...(e.sub ? { sub: e.sub } : {}), ...(e.bay !== undefined ? { bay: e.bay } : {}),
    };
    radio.client.publish(topic(radio.r.info.siteKey, e.id, 'event'), JSON.stringify(msg), { qos: 1 });
  },
});

let connected = 0;
for (const r of fleet.robots) {
  if (r.mode === 'never') continue;
  const id = r.info.id;
  const site = r.info.siteKey;
  const status = topic(site, id, 'status');
  const client = mqtt.connect(URL, {
    clientId: `robot-${id}`,
    clean: true,
    keepalive: 10,
    reconnectPeriod: 2000,
    will: { topic: status, payload: Buffer.from('offline'), qos: 1, retain: true },
    ...tlsFor(id),
  });
  const radio: Radio = { r, client, seq: 0, skew: Math.round((Math.random() * 2 - 1) * SKEW), dropped: false };
  radios.set(id, radio);
  client.on('connect', () => {
    connected++;
    client.publish(status, 'online', { qos: 1, retain: true });
  });
  client.on('close', () => connected > 0 && connected--);
  client.on('error', () => {});
}

function publish(radio: Radio) {
  const rep = radio.r.last;
  if (!rep || radio.dropped || !radio.client.connected) return;
  const t: Telemetry = {
    id: rep.id,
    siteId: radio.r.info.siteKey,
    boot: BOOT,
    seq: radio.seq++,
    robotTs: Date.now() + radio.skew,
    battery: rep.battery,
    x: rep.x,
    y: rep.y,
    state: rep.state,
    ...(rep.fault ? { fault: rep.fault } : {}),
    task: rep.task,
    taskKind: rep.taskKind,
    since: rep.since,
  };
  radio.client.publish(topic(t.siteId, t.id, 'telemetry'), JSON.stringify(t), { qos: 0 });
}

let lastTick = fleet.start - 1000;
function tick() {
  const t = Math.floor(Date.now() / 1000) * 1000;
  if (t <= lastTick) return;
  lastTick = t;
  fleet.tick(t);
  for (const radio of radios.values()) {
    const r = radio.r;
    if (r.mode === 'gone') {
      if (r.goneHow === 'crash' && !radio.dropped) {
        radio.dropped = true;
        radio.client.options.reconnectPeriod = 0;
        radio.client.stream.destroy();
        console.log(`[robots] ${r.info.id} dropped its link (the broker will publish its last will)`);
      } else if (!radio.dropped) {
        radio.dropped = true;
        console.log(`[robots] ${r.info.id} went silent (still connected)`);
      }
      continue;
    }
    setTimeout(() => publish(radio), r.phase);
  }
}

setTimeout(() => {
  tick();
  setInterval(tick, 1000);
}, 1000 - (Date.now() % 1000));

setInterval(() => console.log(`[robots] ${connected}/${radios.size} connected to ${URL}`), 30_000);
setTimeout(() => console.log(`[robots] ${connected}/${radios.size} connected to ${URL} · boot ${BOOT}`), 2000);

const stop = () => {
  for (const { client } of radios.values()) client.end(false);
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
