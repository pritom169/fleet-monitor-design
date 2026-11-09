/**
 * Robot simulator in MQTT mode: one MQTT client per robot, the way real robots connect (§10).
 *
 *   fleet/{site}/{id}/telemetry  QoS 0, 1 Hz, at each robot's own offset inside the second
 *   fleet/{site}/{id}/event      QoS 1, task / fault / Wi-Fi / charging
 *   fleet/{site}/{id}/status     QoS 1 retained `online`; LWT `offline` on an unclean disconnect
 *
 * Incidents happen live, shortly after start (sim/fleet.ts, `incidents: 'live'`):
 *   R-024 fault at +8 s · R-041 weak Wi-Fi at +20 s, link drops at +45 s (LWT) · R-009 silent at +35 s
 *
 * Env: MQTT_URL (mqtt://localhost:1883), ROBOTS (50; more for load tests), CLOCK_SKEW_MS (0),
 *      MQTT_CERT_DIR: use mqtts with each robot's own certificate from <dir>/robots/<id>.crt|key (pki.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import { topic, type RobotEventMsg, type Telemetry } from '@fleet/shared/telemetry';
import { isRobotEventCode } from '@fleet/shared/protocol';
import { createFleet, type SimRobot } from './fleet';

const URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const COUNT = Number(process.env.ROBOTS ?? 50);
/** Robot clocks are off by up to this much, to show that ordering and freshness never use them. */
const SKEW = Number(process.env.CLOCK_SKEW_MS ?? 0);
const CERT_DIR = process.env.MQTT_CERT_DIR;
const CA = CERT_DIR ? fs.readFileSync(path.join(CERT_DIR, 'ca.crt')) : undefined;

/** Each robot authenticates with its own certificate; the broker ACL limits it to its own topics. */
function tlsFor(id: string) {
  if (!CERT_DIR) return {};
  return {
    ca: CA,
    cert: fs.readFileSync(path.join(CERT_DIR, 'robots', `${id}.crt`)),
    key: fs.readFileSync(path.join(CERT_DIR, 'robots', `${id}.key`)),
    rejectUnauthorized: true,
  };
}

/**
 * The boot counter must grow across restarts of a robot, or the server would treat a restarted robot's
 * samples as older than the ones it stored. A real robot stores it; the simulator derives it from its
 * own start time in seconds, which only ever grows.
 */
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
    // Battery low / recovered and went offline are the server's to derive. The event ID is the server's to stamp.
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
  if (r.mode === 'never') continue; // R-051: registered, never reports
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
        // Pull the plug: no DISCONNECT packet, so the broker publishes the last will after the keepalive.
        radio.dropped = true;
        radio.client.options.reconnectPeriod = 0;
        radio.client.stream.destroy();
        console.log(`[robots] ${r.info.id} dropped its link (the broker will publish its last will)`);
      } else if (!radio.dropped) {
        radio.dropped = true; // silent: stays connected, keeps pinging, sends nothing
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
  // A clean shutdown: robots say goodbye, so no last will is published.
  for (const { client } of radios.values()) client.end(false);
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
