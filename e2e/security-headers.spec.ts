import { expect, test, type Page } from '@playwright/test';

// Security headers and CSP on the production build (questionnaire G43, RISKS 3.2/3.3).

const BASE_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function scriptNonce(csp: string | undefined): string {
  const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(csp ?? '')?.[1];
  expect(nonce, `no script nonce in CSP: ${csp}`).toBeTruthy();
  return nonce as string;
}

/** Records CSP violations from the first script on, before the page's own scripts run. */
async function trackViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.effectiveDirective} blocked ${event.blockedURI}`);
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

test('HTML pages get the nonce CSP and the security headers', async ({ request }) => {
  const response = await request.get('/');
  const headers = response.headers();
  expect(headers).toMatchObject(BASE_HEADERS);

  const csp = headers['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("img-src 'self' https://*.cloudfront.net https://www.gravatar.com");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-inline');

  // Every script tag React Router renders carries this response's nonce.
  const nonce = scriptNonce(csp);
  const scripts = [...(await response.text()).matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);

  // A fresh nonce per response.
  const again = await request.get('/');
  expect(scriptNonce(again.headers()['content-security-policy'])).not.toBe(nonce);
});

test('not-found pages get the same headers', async ({ request }) => {
  const response = await request.get('/no-such-page');
  expect(response.status()).toBe(404);
  expect(response.headers()).toMatchObject(BASE_HEADERS);
  scriptNonce(response.headers()['content-security-policy']);
});

test('API responses get a locked-down CSP and the security headers', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect(response.headers()).toMatchObject({
    ...BASE_HEADERS,
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  });
});

test('the page loads and hydrates with no CSP violations', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const violations = await trackViolations(page);

  await page.goto('/');
  // Set by React Router's <HydratedRouter> once the client has hydrated.
  await page.waitForFunction(() => '__reactRouterDataRouter' in window);
  await page.waitForLoadState('networkidle');

  expect(await violations()).toEqual([]);
  expect(errors).toEqual([]);
});

test('the CSP blocks an inline script without the nonce', async ({ page }) => {
  const violations = await trackViolations(page);
  await page.goto('/');

  const ran = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true;';
    document.body.append(script);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return '__injected' in window;
  });

  expect(ran).toBe(false);
  expect(await violations()).toContainEqual(expect.stringMatching(/^script-src/));
});
