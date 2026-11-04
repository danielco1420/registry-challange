import { useTranslation } from 'react-i18next';
import { useRevalidator } from 'react-router';

import { Wordmark } from '~/components/brand/wordmark';
import { RepoCard } from '~/components/repo/repo-card';
import { SearchBar } from '~/components/search/search-bar';
import { DegradedBanner } from '~/components/state/degraded-banner';
import { Empty } from '~/components/state/empty';
import { Loading } from '~/components/state/loading';
import { Button } from '~/components/ui/button';
import i18next from '~/i18n/i18next';
import { loadExplorePage } from '~/server/popular.server';

import type { Route } from './+types/home';

/**
 * Explore page: the 10 most popular official images (questionnaire D21,
 * ADR-0002). The loader calls the server facade directly, sharing its cache
 * entry with `/api/popular` (`app/server/popular.server.ts`), so SSR doesn't
 * round-trip through our own proxy. Errors (Docker Hub unavailable, rate
 * limited) are thrown as page errors and shown by the root `ErrorBoundary`.
 */
export function loader({ request }: Route.LoaderArgs) {
  return loadExplorePage({ request });
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: i18next.t('brand.name') },
    { name: 'description', content: i18next.t('explore.meta.description') },
  ];
}

const POPULAR_HEADING_ID = 'popular-heading';

// Rendered inside the app shell's <main> (app/components/layout/app-shell.tsx).
export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { popular, degraded } = loaderData;
  const revalidator = useRevalidator();
  const retry = () => void revalidator.revalidate();
  // "Try again" (degraded banner or empty state) is re-running the loader.
  const reloading = revalidator.state === 'loading';

  return (
    <>
      <h1 className="text-3xl">
        <Wordmark />
      </h1>
      <SearchBar variant="hero" className="mt-6 max-w-2xl" />

      <section aria-labelledby={POPULAR_HEADING_ID} aria-busy={reloading || undefined}>
        <h2 id={POPULAR_HEADING_ID} className="mt-10 text-xl font-semibold text-foreground">
          {t('explore.heading')}
        </h2>

        {reloading ? (
          <Loading className="mt-6" />
        ) : (
          <>
            {degraded && <DegradedBanner retry={retry} className="mt-4" />}

            {popular.items.length === 0 ? (
              <Empty
                className="mt-8"
                headingLevel={3}
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
        )}
      </section>
    </>
  );
}
