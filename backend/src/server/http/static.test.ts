import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { serveStatic, shellCsp } from './static';

const tmp: string[] = [];
const mk = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
  tmp.push(d);
  return d;
};
afterAll(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** A ServerResponse stand-in: records the head and collects the piped body. */
function fakeRes() {
  const body = new PassThrough();
  const out = { status: 0, headers: {} as Record<string, string>, text: '' };
  const res = Object.assign(body, {
    writeHead(status: number, headers: Record<string, string>) {
      out.status = status;
      out.headers = headers;
      return res;
    },
  });
  const done = new Promise<void>((resolve) => {
    body.on('data', (c) => (out.text += c));
    body.on('end', resolve);
  });
  return { res: res as unknown as ServerResponse, out, done };
}

describe('shellCsp', () => {
  it('allows exactly the inline scripts of the served index.html, by hash', () => {
    const dir = mk();
    const inline = "\n  document.documentElement.dataset.theme = 'dark';\n";
    fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><script>${inline}</script><script type="module" src="/assets/app.js"></script></head></html>`);
    const csp = shellCsp(dir)!;
    const hash = crypto.createHash('sha256').update(inline).digest('base64');
    expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
    expect(csp.match(/sha256-/g)!.length).toBe(1); // the module script is covered by 'self', not hashed
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('has no policy without an index.html, and no trailing space without inline scripts', () => {
    const dir = mk();
    expect(shellCsp(dir)).toBeUndefined();
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    const csp = shellCsp(dir)!;
    expect(csp).toContain("script-src 'self';");
    expect(csp).toMatch(/form-action 'self'$/);
  });
});

describe('serveStatic', () => {
  const dir = mk();
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>shell</html>');
  fs.writeFileSync(path.join(dir, 'assets', 'app-1234.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'logo.svg'), '<svg/>');
  fs.writeFileSync(path.join(dir, 'data.bin'), 'x');

  it('serves hashed assets as immutable, with their type', async () => {
    const { res, out, done } = fakeRes();
    expect(serveStatic(dir, '/assets/app-1234.js', res)).toBe(true);
    await done;
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe('text/javascript');
    expect(out.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(out.text).toBe('console.log(1)');
    expect(out.headers['content-security-policy']).toBeUndefined();
  });

  it('revalidates other files, and falls back to octet-stream for unknown types', async () => {
    const a = fakeRes();
    serveStatic(dir, '/logo.svg', a.res);
    await a.done;
    expect(a.out.headers).toMatchObject({ 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' });
    const b = fakeRes();
    serveStatic(dir, '/data.bin', b.res);
    await b.done;
    expect(b.out.headers['content-type']).toBe('application/octet-stream');
  });

  it('serves index.html with the CSP for client routes, directories and paths outside the root', async () => {
    for (const p of ['/robots/R-001', '/assets', '/../../etc/passwd', '/%2e%2e/secret']) {
      const { res, out, done } = fakeRes();
      expect(serveStatic(dir, p, res, "default-src 'self'")).toBe(true);
      await done;
      expect(out.text).toBe('<html>shell</html>');
      expect(out.headers['content-security-policy']).toBe("default-src 'self'");
      expect(out.headers['x-frame-options']).toBe('DENY');
    }
  });

  it('serves the shell without a CSP header when none is given', async () => {
    const { res, out, done } = fakeRes();
    serveStatic(dir, '/', res);
    await done;
    expect(out.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(out.headers['content-security-policy']).toBeUndefined();
  });

  it('returns false when there is nothing to serve', () => {
    const { res } = fakeRes();
    expect(serveStatic(mk(), '/anything', res)).toBe(false);
  });
});
