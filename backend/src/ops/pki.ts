/**
 * Certificates and the broker ACL (SYSTEM_DESIGN.md §16).
 *
 *   tsx src/ops/pki.ts init   <dir>            dev CA + broker, ingest-client and web certificates
 *   tsx src/ops/pki.ts robots <dir> [--sim]    one client certificate per registered robot + the ACL
 *
 * `robots` reads the registry from DATABASE_URL (or from the simulator with --sim) and writes `acl`:
 * each robot may publish only to fleet/{its site}/{its id}/…, and the ingest server may read fleet/#.
 * Mosquitto maps a client certificate's CN to the ACL user (use_identity_as_username). Re-run after
 * provisioning robots, then reload the broker (SIGHUP).
 *
 * Uses the openssl CLI (OpenSSL 3 or LibreSSL). EC P-256 keys. Idempotent: existing files are kept.
 * The CA here is for development. In production, robot certificates come from your PKI.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RobotInfo } from '@fleet/shared/protocol';

const REQ_CNF = `[req]
distinguished_name = dn
prompt = no
[dn]
CN = placeholder
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
`;

const ssl = (args: string[]) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

function tmp(dir: string, name: string, body: string) {
  const f = path.join(dir, `.${name}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(f, body);
  return f;
}

function newKey(file: string) {
  ssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', file]);
  fs.chmodSync(file, 0o600);
}

export function ensureCa(dir: string): { cert: string; key: string } {
  fs.mkdirSync(dir, { recursive: true });
  const cert = path.join(dir, 'ca.crt');
  const key = path.join(dir, 'ca.key');
  if (fs.existsSync(cert) && fs.existsSync(key)) return { cert, key };
  newKey(key);
  const cnf = tmp(dir, 'req.cnf', REQ_CNF);
  try {
    ssl(['req', '-x509', '-new', '-key', key, '-sha256', '-days', '3650', '-subj', '/CN=Fleet Monitor Dev CA', '-config', cnf, '-extensions', 'v3_ca', '-out', cert]);
  } finally {
    fs.rmSync(cnf, { force: true });
  }
  return { cert, key };
}

export interface LeafOptions {
  cn: string;
  usage: 'server' | 'client';
  dns?: string[];
  ip?: string[];
  days?: number;
}

/** Issue `<dir>/<name>.crt` and `.key`, signed by the CA in `caDir`. Skips if both exist. */
export function issue(caDir: string, dir: string, name: string, o: LeafOptions): { cert: string; key: string } {
  fs.mkdirSync(dir, { recursive: true });
  const cert = path.join(dir, `${name}.crt`);
  const key = path.join(dir, `${name}.key`);
  if (fs.existsSync(cert) && fs.existsSync(key)) return { cert, key };
  const ca = ensureCa(caDir);
  newKey(key);
  const sans = [...(o.dns ?? []).map((d) => `DNS:${d}`), ...(o.ip ?? []).map((i) => `IP:${i}`)];
  const ext = [
    '[leaf]',
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature',
    `extendedKeyUsage = ${o.usage === 'server' ? 'serverAuth' : 'clientAuth'}`,
    'authorityKeyIdentifier = keyid',
    ...(sans.length ? [`subjectAltName = ${sans.join(', ')}`] : []),
    '',
  ].join('\n');
  const cnf = tmp(dir, 'req.cnf', REQ_CNF);
  const extFile = tmp(dir, 'ext.cnf', ext);
  const csr = path.join(dir, `.${name}.csr`);
  try {
    ssl(['req', '-new', '-key', key, '-subj', `/CN=${o.cn}`, '-config', cnf, '-out', csr]);
    ssl([
      'x509', '-req', '-in', csr, '-CA', ca.cert, '-CAkey', ca.key, '-set_serial', `0x${crypto.randomBytes(12).toString('hex')}`,
      '-days', String(o.days ?? 825), '-sha256', '-extfile', extFile, '-extensions', 'leaf', '-out', cert,
    ]);
  } finally {
    for (const f of [cnf, extFile, csr]) fs.rmSync(f, { force: true });
  }
  return { cert, key };
}

export const INGEST_USER = 'fleet-ingest';

/** The broker ACL, generated from the registry. */
export function aclFor(robots: Pick<RobotInfo, 'id' | 'siteKey'>[]): string {
  const lines = [
    '# Generated from the robot registry by backend/src/ops/pki.ts. Do not edit; re-run it and SIGHUP the broker.',
    `user ${INGEST_USER}`,
    'topic read fleet/#',
    'topic read $SYS/#',
    'topic write fleet/+/+/cmd',
    '',
  ];
  for (const r of robots) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(r.id) || !/^[A-Za-z0-9_-]{1,64}$/.test(r.siteKey)) throw new Error(`refusing unsafe robot id or site in ACL: ${r.id} ${r.siteKey}`);
    const base = `fleet/${r.siteKey}/${r.id}`;
    lines.push(`user ${r.id}`, `topic write ${base}/telemetry`, `topic write ${base}/event`, `topic readwrite ${base}/status`, `topic read ${base}/cmd`, '');
  }
  return lines.join('\n');
}

/** Everything a dev stack needs except robot certificates. */
export function initPki(dir: string, extraDns: string[] = []) {
  ensureCa(dir);
  issue(dir, dir, 'broker', { cn: 'mosquitto', usage: 'server', dns: ['localhost', 'mosquitto', ...extraDns], ip: ['127.0.0.1'] });
  issue(dir, dir, 'ingest', { cn: INGEST_USER, usage: 'client' });
  issue(dir, dir, 'web', { cn: 'localhost', usage: 'server', dns: ['localhost', 'server', ...extraDns], ip: ['127.0.0.1'] });
}

export function robotPki(dir: string, robots: Pick<RobotInfo, 'id' | 'siteKey'>[]) {
  const robotDir = path.join(dir, 'robots');
  let issued = 0;
  for (const r of robots) {
    const had = fs.existsSync(path.join(robotDir, `${r.id}.crt`));
    issue(dir, robotDir, r.id, { cn: r.id, usage: 'client' });
    if (!had) issued++;
  }
  fs.writeFileSync(path.join(dir, 'acl'), aclFor(robots), { mode: 0o644 });
  return { issued, total: robots.length };
}

/** Let the broker's unprivileged user read its own key (the official image runs as uid 1883). */
function shareWithBroker(dir: string) {
  const uid = Number(process.env.BROKER_UID ?? 1883);
  if (process.getuid?.() !== 0) return;
  for (const f of ['broker.key', 'broker.crt', 'ca.crt', 'acl', 'ingest.crt', 'ingest.key']) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) fs.chownSync(p, uid, uid);
  }
}

// CLI
if (process.argv[1]?.endsWith('pki.ts')) {
  const [cmd, dir = 'deploy/certs', ...flags] = process.argv.slice(2);
  if (cmd === 'init') {
    initPki(dir, (process.env.EXTRA_DNS ?? '').split(',').filter(Boolean));
    shareWithBroker(dir);
    console.log(`[pki] CA, broker, ingest and web certificates in ${dir}`);
  } else if (cmd === 'robots') {
    let robots: RobotInfo[];
    if (flags.includes('--sim')) {
      const { createFleet } = await import('../sim/fleet');
      robots = createFleet({ count: Number(process.env.ROBOTS ?? 50) }).registry();
    } else {
      const { Repo } = await import('../server/repo/pg');
      const repo = new Repo(process.env.DATABASE_URL ?? 'postgres://fleet:fleet@localhost:5432/fleet');
      robots = await repo.loadRegistry();
      await repo.close();
    }
    const r = robotPki(dir, robots);
    shareWithBroker(dir);
    console.log(`[pki] ${r.total} robots in the ACL, ${r.issued} new certificates`);
  } else {
    console.error('usage: pki.ts init|robots <dir> [--sim]');
    process.exit(2);
  }
}
