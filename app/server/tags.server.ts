/**
 * Tag lists, shared by `GET /api/repos/:ns/:repo/tags` and the repository
 * page's Tags tab loader (`app/routes/repo.tags.tsx`), so both read the same
 * cache entry per page and a page view never costs a second upstream call
 * (CLAUDE.md hard rule 3).
 */
import * as v from 'valibot';

import type { Page, Tag } from '../lib/dto';
import { RepoParamsSchema, type RepoParams, type TagsQuery } from '../lib/params';
import { OFFICIAL_NAMESPACE } from '../lib/pull-command';
import {
  TAGS_PAGE_SIZE,
  isValidTagFilter,
  parseTagsUrl,
  type TagsErrorKind,
  type TagsTabData,
} from '../lib/tags-query';
import { cacheKey, orNotFound } from './api.server';
import { config } from './config.server';
import { UpstreamError, dockerHub } from './dockerhub.server';
import { TagsResponseSchema } from './dockerhub.schemas.server';
import { toTagsPage } from './normalize.server';
import { checkRateLimit } from './rateLimit.server';
import type { RepoPageArgs } from './repo.server';
import {
  UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
  UpstreamUnavailableError,
  getCached,
  type Cached,
} from './upstream.server';

/**
 * The cache key of one page of a tag list. `name: ''` is the same entry as no
 * filter, since the client doesn't send an empty one.
 */
export const tagsCacheKey = ({ ns, repo }: RepoParams, query: TagsQuery) =>
  cacheKey('tags', ns, repo, query.page, query.pageSize, query.ordering, query.name || undefined);

/**
 * One page of the repository's tags from Docker Hub, or `null` on an upstream
 * 404: the repository doesn't exist, or `page` is past the last page.
 */
export async function loadTags(params: RepoParams, query: TagsQuery): Promise<Page<Tag> | null> {
  const body = await orNotFound(
    dockerHub.get(
      { endpoint: 'tags', params, query: { ...query, name: query.name || undefined } },
      TagsResponseSchema,
    ),
  );
  return body && toTagsPage(body, query);
}

/**
 * One page of tags through the cache (`getCached`): `value` is `null` on an
 * upstream 404. Throws `UpstreamUnavailableError` when nothing is cached and
 * Docker Hub is failing or the budget is spent.
 */
export function getTags(params: RepoParams, query: TagsQuery): Promise<Cached<Page<Tag> | null>> {
  return getCached(tagsCacheKey(params, query), config.cache.ttlSeconds.tags, () =>
    loadTags(params, query),
  );
}

const emptyPage = (page: number): Page<Tag> => ({
  items: [],
  total: 0,
  page,
  pageSize: TAGS_PAGE_SIZE,
});

/**
 * The Tags tab's loader (`/r/:ns/:repo/tags` and `/_/:repo/tags`), for the
 * first page and for every "Load more" fetch (`&page=N`).
 *
 * Unlike the layout loader (`loadRepoPage`), it **returns** failures as
 * `result: { ok: false, error }` instead of throwing them: a fetcher's thrown
 * error would replace the tab with the route error boundary and drop the
 * tags already shown (ADR-0004 has the same problem for autocomplete). The
 * tab shows the error inline instead, with "Try again".
 *
 * 1. counts the request against the per-client rate limit (`rate_limited`);
 * 2. validates the names (`repo_not_found`, without an upstream call);
 * 3. reads `ordering`, `name` and `page` from the URL (`parseTagsUrl`). A
 *    `name` no tag could have (e.g. `*`) is an empty page, without an upstream call;
 * 4. reads the page through the cache shared with `/api/repos/:ns/:repo/tags`.
 *    An upstream 404 is `repo_not_found` on page 1 and the end of the list
 *    (an empty page) after it; Docker Hub failing with nothing cached is
 *    `unavailable`, and a stale copy comes back with `degraded: true`.
 */
export async function loadRepoTagsTab({ request, params }: RepoPageArgs): Promise<TagsTabData> {
  const url = parseTagsUrl(new URL(request.url).searchParams);
  const fail = (error: TagsErrorKind, retryAfterSeconds?: number): TagsTabData => ({
    ...url,
    result:
      retryAfterSeconds === undefined
        ? { ok: false, error }
        : { ok: false, error, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) },
  });

  try {
    const limit = checkRateLimit(request);
    if (!limit.allowed) return fail('rate_limited', limit.retryAfterSeconds);

    const repoParams = v.safeParse(RepoParamsSchema, {
      ns: params.ns ?? OFFICIAL_NAMESPACE,
      repo: params.repo,
    });
    if (!repoParams.success) return fail('repo_not_found');

    if (!isValidTagFilter(url.name)) {
      return { ...url, result: { ok: true, tags: emptyPage(url.page), degraded: false } };
    }

    const query: TagsQuery = {
      page: url.page,
      pageSize: TAGS_PAGE_SIZE,
      ordering: url.ordering,
      name: url.name || undefined,
    };
    const result = await getTags(repoParams.output, query);
    if (result.value === null) {
      if (url.page === 1) return fail('repo_not_found');
      return { ...url, result: { ok: true, tags: emptyPage(url.page), degraded: false } };
    }
    return { ...url, result: { ok: true, tags: result.value, degraded: result.degraded } };
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) {
      return fail('unavailable', error.retryAfterSeconds);
    }
    if (error instanceof UpstreamError) {
      // `getCached` turns the other kinds into `UpstreamUnavailableError` and
      // `orNotFound` a 404 into `null`, so this is unexpected: treat it as
      // Docker Hub being unavailable, as `toPageErrorResponse` does.
      console.error(`[page] Docker Hub ${error.endpoint} failed unexpectedly (${error.kind})`);
      return fail(
        'unavailable',
        error.retryAfterSeconds ?? UNAVAILABLE_RETRY_AFTER_FALLBACK_SECONDS,
      );
    }
    console.error(`[page] ${new URL(request.url).pathname} failed`, error);
    return fail('unexpected');
  }
}
