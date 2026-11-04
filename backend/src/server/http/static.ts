import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/**
 * A Content-Security-Policy for the built app shell. Inline scripts (the pre-paint theme snippet) are
 * allowed by hash, computed from the index.html actually being served.
 */
export function shellCsp(dir: string): string | undefined {
  const index = path.join(path.resolve(dir), 'index.html');
  if (!fs.existsSync(index)) return undefined;
  const html = fs.readFileSync(index, 'utf8');
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** Serve the built client from `dir`, with index.html as the fallback for client-side routes. */
export function serveStatic(dir: string, pathname: string, res: ServerResponse, csp?: string): boolean {
  const root = path.resolve(dir);
  let file = path.join(root, decodeURIComponent(pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) return false;
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  const html = path.extname(file) === '.html';
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    ...(html && csp ? { 'content-security-policy': csp, 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' } : {}),
  });
  fs.createReadStream(file).pipe(res);
  return true;
}
