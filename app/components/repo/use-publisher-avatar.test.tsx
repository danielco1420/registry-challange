import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { server } from '../../../test/msw/server';
import { clearPublisherAvatarCache, fetchPublisherAvatar } from './use-publisher-avatar';

function publisherApi() {
  const requested: string[] = [];
  server.use(
    http.get('*/api/publishers/:name', ({ params }) => {
      const name = String(params.name);
      requested.push(name);
      return HttpResponse.json({ avatarUrl: `https://www.gravatar.com/avatar/${name}` });
    }),
  );
  return requested;
}

beforeEach(() => clearPublisherAvatarCache());

describe('fetchPublisherAvatar', () => {
  it('shares one request between concurrent lookups of a publisher', async () => {
    const requested = publisherApi();

    const urls = await Promise.all([
      fetchPublisherAvatar('fluent'),
      fetchPublisherAvatar('fluent'),
    ]);

    expect(urls).toEqual([
      'https://www.gravatar.com/avatar/fluent',
      'https://www.gravatar.com/avatar/fluent',
    ]);
    expect(requested).toEqual(['fluent']);
  });

  it('encodes the name into the path', async () => {
    const requested = publisherApi();
    await fetchPublisherAvatar('a b');
    expect(requested).toEqual(['a b']);
  });

  it('keeps at most 100 publishers, dropping the oldest', async () => {
    const requested = publisherApi();
    const names = Array.from({ length: 101 }, (_, i) => `p${i}`);
    await Promise.all(names.map((name) => fetchPublisherAvatar(name)));

    await fetchPublisherAvatar('p100'); // still cached
    await fetchPublisherAvatar('p0'); // evicted, asked again

    expect(requested.filter((name) => name === 'p100')).toHaveLength(1);
    expect(requested.filter((name) => name === 'p0')).toHaveLength(2);
  });
});
