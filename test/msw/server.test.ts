import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from './server';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MSW test server', () => {
  it('serves handlers added with server.use()', async () => {
    server.use(http.get('https://hub.docker.com/ping', () => HttpResponse.json({ ok: true })));
    const response = await fetch('https://hub.docker.com/ping');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('blocks unhandled requests to remote hosts, so tests never reach Docker Hub', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await fetch('https://hub.docker.com/v2/orgs/docker');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain(
      'Unhandled request in a test: GET https://hub.docker.com/v2/orgs/docker',
    );
    expect(consoleError).toHaveBeenCalled();
  });
});
