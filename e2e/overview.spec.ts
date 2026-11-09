import { expect, test, type Page } from '@playwright/test';

const table = (page: Page) => page.getByRole('table', { name: 'Robots, most urgent first' });
/** Robot rows: every row with a robot link (not the header, skeleton or empty state). */
const rows = (page: Page) => table(page).getByRole('row').filter({ has: page.getByRole('link') });

test('shows skeleton rows until the first snapshot, then the fleet, most urgent first', async ({ page }) => {
  // Hold the WebSocket until the skeleton has been seen; then let it through to the real server.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.routeWebSocket(/\/ws$/, async (ws) => {
    await gate;
    ws.connectToServer();
  });

  await page.goto('/');
  await expect(table(page)).toHaveAttribute('aria-busy', 'true');
  await expect(table(page).getByText('Connecting to fleet…')).toBeVisible();

  release();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^\d+ robots need your attention\./);
  await expect(table(page)).not.toHaveAttribute('aria-busy', 'true');

  // Severity order: offline (R-009, R-041), then error (R-024), then low battery.
  await expect(rows(page).nth(0)).toContainText('R-009');
  await expect(rows(page).nth(0)).toContainText('Offline');
  await expect(rows(page).nth(1)).toContainText('R-041');
  await expect(rows(page).nth(2)).toContainText('R-024');
  await expect(rows(page).nth(2)).toContainText('Motor overcurrent');
  await expect(rows(page).nth(3)).toContainText('Low Battery');

  await expect(page.getByRole('columnheader', { name: 'Site' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Position' })).toBeVisible();
});

test('filters by status and search, keeps both in the URL, and clears them', async ({ page }) => {
  await page.goto('/');
  await expect(rows(page).first()).toBeVisible();

  await page.getByRole('button', { name: /^Offline \d+$/ }).click();
  await expect(page).toHaveURL(/[?&]status=offline/);
  await expect(rows(page)).toHaveCount(2);

  const search = page.getByRole('searchbox', { name: 'Find robot by name or ID' });
  await search.fill('R-041');
  await expect(page).toHaveURL(/[?&]q=R-041/);
  await expect(rows(page)).toHaveCount(1);

  await search.fill('no-such-robot');
  await expect(page.getByText('No matching robots.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(rows(page).first()).toBeVisible();
});

test('opens a robot from the table and comes back', async ({ page }) => {
  await page.goto('/');
  await table(page).getByRole('link', { name: 'R-024' }).click();
  await expect(page).toHaveURL(/\/robots\/R-024$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^R-024 has stopped\. Motor overcurrent\./);
  await page.getByRole('link', { name: 'All robots' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test.describe('on a 1024 px laptop', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('hides the Site and Position columns and shows the site under the ID', async ({ page }) => {
    await page.goto('/');
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Battery' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Site' })).toBeHidden();
    await expect(page.getByRole('columnheader', { name: 'Position' })).toBeHidden();
    await expect(rows(page).filter({ hasText: 'R-041' }).getByText('Munich North').filter({ visible: true })).toHaveCount(1);
  });
});

test('an unknown address shows the not-found page', async ({ page }) => {
  await page.goto('/no/such/page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^This page does not exist\./);
});
