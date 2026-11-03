import { handleApi, notFoundResponse } from '~/server/api.server';
import type { Route } from './+types/api.$';

/**
 * Any `/api/*` path outside the allowlist, for any method: a JSON `404`.
 * Nothing is forwarded to Docker Hub (CLAUDE.md hard rules 1 and 2).
 */
export function loader({ request }: Route.LoaderArgs) {
  return handleApi(request, () => notFoundResponse());
}

export function action({ request }: Route.ActionArgs) {
  return handleApi(request, () => notFoundResponse());
}
