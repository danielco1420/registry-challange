import { useTranslation } from 'react-i18next';
import { useLoaderData, useRevalidator } from 'react-router';

import { Wordmark } from '~/components/brand/wordmark';
import { RepoCard } from '~/components/repo/repo-card';
import { SearchBar } from '~/components/search/search-bar';
import { DegradedBanner } from '~/components/state/degraded-banner';
import { Empty } from '~/components/state/empty';
import { Button } from '~/components/ui/button';
import type { SearchPage } from '~/lib/dto';
import i18next from '~/i18n/i18next';
import { cacheKey } from '~/server/api.server';
import { config } from '~/server/config.server';
import { dockerHub } from '~/server/dockerhub.server';
import { toPageErrorResponse } from '~/server/pageError.server';
import { enforceRateLimit } from '~/server/rateLimit.server';
import { searchRepositories } from '~/server/search.server';
import { getCached } from '~/server/upstream.server';

import { POPULAR_QUERY } from './api.popular';
import type { Route } from './+types/home';

export interface HomeLoaderData {
  popular: SearchPage;
  /** True when `popular` is a stale copy because Docker Hub is failing or the budget is spent. */
  degraded: boolean;
}

/**
 * Explore page: the 10 most popular official images (questionnaire D21,
 * ADR-0002). Calls the server facade directly, the same query as
 * `/api/popular` (`POPULAR_QUERY` in `app/routes/api.popular.ts`), so SSR
 * doesn't round-trip through our own proxy.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<HomeLoaderData> {
  try {
    enforceRateLimit(request);
    const result = await getCached(
      cacheKey('popular'),
      config.cache.ttlSeconds.popular,
      async () => {
        const { page, source } = await searchRepositories(dockerHub, POPULAR_QUERY);
        return { ...page, source };
      },
    );
    return { popular: result.value, degraded: result.degraded };
  } catch (error) {
    throw toPageErrorResponse(error);
  }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: i18next.t('brand.name') },
    { name: 'description', content: i18next.t('explore.meta.description') },
  ];
}

// Rendered inside the app shell's <main> (app/components/layout/app-shell.tsx).
export default function Home() {
  const { t } = useTranslation();
  const { popular, degraded } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const retry = () => void revalidator.revalidate();

  return (
    <>
      <h1 className="text-3xl">
        <Wordmark />
      </h1>
      <SearchBar variant="hero" className="mt-6 max-w-2xl" />

      <h2 className="mt-10 text-xl font-semibold text-foreground">{t('explore.heading')}</h2>

      {degraded && <DegradedBanner retry={retry} className="mt-4" />}

      {popular.items.length === 0 ? (
        <Empty
          className="mt-8"
          title={t('explore.empty.title')}
          description={t('explore.empty.description')}
          action={
            <Button type="button" variant="outline" onClick={retry}>
              {t('state.actions.retry')}
            </Button>
          }
        />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {popular.items.map((repo) => (
            <RepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}
    </>
  );
}
