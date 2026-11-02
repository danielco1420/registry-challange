import { afterAll, afterEach, beforeAll } from 'vitest';
import { failOnUnhandledRemoteRequest, server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledFrame: failOnUnhandledRemoteRequest }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
