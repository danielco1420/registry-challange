import type { Publisher } from '~/lib/dto';
import { PublisherParamsSchema } from '~/lib/params';
import { parseOrThrow } from '~/lib/validate';
import { cacheKey, handleApi, orNotFound, proxyJson, rejectWrite } from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { OrgSchema, UserSchema } from '~/server/dockerhub.schemas.server';
import { toOrgPublisher, toUserPublisher } from '~/server/normalize.server';
import type { Route } from './+types/api.publishers.$name';

/**
 * `GET /api/publishers/:name` → `Publisher`. Tries `/v2/orgs/{name}` first and
 * `/v2/users/{name}` on a 404, since `/v2/users/{org}` answers a redirect we
 * don't follow (docs/API.md D).
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return handleApi(request, () => {
    const { name } = parseOrThrow(PublisherParamsSchema, params);
    return proxyJson<Publisher>({
      key: cacheKey('publisher', name),
      ttlSeconds: config.cache.ttlSeconds.publisher,
      notFoundMessage: 'Publisher not found',
      load: async () => {
        const org = await orNotFound(dockerHub.get({ endpoint: 'org', name }, OrgSchema));
        if (org) return toOrgPublisher(org);
        const user = await orNotFound(dockerHub.get({ endpoint: 'user', name }, UserSchema));
        return user && toUserPublisher(user);
      },
    });
  });
}

/** Write methods: a JSON `405`. */
export function action({ request }: Route.ActionArgs) {
  return rejectWrite(request);
}
