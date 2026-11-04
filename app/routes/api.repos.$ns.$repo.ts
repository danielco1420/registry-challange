import { RepoParamsSchema } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import { handleApi, proxyJson, rejectWrite } from '~/server/api.server';
import { config } from '~/server/config.server';
import { loadRepoDetails, repoCacheKey } from '~/server/repo.server';
import type { Route } from './+types/api.repos.$ns.$repo';

/**
 * `GET /api/repos/:ns/:repo` → `RepoDetails`. The repository endpoint has no
 * logo, publisher name or platforms, so those fall back (docs/API.md).
 * `fullDescriptionMd` is raw Markdown: the UI must sanitize it.
 * Shares its cache entry with the repository page (`app/server/repo.server.ts`).
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const repoParams = parseOrThrow(RepoParamsSchema, params);
    return proxyJson({
      key: repoCacheKey(repoParams),
      ttlSeconds: config.cache.ttlSeconds.repo,
      notFoundMessage: 'Repository not found',
      load: () => loadRepoDetails(repoParams),
    });
  });
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
