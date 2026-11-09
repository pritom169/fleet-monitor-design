import { expect, test } from '@playwright/test';

const OUTAGE_S = 14;
let outageEnds = 0;

// The demo server refuses sockets for the whole window. Whatever happens in the test, do not hand a refusing
// server to the next test file.
test.afterEach(async () => {
  const left = outageEnds - Date.now();
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left + 500));
});

/**
 * G3: a robot is never marked offline because *our* link is down. The outage lasts longer than the 10 s
 * offline threshold, so a client that judged freshness by its own clock would turn every robot offline.
 */
test('a lost connection shows the banner, freezes statuses, and recovers', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(/robots need your attention\./);

  const offline = page.getByRole('button', { name: /^Offline \d+$/ });
  const before = (await offline.textContent()) ?? '';

  outageEnds = Date.now() + OUTAGE_S * 1000;
  const res = await request.post(`/control/outage?seconds=${OUTAGE_S}`);
  expect(res.ok()).toBe(true);

  const banner = page.getByText('Live updates paused. Reconnecting… Data shown may be outdated.');
  await expect(banner).toBeVisible();
  await expect(heading).toHaveText(/^Live updates paused\./);
  await expect(page.getByRole('status').getByText('Reconnecting…', { exact: true })).toBeVisible();

  // Time is the subject of this test: wait past the 10 s threshold while the link is down.
  await page.waitForTimeout(11_000);
  await expect(offline).toHaveText(before);
  await expect(page.getByText(/Attempt \d+/)).toBeVisible();

  // The server accepts sockets again after the window; the client's backoff reconnects and the banner goes.
  await expect(banner).toBeHidden({ timeout: 30_000 });
  await expect(heading).toHaveText(/robots need your attention\./);
  await expect(page.getByRole('status').filter({ hasText: /^\s*Live \d\d:\d\d:\d\d$/ })).toBeVisible();
});
