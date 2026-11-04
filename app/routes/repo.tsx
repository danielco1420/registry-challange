import { useTranslation } from 'react-i18next';
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigation,
  useRevalidator,
  type ShouldRevalidateFunctionArgs,
} from 'react-router';

import { RepoHeader } from '~/components/repo/repo-header';
import type { RepoPageContext } from '~/components/repo/repo-page-context';
import { DegradedBanner } from '~/components/state/degraded-banner';
import { Loading } from '~/components/state/loading';
import i18next from '~/i18n/i18next';
import { repoPath } from '~/lib/repo-path';
import { cn } from '~/lib/utils';
import { loadRepoPage } from '~/server/repo.server';

import type { Route } from './+types/repo';

/**
 * The repository page's layout, for both `/r/:ns/:repo` and `/_/:repo`
 * (questionnaire C14, D24): header, "Overview | Tags" tabs, then the tab.
 * Errors (repository not found, Docker Hub unavailable, rate limited) are
 * thrown as page errors and shown by the root `ErrorBoundary`.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return loadRepoPage({ request, params });
}

/**
 * A new sort or filter on the Tags tab, or switching tabs, stays on the same
 * repository: its details don't need loading again. That includes the tag
 * filter's `GET` form, whose submissions carry `formMethod: 'GET'`.
 * Revalidation (the degraded banner's "Try again", after a mutation such as
 * a `POST`) still runs.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  currentParams,
  nextParams,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  const sameRepo = currentParams.ns === nextParams.ns && currentParams.repo === nextParams.repo;
  const mutation = formMethod !== undefined && formMethod.toUpperCase() !== 'GET';
  if (!mutation && sameRepo && currentUrl.href !== nextUrl.href) return false;
  return defaultShouldRevalidate;
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: i18next.t('brand.name') }];
  const { repo } = data;
  const tags = [
    {
      title: i18next.t('repo.page.title', {
        name: repo.displayName,
        brand: i18next.t('brand.name'),
      }),
    },
  ];
  return repo.description ? [...tags, { name: 'description', content: repo.description }] : tags;
}

const TAB_CLASS =
  '-mb-px rounded-t-sm border-b-2 px-1 pb-2 text-sm font-medium transition-colors outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring';

export default function RepoPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { repo, degraded } = loaderData;
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const location = useLocation();
  const basePath = repoPath(repo.namespace, repo.name);

  // Leaving for another page (e.g. another repository) or tab: its loader is
  // running. A new sort or filter on the Tags tab keeps the path, and the tab
  // shows its own pending state.
  const pathname = navigation.location?.pathname;
  const leaving =
    navigation.state === 'loading' && pathname !== undefined && pathname !== location.pathname;

  const context: RepoPageContext = { repo, basePath };
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      TAB_CLASS,
      isActive
        ? 'border-brand text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground',
    );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {degraded && <DegradedBanner retry={() => void revalidator.revalidate()} />}

      <RepoHeader repo={repo} />

      <nav aria-label={t('repo.tabs.label')} className="border-b border-border">
        <ul className="flex gap-6">
          <li>
            <NavLink to={basePath} end className={tabClass}>
              {t('repo.tabs.overview')}
            </NavLink>
          </li>
          <li>
            <NavLink to={`${basePath}/tags`} className={tabClass}>
              {t('repo.tabs.tags')}
            </NavLink>
          </li>
        </ul>
      </nav>

      <div className="min-w-0" aria-busy={leaving || undefined}>
        {leaving ? <Loading /> : <Outlet context={context} />}
      </div>
    </div>
  );
}
