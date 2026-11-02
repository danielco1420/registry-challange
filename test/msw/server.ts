/**
 * The MSW server shared by every Node test (started in `test/setup.node.ts`).
 *
 * It starts with no handlers: a test adds the ones it needs with `server.use()`,
 * and they are reset after each test. Handlers built from the recorded Docker Hub
 * responses in `fixtures/dockerhub/` land here with T08.
 */
import { setupServer } from 'msw/node';

export const server = setupServer();

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Lets requests to loopback hosts through (tests may run a local HTTP server)
 * and blocks every other unhandled request, so no test reaches the real Docker
 * Hub: MSW logs an error and answers with a 500 whose body names the request.
 */
export function failOnUnhandledRemoteRequest({
  frame,
  defaults,
}: {
  frame: { protocol: string; data: unknown };
  defaults: { error: () => void };
}): void {
  if (frame.protocol !== 'http') return;
  const { request } = frame.data as { request: Request };
  if (LOOPBACK_HOSTS.has(new URL(request.url).hostname)) return;
  defaults.error();
  throw new Error(`Unhandled request in a test: ${request.method} ${request.url}`);
}
