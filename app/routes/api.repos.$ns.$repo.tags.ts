import { RepoParamsSchema, TagsQuerySchema, searchParamsToObject } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import { cacheKey, handleApi, orNotFound, proxyJson, searchParamsOf } from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { TagsResponseSchema } from '~/server/dockerhub.schemas.server';
import { toTagsPage } from '~/server/normalize.server';
import type { Route } from './+types/api.repos.$ns.$repo.tags';

/** `GET /api/repos/:ns/:repo/tags?page=&pageSize=&ordering=&name=` → `Page<Tag>`. */
export function loader({ request, params }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const repoParams = parseOrThrow(RepoParamsSchema, params);
    const query = parseOrThrow(TagsQuerySchema, searchParamsToObject(searchParamsOf(request)));
    const { page, pageSize, ordering, name } = query;
    return proxyJson({
      key: cacheKey('tags', repoParams.ns, repoParams.repo, page, pageSize, ordering, name),
      ttlSeconds: config.cache.ttlSeconds.tags,
      notFoundMessage: 'Repository not found',
      load: async () => {
        const body = await orNotFound(
          dockerHub.get({ endpoint: 'tags', params: repoParams, query }, TagsResponseSchema),
        );
        return body && toTagsPage(body, query);
      },
    });
  });
}
