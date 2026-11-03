import type { SearchPage } from '~/lib/dto';
import { SuggestionsQuerySchema, searchParamsToObject } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import { cacheKey, handleApi, proxyJson, rejectWrite, searchParamsOf } from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { suggestRepositories } from '~/server/search.server';
import type { Route } from './+types/api.search.suggestions';

/** `GET /api/search/suggestions?q=` → `SearchPage` (autocomplete). Cached with the search TTL. */
export function loader({ request }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const { q } = parseOrThrow(
      SuggestionsQuerySchema,
      searchParamsToObject(searchParamsOf(request)),
    );
    return proxyJson<SearchPage>({
      key: cacheKey('suggestions', q),
      ttlSeconds: config.cache.ttlSeconds.search,
      load: async () => {
        const result = await suggestRepositories(dockerHub, q);
        return { ...result.page, source: result.source };
      },
    });
  });
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
