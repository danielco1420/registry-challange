import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Form,
  Link,
  useFetcher,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
} from 'react-router';

import { useRepoPage } from '~/components/repo/repo-page-context';
import { TagsTable } from '~/components/repo/tags-table';
import { DegradedBanner } from '~/components/state/degraded-banner';
import { Empty } from '~/components/state/empty';
import { ErrorState } from '~/components/state/error-state';
import { Loading } from '~/components/state/loading';
import { Button, buttonVariants } from '~/components/ui/button';
import type { Page, Tag } from '~/lib/dto';
import { formatNumber } from '~/lib/format';
import { ANONYMOUS_RESULTS_MAX } from '~/lib/params';
import { classifyRouteError, isRetryable } from '~/lib/route-error';
import {
  DEFAULT_TAG_ORDERING,
  TAG_FILTER_DEBOUNCE_MS,
  isPastAnonymousCap,
  isValidTagFilter,
  nextTagsPage,
  tagsHref,
  type TagsResult,
  type TagsTabData,
  type TagsUrlState,
} from '~/lib/tags-query';
import { loadRepoTagsTab } from '~/server/tags.server';

import type { Route } from './+types/repo.tags';

/**
 * The Tags tab (questionnaire B12, B13, D23, E28): a sortable table of the
 * repository's tags, a name filter, and "Load more". The sort (`ordering`)
 * and filter (`name`) live in the URL; "Load more" fetches `&page=N` of this
 * same route through a fetcher, 50 tags at a time, so a repository with
 * thousands of tags (fluent/fluent-bit) is never fetched whole.
 *
 * The loader returns failures instead of throwing them (`loadRepoTagsTab`),
 * so they show inside the tab, and a failed "Load more" keeps the rows
 * already shown.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return loadRepoTagsTab({ request, params });
}

/** A fetcher failing outright (e.g. offline): an error state in the tab, under the repository header. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const revalidator = useRevalidator();
  const { kind, retryAfterSeconds, isResponse } = classifyRouteError(error);
  if (!isRetryable(kind)) return <ErrorState kind={kind} />;
  const retry = () => {
    if (isResponse) void revalidator.revalidate();
    else window.location.reload();
  };
  return <ErrorState kind={kind} retry={retry} retryAfterSeconds={retryAfterSeconds} />;
}

export default function RepoTags({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { basePath } = useRepoPage();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const location = useLocation();
  const { ordering, name, result } = loaderData;

  // A new sort or filter for this tab is loading: keep the rows, marked busy.
  const updating =
    navigation.state === 'loading' && navigation.location?.pathname === location.pathname;

  return (
    <div className="flex flex-col gap-4">
      <TagFilter name={name} ordering={ordering} basePath={basePath} />

      {updating && <Loading label={t('repo.tags.loading')} className="py-2" />}

      <div aria-busy={updating || undefined} className={updating ? 'opacity-60' : undefined}>
        <TagsResultView
          // A new sort or filter starts over: no rows from "Load more" carry over.
          key={`${ordering}|${name}`}
          state={{ ordering, name }}
          result={result}
          retry={() => void revalidator.revalidate()}
        />
      </div>
    </div>
  );
}

/** The first page's outcome: an error, an empty state, or the list. */
function TagsResultView({
  state,
  result,
  retry,
}: {
  state: TagsUrlState;
  result: TagsResult;
  retry: () => void;
}) {
  const { t } = useTranslation();
  const { basePath } = useRepoPage();

  if (!result.ok) {
    return result.error === 'repo_not_found' ? (
      <ErrorState kind="repo_not_found" />
    ) : (
      <ErrorState kind={result.error} retry={retry} retryAfterSeconds={result.retryAfterSeconds} />
    );
  }

  const { tags, degraded } = result;
  if (tags.items.length === 0) {
    return state.name ? (
      <Empty
        title={t('repo.tags.noMatch.title', { name: state.name })}
        description={t('repo.tags.noMatch.description')}
        action={
          <Link
            to={tagsHref(basePath, { ...state, name: '' })}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('repo.tags.noMatch.action')}
          </Link>
        }
      />
    ) : (
      <Empty
        title={t('repo.tags.empty.title')}
        description={t('repo.tags.empty.description')}
        action={
          <Link to={basePath} className={buttonVariants({ variant: 'outline' })}>
            {t('repo.tags.empty.action')}
          </Link>
        }
      />
    );
  }

  return (
    <>
      {degraded && <DegradedBanner retry={retry} />}
      <TagList first={tags} state={state} />
    </>
  );
}

/**
 * The table plus "Load more". The first page comes from the loader; each
 * "Load more" asks this route for the next page through a fetcher and
 * appends it. A tag already shown isn't repeated, since a tag pushed between
 * two fetches shifts the pages.
 */
function TagList({ first, state }: { first: Page<Tag>; state: TagsUrlState }) {
  const { t } = useTranslation();
  const { repo, basePath } = useRepoPage();
  const fetcher = useFetcher<TagsTabData>();
  const [more, setMore] = useState<Page<Tag>[]>([]);
  const last = more.at(-1) ?? first;
  const next = nextTagsPage(last);

  // Append a page when its fetch lands (state updated during render, the
  // React-recommended way to react to a changed value without an effect).
  const [handled, setHandled] = useState(fetcher.data);
  const answer = fetcher.data;
  if (answer !== handled) {
    setHandled(answer);
    if (
      answer?.result.ok &&
      answer.page === next &&
      answer.ordering === state.ordering &&
      answer.name === state.name
    ) {
      setMore([...more, answer.result.tags]);
    }
  }

  const loading = fetcher.state !== 'idle';
  const failed =
    !loading && answer && !answer.result.ok && answer.page === next ? answer.result : undefined;

  const rows: Tag[] = [];
  const seen = new Set<string>();
  for (const page of [first, ...more]) {
    for (const tag of page.items) {
      if (seen.has(tag.name)) continue;
      seen.add(tag.name);
      rows.push(tag);
    }
  }

  const total = last.total;
  const capped = next === null && isPastAnonymousCap(total) && rows.length < total;
  const loadMore = () => {
    if (next !== null) fetcher.load(tagsHref(basePath, state, next));
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {state.name
          ? t('repo.tags.matchCount', {
              count: total,
              total: formatNumber(total),
              name: state.name,
            })
          : t('repo.tags.count', { count: total, total: formatNumber(total) })}
      </p>

      <TagsTable
        tags={rows}
        namespace={repo.namespace}
        repo={repo.name}
        ordering={state.ordering}
        sortHref={(ordering) => tagsHref(basePath, { ...state, ordering })}
        caption={t('repo.tags.table.caption', { name: repo.displayName })}
      />

      <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
        {rows.length < total && (
          <p>
            {t('repo.tags.shown', { shown: formatNumber(rows.length), total: formatNumber(total) })}
            {capped && <> {t('repo.tags.capped', { max: formatNumber(ANONYMOUS_RESULTS_MAX) })}</>}
          </p>
        )}

        {failed && (
          <p role="alert" className="text-foreground">
            {t('repo.tags.loadMoreError')} {t(`state.error.${failed.error}.title`)}.
            {failed.retryAfterSeconds !== undefined && (
              <> {t('state.retryIn', { count: failed.retryAfterSeconds })}</>
            )}
          </p>
        )}

        {next !== null &&
          (loading ? (
            <Loading label={t('repo.tags.loadingMore')} className="py-0" />
          ) : (
            <Button type="button" variant="outline" onClick={loadMore}>
              {failed ? t('state.actions.retry') : t('repo.tags.loadMore')}
            </Button>
          ))}
      </div>
    </div>
  );
}

/**
 * The name filter: a GET form, so it works without JavaScript (Enter
 * submits). With JavaScript, the URL follows the input after a
 * `TAG_FILTER_DEBOUNCE_MS` pause, replacing the history entry, so Back
 * doesn't step through every keystroke. Characters no tag can contain get a
 * hint instead of a request.
 */
function TagFilter({
  name,
  ordering,
  basePath,
}: TagsUrlState & {
  basePath: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(name);
  // The URL's filter changed elsewhere ("Clear filter", Back): show it,
  // unless it's what's typed already (e.g. our own debounced update).
  const [shownName, setShownName] = useState(name);
  if (name !== shownName) {
    setShownName(name);
    if (draft.trim() !== name) setDraft(name);
  }
  const wanted = draft.trim();
  const valid = isValidTagFilter(wanted);

  useEffect(() => {
    if (wanted === name || !valid) return;
    const timer = setTimeout(() => {
      void navigate(tagsHref(basePath, { ordering, name: wanted }), {
        replace: true,
        preventScrollReset: true,
      });
    }, TAG_FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [wanted, valid, name, ordering, basePath, navigate]);

  return (
    <Form
      method="get"
      action={`${basePath}/tags`}
      role="search"
      preventScrollReset
      className="flex flex-col gap-1"
    >
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {t('repo.tags.filter.label')}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="search"
          name="name"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={t('repo.tags.filter.placeholder')}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!valid || undefined}
          aria-describedby={valid ? undefined : hintId}
          className="h-9 w-full max-w-sm min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-hidden placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-destructive"
        />
        {ordering !== DEFAULT_TAG_ORDERING && (
          <input type="hidden" name="ordering" value={ordering} />
        )}
        <Button type="submit" variant="outline" disabled={!valid}>
          {t('repo.tags.filter.submit')}
        </Button>
      </div>
      {!valid && (
        <p id={hintId} className="text-sm text-destructive">
          {t('repo.tags.filter.invalid')}
        </p>
      )}
    </Form>
  );
}
