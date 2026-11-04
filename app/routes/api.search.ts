import type { SearchPage } from '~/lib/dto';
import { SearchQuerySchema, searchParamsToObject } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import { handleApi, proxyJson, rejectWrite, searchParamsOf } from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { searchCacheKey, searchRepositories } from '~/server/search.server';
import type { Route } from './+types/api.search';

/**
 * `GET /api/search?q=&page=&pageSize=&sort=&badge=` → `SearchPage`. Shares its
 * cache key (`searchCacheKey`) with the results page (`/search`).
 */
export function loader({ request }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const query = parseOrThrow(SearchQuerySchema, searchParamsToObject(searchParamsOf(request)));
    return proxyJson<SearchPage>({
      key: searchCacheKey(query),
      ttlSeconds: config.cache.ttlSeconds.search,
      load: async () => {
        const result = await searchRepositories(dockerHub, query);
        return { ...result.page, source: result.source };
      },
    });
  });
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
