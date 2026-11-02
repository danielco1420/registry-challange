/**
 * The MSW server shared by every test, in both Vitest projects (started in
 * `test/setup.msw.ts`).
 *
 * It starts with no handlers: a test adds the ones it needs with `server.use()`,
 * and they are reset after each test. Handlers built from the recorded Docker Hub
 * responses in `fixtures/dockerhub/` land here with T08.
 */
import { setupServer } from 'msw/node';

export const server = setupServer();

/** `localhost`, `*.localhost`, `127.0.0.0/8` and `[::1]`. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/** The structural part of MSW's unhandled-frame callback argument that we use. */
interface UnhandledFrame {
  frame: { protocol: string; data: unknown };
  defaults: { error: () => unknown };
}

/** The URL and a readable label for an HTTP request or WebSocket connection frame. */
function describeFrame(frame: UnhandledFrame['frame']): { url: URL | null; label: string } {
  if (frame.protocol === 'http') {
    const { request } = frame.data as { request: Request };
    return { url: new URL(request.url), label: `${request.method} ${request.url}` };
  }
  if (frame.protocol === 'ws') {
    const { connection } = frame.data as { connection: { client: { url: URL | string } } };
    const url = new URL(connection.client.url);
    return { url, label: `WebSocket ${url.href}` };
  }
  return { url: null, label: `${frame.protocol} frame` };
}

/**
 * Lets frames to loopback hosts through (tests may run a local HTTP server) and
 * blocks every other unhandled frame, HTTP or WebSocket, so no test reaches the
 * real Docker Hub. MSW logs an error; an HTTP request is answered with a 500
 * whose body names the request, and a WebSocket gets an `error` event instead
 * of connecting.
 */
export async function failOnUnhandledRemoteRequest({
  frame,
  defaults,
}: UnhandledFrame): Promise<void> {
  const { url, label } = describeFrame(frame);
  if (url && isLoopbackHost(url.hostname)) return;
  await defaults.error();
  throw new Error(`Unhandled request in a test: ${label}`);
}
