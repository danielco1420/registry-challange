import { expect, test } from '@playwright/test';

// Neither case calls Docker Hub: the redirect and the name check happen before
// the loader reads the repository.

test.describe('repository page URLs', () => {
  const redirects: [from: string, to: string][] = [
    ['/r/library/nginx', '/_/nginx'],
    ['/r/library/nginx/tags?ordering=name', '/_/nginx/tags?ordering=name'],
  ];
  for (const [from, to] of redirects) {
    test(`${from} redirects to ${to} (301)`, async ({ request }) => {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      expect(response.headers()['location']).toBe(to);
    });
  }

  test('an invalid repository name is "Repository not found" (404)', async ({ page }) => {
    const response = await page.goto('/r/fluent/Not..Valid');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle('Repository not found');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Repository not found' }),
    ).toBeVisible();
  });
});
