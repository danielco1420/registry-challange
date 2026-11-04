import { RepoParamsSchema, TagsQuerySchema, searchParamsToObject } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import { handleApi, proxyJson, rejectWrite, searchParamsOf } from '~/server/api.server';
import { config } from '~/server/config.server';
import { loadTags, tagsCacheKey } from '~/server/tags.server';
import type { Route } from './+types/api.repos.$ns.$repo.tags';

/**
 * `GET /api/repos/:ns/:repo/tags?page=&pageSize=&ordering=&name=` → `Page<Tag>`.
 * Docker Hub also answers 404 for a page past the last one, so a `404` with
 * `page > 1` doesn't mean the repository is missing. Shares its cache entries
 * with the Tags tab (`app/server/tags.server.ts`).
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const repoParams = parseOrThrow(RepoParamsSchema, params);
    const parsed = parseOrThrow(TagsQuerySchema, searchParamsToObject(searchParamsOf(request)));
    // `?name=%20` trims to "", which the client doesn't send: same entry as no filter.
    const query = { ...parsed, name: parsed.name || undefined };
    return proxyJson({
      key: tagsCacheKey(repoParams, query),
      ttlSeconds: config.cache.ttlSeconds.tags,
      notFoundMessage: query.page === 1 ? 'Repository not found' : 'Repository or page not found',
      load: () => loadTags(repoParams, query),
    });
  });
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
