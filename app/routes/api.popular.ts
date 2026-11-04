import type { SearchPage } from '~/lib/dto';
import type { SearchQuery } from '~/lib/params';
import { cacheKey, handleApi, proxyJson, rejectWrite } from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { searchRepositories } from '~/server/search.server';
import type { Route } from './+types/api.popular';

/**
 * The 10 most pulled official images (docs/API.md, "Popular 10"). Shared with
 * the Explore page loader (`app/routes/home.tsx`), so the page and this route
 * can't drift.
 */
export const POPULAR_QUERY: SearchQuery = {
  q: '',
  page: 1,
  pageSize: 10,
  sort: 'pulls',
  badge: 'official',
};

/** `GET /api/popular` → `SearchPage`. Takes no params; any query string is ignored. */
export function loader({ request }: Route.LoaderArgs) {
  return handleApi(request, () =>
    proxyJson<SearchPage>({
      key: cacheKey('popular'),
      ttlSeconds: config.cache.ttlSeconds.popular,
      load: async () => {
        const { page, source } = await searchRepositories(dockerHub, POPULAR_QUERY);
        return { ...page, source };
      },
    }),
  );
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
