import { expect, test } from '@playwright/test';

test('R-017: a low robot says what it is doing about it', async ({ page }) => {
  await page.goto('/robots/R-017');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(/^R-017 is low on battery\. \d+% left/);

  await expect(page.getByRole('region', { name: 'Battery', exact: true })).toContainText('%');
  await expect(page.getByRole('region', { name: 'Battery trend' }).locator('svg').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Activity' }).getByRole('listitem').first()).toBeVisible();

  // The plan comes from `taskKind` and the bay from the `bay_assigned` event, never from display text.
  // The scripted robot is on its way to bay 3 for the first minutes of a run.
  if (/on its way to charge/.test((await heading.textContent()) ?? '')) {
    await expect(page.getByRole('region', { name: 'Current task' })).toContainText('Charging bay 3');
  }
});

test('R-041: an offline robot shows last-known values and says we do not know', async ({ page }) => {
  await page.goto('/robots/R-041');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^R-041 is offline\. No report for .+\. We do not know its state\./);
  await expect(page.getByRole('region', { name: 'Battery', exact: true })).toContainText('Battery · last known');
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Went offline');
});

test('an unknown robot ID says so', async ({ page }) => {
  await page.goto('/robots/R-999');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^There is no robot called R-999\./);
});
