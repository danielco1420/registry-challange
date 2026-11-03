import { RepoParamsSchema } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import { cacheKey, handleApi, orNotFound, proxyJson } from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { RepositorySchema } from '~/server/dockerhub.schemas.server';
import { toRepoDetails } from '~/server/normalize.server';
import type { Route } from './+types/api.repos.$ns.$repo';

/**
 * `GET /api/repos/:ns/:repo` → `RepoDetails`. The repository endpoint has no
 * logo, publisher name or platforms, so those fall back (docs/API.md).
 * `fullDescriptionMd` is raw Markdown: the UI must sanitize it.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const repoParams = parseOrThrow(RepoParamsSchema, params);
    return proxyJson({
      key: cacheKey('repo', repoParams.ns, repoParams.repo),
      ttlSeconds: config.cache.ttlSeconds.repo,
      notFoundMessage: 'Repository not found',
      load: async () => {
        const repo = await orNotFound(
          dockerHub.get({ endpoint: 'repository', params: repoParams }, RepositorySchema),
        );
        return repo && toRepoDetails(repo);
      },
    });
  });
}
