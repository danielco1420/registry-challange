import { describe, expect, it } from 'vitest';

import type { BadRequestBody } from '../lib/validate';
import type { Route } from './+types/theme';
import { action } from './theme';

function post(fields: Record<string, string>): Route.ActionArgs {
  const request = new Request('http://localhost/theme', {
    method: 'POST',
    body: new URLSearchParams(fields),
  });
  return { request, params: {}, context: {} } as unknown as Route.ActionArgs;
}

describe('POST /theme', () => {
  it('answers the fetcher with the theme and sets the cookie', async () => {
    const result = await action(post({ theme: 'dark' }));
    expect(result).not.toBeInstanceOf(Response);
    const { data, init } = result as { data: unknown; init: ResponseInit | null };
    expect(data).toEqual({ theme: 'dark' });
    const headers = new Headers(init?.headers);
    expect(headers.get('Set-Cookie')).toMatch(/^theme=dark; /);
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('deletes the cookie when System is chosen', async () => {
    const result = (await action(post({ theme: 'system' }))) as { init: ResponseInit | null };
    expect(new Headers(result.init?.headers).get('Set-Cookie')).toMatch(/^theme=; Max-Age=0;/);
  });

  it('redirects the no-JS form back to the page, with a 303', async () => {
    const result = await action(post({ theme: 'light', redirectTo: '/r/library/nginx?tab=tags' }));
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/r/library/nginx?tab=tags');
    expect(response.headers.get('Set-Cookie')).toMatch(/^theme=light; /);
  });

  it('never redirects off-site', async () => {
    const response = (await action(
      post({ theme: 'light', redirectTo: '//evil.example/' }),
    )) as Response;
    expect(response.headers.get('Location')).toBe('/');
  });

  it.each<Record<string, string>>([{}, { theme: 'blue' }])(
    'rejects %j with a 400 and no cookie',
    async (fields) => {
      const response = (await action(post(fields))) as Response;
      expect(response.status).toBe(400);
      expect(response.headers.get('Set-Cookie')).toBeNull();
      const body = (await response.json()) as BadRequestBody;
      expect(body.error.code).toBe('invalid_params');
      expect(body.error.issues[0]?.param).toBe('theme');
    },
  );
});
