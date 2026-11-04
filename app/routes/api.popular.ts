import type { SearchPage } from '~/lib/dto';
import { handleApi, proxyJson, rejectWrite } from '~/server/api.server';
import { config } from '~/server/config.server';
import { loadPopular, popularCacheKey } from '~/server/popular.server';
import type { Route } from './+types/api.popular';

/**
 * `GET /api/popular` → `SearchPage`: the 10 most pulled official images
 * (docs/API.md, "Popular 10"). Takes no params; any query string is ignored.
 * Shares its cache entry with the Explore page (`app/server/popular.server.ts`).
 */
export function loader({ request }: Route.LoaderArgs) {
  return handleApi(request, () =>
    proxyJson<SearchPage>({
      key: popularCacheKey(),
      ttlSeconds: config.cache.ttlSeconds.popular,
      load: loadPopular,
    }),
  );
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
