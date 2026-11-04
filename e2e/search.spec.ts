import { expect, test, type Page } from '@playwright/test';

// `/search` (T23) and the repository pages (T24) don't exist yet, so these
// navigations land on the "Page not found" page. Only the URL is checked.

function searchBox(page: Page) {
  return page.getByRole('search', { name: 'Search images' });
}

/** Answers autocomplete in the browser, so the test never reaches Docker Hub. */
async function stubSuggestions(page: Page) {
  await page.route(/\/api\/search\/suggestions\?/, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'library/nginx',
            namespace: 'library',
            name: 'nginx',
            displayName: 'nginx',
            owner: 'library',
            description: 'Official build of Nginx.',
            badge: 'official',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
        source: 'v4',
      },
    }),
  );
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('submitting on Explore lands on /search?q=', async ({ page }) => {
    await page.goto('/');
    const box = searchBox(page);
    await box.getByRole('combobox').fill('nginx');
    await box.getByRole('combobox').press('Enter');
    await expect(page).toHaveURL('/search?q=nginx');
  });

  test('the header search box submits too', async ({ page }) => {
    await page.goto('/r/bitnami/nginx');
    const header = page.getByRole('banner');
    await header.getByRole('combobox', { name: 'Search images' }).fill('redis');
    await header.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL('/search?q=redis');
  });
});

test.describe('with JavaScript', () => {
  test('picking a suggestion opens its repository page', async ({ page }) => {
    await stubSuggestions(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const input = searchBox(page).getByRole('combobox');
    await input.pressSequentially('ngin');

    const option = page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option');
    await expect(option).toHaveText(/nginx/);
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', /.+/);
    await input.press('Enter');
    await expect(page).toHaveURL('/_/nginx');
  });

  test('remembers a search and can forget it', async ({ page }) => {
    await stubSuggestions(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const input = searchBox(page).getByRole('combobox');
    await input.pressSequentially('redis');
    await input.press('Escape');
    await input.press('Enter');
    await expect(page).toHaveURL('/search?q=redis');

    await page.goto('/', { waitUntil: 'networkidle' });
    await searchBox(page).getByRole('combobox').click();
    const recent = page.getByRole('listbox', { name: 'Recent searches' });
    await expect(recent.getByRole('option')).toHaveText(['redis']);

    await page.getByRole('button', { name: 'Clear recent searches' }).click();
    await expect(page.getByRole('option')).toHaveCount(0);
  });
});
