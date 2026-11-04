/**
 * Repository details, shared by `GET /api/repos/:ns/:repo` and the repository
 * page loader (`app/routes/repo.tsx`), so both read the same cache entry and a
 * page view never costs a second upstream call (CLAUDE.md hard rule 3).
 */
import { redirect } from 'react-router';
import * as v from 'valibot';

import type { RepoDetails } from '../lib/dto';
import { RepoParamsSchema, type RepoParams } from '../lib/params';
import { OFFICIAL_NAMESPACE } from '../lib/pull-command';
import { repoPath } from '../lib/repo-path';
import { cacheKey, orNotFound } from './api.server';
import { config } from './config.server';
import { dockerHub } from './dockerhub.server';
import { RepositorySchema } from './dockerhub.schemas.server';
import { toRepoDetails } from './normalize.server';
import { pageNotFound, toPageErrorResponse } from './pageError.server';
import { enforceRateLimit } from './rateLimit.server';
import { getCached, type Cached } from './upstream.server';

/** The cache key of a repository's details. */
export const repoCacheKey = ({ ns, repo }: RepoParams) => cacheKey('repo', ns, repo);

/** The repository's details from Docker Hub, or `null` when it doesn't exist (an upstream 404). */
export async function loadRepoDetails(params: RepoParams): Promise<RepoDetails | null> {
  const repo = await orNotFound(
    dockerHub.get({ endpoint: 'repository', params }, RepositorySchema),
  );
  return repo && toRepoDetails(repo);
}

/**
 * The repository's details through the cache (`getCached`): `value` is `null`
 * for a missing repository. Throws `UpstreamUnavailableError` when nothing is
 * cached and Docker Hub is failing or the budget is spent.
 */
export function getRepoDetails(params: RepoParams): Promise<Cached<RepoDetails | null>> {
  return getCached(repoCacheKey(params), config.cache.ttlSeconds.repo, () =>
    loadRepoDetails(params),
  );
}

/** What the repository page's layout loader returns. */
export interface RepoPageData {
  repo: RepoDetails;
  /** The data is a stale copy: show the degraded banner (ADR-0003). */
  degraded: boolean;
}

export interface RepoPageArgs {
  request: Request;
  /** `{ ns, repo }` from `/r/:ns/:repo`, or `{ repo }` from `/_/:repo` (official images). */
  params: { ns?: string; repo?: string };
}

/**
 * The repository page's URL for `request` when it isn't the canonical one:
 * `/r/library/{repo}[/tags]` becomes `/_/{repo}[/tags]` (questionnaire C14),
 * keeping the query string. `null` when `request` is already canonical.
 */
export function canonicalRepoUrl(request: Request, params: RepoParams): string | null {
  const url = new URL(request.url);
  if (params.ns !== OFFICIAL_NAMESPACE || !url.pathname.startsWith('/r/')) return null;
  // What follows `/r/library/{repo}` (the tab, e.g. `tags`) is one of our own
  // child routes, since the router matched it; it's kept as is.
  const rest = url.pathname.split('/').slice(4).filter(Boolean).join('/');
  return `${repoPath(params.ns, params.repo)}${rest ? `/${rest}` : ''}${url.search}`;
}

/**
 * The repository page's layout loader (`/r/:ns/:repo` and `/_/:repo`, with
 * their Overview and Tags tabs):
 *
 * 1. counts the request against the per-client rate limit;
 * 2. validates the names: an invalid one is "repository not found" (404),
 *    without an upstream call;
 * 3. redirects `/r/library/{repo}` to `/_/{repo}` (301);
 * 4. reads the details through the cache shared with `/api/repos/:ns/:repo`.
 *    A missing repository is a cached "repository not found" (404); Docker Hub
 *    failing with nothing cached is "Docker Hub unavailable" (503), and a
 *    stale copy comes back with `degraded: true`.
 */
export async function loadRepoPage({ request, params }: RepoPageArgs): Promise<RepoPageData> {
  try {
    enforceRateLimit(request);

    const parsed = v.safeParse(RepoParamsSchema, {
      ns: params.ns ?? OFFICIAL_NAMESPACE,
      repo: params.repo,
    });
    if (!parsed.success) throw pageNotFound('repo_not_found');
    const repoParams = parsed.output;

    const canonical = canonicalRepoUrl(request, repoParams);
    if (canonical !== null) throw redirect(canonical, 301);

    const result = await getRepoDetails(repoParams);
    if (result.value === null) throw pageNotFound('repo_not_found');
    return { repo: result.value, degraded: result.degraded };
  } catch (error) {
    throw toPageErrorResponse(error);
  }
}
