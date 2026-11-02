import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('api/health', 'routes/api.health.ts'),
] satisfies RouteConfig;
