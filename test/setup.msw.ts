// Runs in both Vitest projects (node and dom), so no test can reach the real network.
import { afterAll, afterEach, beforeAll } from 'vitest';
import { failOnUnhandledRemoteRequest, server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledFrame: failOnUnhandledRemoteRequest }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
