import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('api/health', 'routes/api.health.ts'),
  // Theme toggle: sets the theme cookie (POST only). Not a Docker Hub route.
  route('theme', 'routes/theme.ts'),

  // Search results (questionnaire B12, B13, E28): `/search?q=&sort=&badge=&page=`.
  route('search', 'routes/search.tsx'),

  // Repository page (questionnaire C14, D24): `/r/{ns}/{repo}`, and `/_/{repo}`
  // for official images (`/r/library/{repo}` redirects there). Both share the
  // same modules, so each route needs its own id. Tabs: Overview (index), Tags.
  route('r/:ns/:repo', 'routes/repo.tsx', { id: 'repo' }, [
    index('routes/repo._index.tsx', { id: 'repo-overview' }),
    route('tags', 'routes/repo.tags.tsx', { id: 'repo-tags' }),
  ]),
  route('_/:repo', 'routes/repo.tsx', { id: 'official-repo' }, [
    index('routes/repo._index.tsx', { id: 'official-repo-overview' }),
    route('tags', 'routes/repo.tags.tsx', { id: 'official-repo-tags' }),
  ]),

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
