import { useEffect, useState } from 'react';

import type { Publisher } from '~/lib/dto';

/** Enough for a page of results from distinct publishers; the oldest entry goes first. */
const MAX_ENTRIES = 100;

/**
 * Avatar lookups by publisher name, shared by every `RepoLogo` on the page, so
 * a grid of logo-less cards from one publisher makes a single request. A found
 * avatar and a definite "none" (`404`, or a publisher without one) are kept;
 * a failed request (rate limited, Docker Hub down, offline) is dropped, so a
 * later mount tries again.
 */
const lookups = new Map<string, Promise<string | undefined>>();

async function requestAvatar(name: string): Promise<string | undefined> {
  const response = await fetch(`/api/publishers/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`/api/publishers answered ${response.status}`);
  const { avatarUrl } = (await response.json()) as Partial<Publisher>;
  // The proxy only sends https: URLs; check again rather than trust the shape.
  return typeof avatarUrl === 'string' && avatarUrl.startsWith('https://') ? avatarUrl : undefined;
}

/**
 * The publisher's avatar URL from `GET /api/publishers/:name`, or `undefined`
 * when it has none, doesn't exist, or the request failed. Never rejects.
 */
export function fetchPublisherAvatar(name: string): Promise<string | undefined> {
  const cached = lookups.get(name);
  if (cached) return cached;

  const lookup = requestAvatar(name).catch(() => {
    if (lookups.get(name) === lookup) lookups.delete(name);
    return undefined;
  });
  if (lookups.size >= MAX_ENTRIES) {
    const oldest = lookups.keys().next().value;
    if (oldest !== undefined) lookups.delete(oldest);
  }
  lookups.set(name, lookup);
  return lookup;
}

/** Forget every lookup. For tests. */
export function clearPublisherAvatarCache(): void {
  lookups.clear();
}

/**
 * `fetchPublisherAvatar(name)` as React state, fetched in the browser only
 * once `enabled` (so nothing is requested for a repository whose own logo
 * works, and nothing during server rendering). `undefined` while loading, and
 * when there's no avatar.
 */
export function usePublisherAvatar(name: string, enabled: boolean): string | undefined {
  const [result, setResult] = useState<{ name: string; url: string | undefined }>();

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetchPublisherAvatar(name).then((url) => {
      if (active) setResult({ name, url });
    });
    return () => {
      active = false;
    };
  }, [name, enabled]);

  return enabled && result?.name === name ? result.url : undefined;
}
