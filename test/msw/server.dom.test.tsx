// Runs in the jsdom (`dom`) project: component tests are guarded by MSW too.
import { describe, expect, it, vi } from 'vitest';

describe('MSW in the dom project', () => {
  it('blocks unhandled fetches to remote hosts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await fetch('https://hub.docker.com/v2/orgs/docker');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Unhandled request in a test');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
