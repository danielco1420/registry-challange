import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Form, useLocation, useNavigate } from 'react-router';

import { Button } from '~/components/ui/button';
import { normalizeQuery } from '~/lib/recent-searches';
import { repoPath } from '~/lib/repo-path';
import { cn } from '~/lib/utils';

import { useRecentSearches } from './use-recent-searches';
import { type Suggestion, useSuggestions } from './use-suggestions';

/** The search results page (T23). The form submits `q` here. */
export const SEARCH_PATH = '/search';

/** Same cap as the `q` param schema (`app/lib/params.ts`). */
const MAX_QUERY_LENGTH = 100;

type Option =
  | { kind: 'recent'; key: string; query: string }
  | { kind: 'suggestion'; key: string; suggestion: Suggestion };

export interface SearchBarProps {
  /** `header`: compact, for the app header. `hero`: larger, for the Explore page. */
  variant?: 'header' | 'hero';
  className?: string;
}

/**
 * The image search box (questionnaire B11, E28): a `GET` form to
 * `/search?q=`, so it works without JavaScript. With JavaScript it is a
 * combobox (WAI-ARIA APG "list autocomplete"): as you type, debounced
 * suggestions from `/api/search/suggestions` (picking one opens its repository
 * page); with the box empty, your recent searches (picking one searches it
 * again). Arrow keys move through the list, Enter picks the active option or
 * else submits, Escape closes the list.
 *
 * Hand-written rather than a library: Radix has no combobox primitive, and
 * shadcn's Combobox is a select-style picker built on `cmdk`, not a free-text
 * search box.
 */
export function SearchBar({ variant = 'header', className }: SearchBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { searches, add, clear } = useRecentSearches();

  // On the results page the box shows the current query; elsewhere it starts empty.
  const urlQuery =
    location.pathname === SEARCH_PATH ? (new URLSearchParams(location.search).get('q') ?? '') : '';
  const [value, setValue] = React.useState(urlQuery);
  const [shownUrlQuery, setShownUrlQuery] = React.useState(urlQuery);
  if (urlQuery !== shownUrlQuery) {
    // The URL changed (navigation, Back/Forward): follow it.
    setShownUrlQuery(urlQuery);
    setValue(urlQuery);
  }

  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const suggestions = useSuggestions(open ? value : '');

  const query = normalizeQuery(value);
  const mode = query === '' ? 'recent' : 'suggestions';
  const options: Option[] =
    mode === 'recent'
      ? searches.map((recent) => ({ kind: 'recent', key: `recent:${recent}`, query: recent }))
      : suggestions.items.map((suggestion) => ({
          kind: 'suggestion',
          key: `suggestion:${suggestion.id}`,
          suggestion,
        }));
  const active = activeIndex < options.length ? activeIndex : -1;

  // What the popup shows besides the options, if anything.
  let message: string | null = null;
  if (mode === 'suggestions') {
    if (suggestions.status === 'loading') message = t('search.suggestions.loading');
    else if (suggestions.status === 'error') message = t('search.suggestions.error');
    else if (suggestions.status === 'success' && options.length === 0) {
      message = t('search.suggestions.empty', { query });
    }
  }
  const showPopup = open && (options.length > 0 || message !== null);
  const expanded = showPopup && options.length > 0;

  // Announced politely (the popup's text is not a live region, to avoid double reading).
  // Only once a lookup has finished: a 1-character query is `idle`, not "0 suggestions".
  let announcement = '';
  if (open && (suggestions.status === 'success' || suggestions.status === 'error')) {
    announcement = message ?? t('search.suggestions.count', { count: options.length });
  }

  const id = React.useId();
  const inputId = `${id}input`;
  const listboxId = `${id}listbox`;
  const optionId = (index: number) => `${id}option-${index}`;

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function choose(option: Option) {
    close();
    if (option.kind === 'recent') {
      setValue(option.query);
      add(option.query);
      void navigate(`${SEARCH_PATH}?${new URLSearchParams({ q: option.query })}`);
    } else {
      void navigate(repoPath(option.suggestion.namespace, option.suggestion.name));
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (options.length === 0) return;
        const last = options.length - 1;
        if (event.key === 'ArrowDown') setActiveIndex(active >= last ? 0 : active + 1);
        else setActiveIndex(active <= 0 ? last : active - 1);
        return;
      }
      case 'Enter': {
        const option = expanded ? options[active] : undefined;
        if (option) {
          event.preventDefault();
          choose(option);
        }
        // Otherwise the form submits.
        return;
      }
      case 'Escape':
        if (open) {
          // Also stops `type="search"` from clearing the box: Escape only closes the list.
          event.preventDefault();
          close();
        }
        return;
    }
  }

  const hero = variant === 'hero';

  return (
    <Form
      method="get"
      action={SEARCH_PATH}
      role="search"
      aria-label={t('search.label')}
      className={cn('relative w-full', className)}
      onSubmit={() => {
        add(value);
        close();
      }}
      onBlur={(event) => {
        // Close once focus leaves the whole search box (input, button and list).
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {t('search.label')}
      </label>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className={cn(
              'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground',
              hero ? 'size-5' : 'size-4',
            )}
          />
          <input
            id={inputId}
            type="search"
            name="q"
            value={value}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t('search.placeholder')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listboxId}
            aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setActiveIndex(-1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(
              'w-full min-w-0 rounded-md border border-input bg-background text-foreground shadow-xs outline-hidden transition-[box-shadow] placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring',
              hero ? 'h-11 pr-3 pl-10 text-base' : 'h-9 pr-3 pl-9 text-sm',
            )}
          />
        </div>
        <Button
          type="submit"
          variant={hero ? 'default' : 'outline'}
          size={hero ? 'lg' : 'icon'}
          className={hero ? 'h-11' : undefined}
        >
          {hero ? (
            t('search.submit')
          ) : (
            <>
              <SearchIcon className="size-4" />
              <span className="sr-only">{t('search.submit')}</span>
            </>
          )}
        </Button>
      </div>

      <div
        hidden={!showPopup}
        className="absolute top-full right-0 left-0 z-40 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
      >
        {mode === 'recent' && options.length > 0 && (
          <p
            className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
            aria-hidden="true"
          >
            {t('search.recent.label')}
          </p>
        )}
        {/* Always rendered, so `aria-controls` points at a real element. */}
        <ul
          id={listboxId}
          role="listbox"
          aria-label={mode === 'recent' ? t('search.recent.label') : t('search.suggestions.label')}
          hidden={options.length === 0}
          className="max-h-80 overflow-y-auto py-1"
        >
          {options.map((option, index) => (
            // Keyboard interaction lives on the combobox input (aria-activedescendant);
            // options only need the mouse. mousedown is cancelled so the input keeps focus.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={option.key}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              onMouseMove={() => {
                if (index !== active) setActiveIndex(index);
              }}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 px-3 py-2 text-sm',
                index === active && 'bg-accent text-accent-foreground',
              )}
            >
              {option.kind === 'recent' ? (
                <span className="flex items-center gap-2">
                  <HistoryIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{option.query}</span>
                </span>
              ) : (
                <>
                  <span className="truncate font-medium">{option.suggestion.displayName}</span>
                  {option.suggestion.description && (
                    <span
                      className={cn(
                        'truncate text-xs',
                        index === active ? 'text-accent-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {option.suggestion.description}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        {message !== null && <p className="px-3 py-3 text-sm text-muted-foreground">{message}</p>}
        {mode === 'recent' && options.length > 0 && (
          <div className="border-t border-border p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => clear()}
            >
              {t('search.recent.clear')}
            </Button>
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </Form>
  );
}

/** Magnifying glass, drawn inline (no icon library). Decorative. */
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** Clock with a counter-clockwise arrow. Decorative. */
function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
