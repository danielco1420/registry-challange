import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLoopbackHost, server } from './server';

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

  it('blocks unhandled WebSocket connections to remote hosts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const socket = new WebSocket('wss://hub.docker.com/socket');
    const outcome = await new Promise<string>((resolve) => {
      socket.addEventListener('open', () => resolve('open'));
      // MSW sets the error our callback threw as the event's `cause`, which tells
      // this block apart from a real connection that failed.
      socket.addEventListener('error', (event) =>
        resolve(String((event as Event & { cause?: unknown }).cause)),
      );
    });
    socket.close();
    expect(outcome).toContain('Unhandled request in a test: WebSocket wss://hub.docker.com/socket');
    expect(consoleError).toHaveBeenCalled();
  });

  it.each([
    ['localhost', true],
    ['app.localhost', true],
    ['127.0.0.1', true],
    ['127.1.2.3', true],
    ['[::1]', true],
    ['hub.docker.com', false],
    ['localhost.example.com', false],
    ['127.0.0.1.nip.io', false],
    ['10.0.0.1', false],
  ])('isLoopbackHost(%j) is %j', (hostname, expected) => {
    expect(isLoopbackHost(hostname)).toBe(expected);
  });
});
