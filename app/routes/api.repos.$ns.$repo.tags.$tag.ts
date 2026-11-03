import { TagParamsSchema } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import { cacheKey, handleApi, orNotFound, proxyJson, rejectWrite } from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { TagSchema } from '~/server/dockerhub.schemas.server';
import { toTag } from '~/server/normalize.server';
import type { Route } from './+types/api.repos.$ns.$repo.tags.$tag';

/** `GET /api/repos/:ns/:repo/tags/:tag` → `Tag`, for deep links. Cached with the tags TTL. */
export function loader({ request, params }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const tagParams = parseOrThrow(TagParamsSchema, params);
    return proxyJson({
      key: cacheKey('tag', tagParams.ns, tagParams.repo, tagParams.tag),
      ttlSeconds: config.cache.ttlSeconds.tags,
      notFoundMessage: 'Tag not found',
      load: async () => {
        const tag = await orNotFound(
          dockerHub.get({ endpoint: 'tag', params: tagParams }, TagSchema),
        );
        return tag && toTag(tag);
      },
    });
  });
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
