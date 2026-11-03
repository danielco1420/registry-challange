import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('api/health', 'routes/api.health.ts'),

  // Docker Hub proxy: the allowlist (docs/API.md, "Proxy routes"). Nothing else is forwarded.
  route('api/popular', 'routes/api.popular.ts'),
  route('api/search', 'routes/api.search.ts'),
  route('api/search/suggestions', 'routes/api.search.suggestions.ts'),
  route('api/repos/:ns/:repo', 'routes/api.repos.$ns.$repo.ts'),
  route('api/repos/:ns/:repo/tags', 'routes/api.repos.$ns.$repo.tags.ts'),
  route('api/repos/:ns/:repo/tags/:tag', 'routes/api.repos.$ns.$repo.tags.$tag.ts'),
  route('api/publishers/:name', 'routes/api.publishers.$name.ts'),
  // Any other /api/* path: JSON 404.
  route('api/*', 'routes/api.$.ts'),
] satisfies RouteConfig;
