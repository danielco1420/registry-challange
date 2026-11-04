import { expect, test, type Page } from '@playwright/test';

/** The page background, from the tokens in app/app.css. */
const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(10, 10, 10)';

function bodyBackground(page: Page) {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test.describe('theme', () => {
  test('the server renders the theme from the cookie, so nothing flashes', async ({ request }) => {
    const darkResponse = await request.get('/', { headers: { Cookie: 'theme=dark' } });
    // The HTML depends on the cookie, so shared caches must key on it.
    expect(darkResponse.headers()['vary']).toMatch(/\bCookie\b/i);
    const dark = await darkResponse.text();
    expect(dark).toMatch(/<html lang="en" class="dark">/);

    const light = await (await request.get('/', { headers: { Cookie: 'theme=light' } })).text();
    expect(light).toMatch(/<html lang="en" class="light">/);

    // System (no cookie): no class; CSS follows prefers-color-scheme.
    const system = await (await request.get('/')).text();
    expect(system).toMatch(/<html lang="en">/);
  });

  test('System follows the OS color scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    expect(await bodyBackground(page)).toBe(DARK_BG);

    await page.emulateMedia({ colorScheme: 'light' });
    expect(await bodyBackground(page)).toBe(LIGHT_BG);
  });

  test('the toggle switches the theme and the choice survives a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const toggle = page.getByRole('group', { name: 'Color theme' });
    await expect(toggle.getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The class flips optimistically, before the cookie is set. Wait for the POST
    // itself, or the reload can abort it and the choice is lost.
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/theme.data',
    );
    await toggle.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass('dark');
    expect(await bodyBackground(page)).toBe(DARK_BG);
    expect((await saved).ok()).toBe(true);

    await page.reload();
    await expect(page.locator('html')).toHaveClass('dark');
    await expect(toggle.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Back to System: the cookie is cleared and the OS (light) wins again.
    await toggle.getByRole('button', { name: 'System' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark|light/);
    expect(await bodyBackground(page)).toBe(LIGHT_BG);
  });

  test('the toggle works without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('html')).toHaveClass('dark');
    await context.close();
  });

  test('a cross-site form cannot change the theme', async ({ request }) => {
    const response = await request.post('/theme', {
      headers: { Origin: 'https://evil.example' },
      form: { theme: 'dark', redirectTo: '/' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    expect(response.headers()['set-cookie']).toBeUndefined();
  });
});

test('the skip link is the first tab stop and moves focus to main', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('the shell has header, main and footer landmarks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('link', { name: "Danny's Dockers" }),
  ).toHaveAttribute('href', '/');
});
