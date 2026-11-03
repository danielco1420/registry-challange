import { RepoParamsSchema, TagsQuerySchema, searchParamsToObject } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import {
  cacheKey,
  handleApi,
  orNotFound,
  proxyJson,
  rejectWrite,
  searchParamsOf,
} from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { TagsResponseSchema } from '~/server/dockerhub.schemas.server';
import { toTagsPage } from '~/server/normalize.server';
import type { Route } from './+types/api.repos.$ns.$repo.tags';

/**
 * `GET /api/repos/:ns/:repo/tags?page=&pageSize=&ordering=&name=` → `Page<Tag>`.
 * Docker Hub also answers 404 for a page past the last one, so a `404` with
 * `page > 1` doesn't mean the repository is missing.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const repoParams = parseOrThrow(RepoParamsSchema, params);
    const query = parseOrThrow(TagsQuerySchema, searchParamsToObject(searchParamsOf(request)));
    const { page, pageSize, ordering } = query;
    // `?name=%20` trims to "", which the client doesn't send: same entry as no filter.
    const name = query.name || undefined;
    return proxyJson({
      key: cacheKey('tags', repoParams.ns, repoParams.repo, page, pageSize, ordering, name),
      ttlSeconds: config.cache.ttlSeconds.tags,
      notFoundMessage: page === 1 ? 'Repository not found' : 'Repository or page not found',
      load: async () => {
        const body = await orNotFound(
          dockerHub.get(
            { endpoint: 'tags', params: repoParams, query: { ...query, name } },
            TagsResponseSchema,
          ),
        );
        return body && toTagsPage(body, query);
      },
    });
  });
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
