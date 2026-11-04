import { useTranslation } from 'react-i18next';

import { Button } from '~/components/ui/button';
import type { FavoriteRepo } from '~/lib/favorites';
import { cn } from '~/lib/utils';

import { useFavorites } from './use-favorites';

export interface FavoriteButtonProps {
  repo: FavoriteRepo;
  className?: string;
}

/**
 * Heart toggle for a repository (questionnaire B8, E28; T21): adds or
 * removes it from the `localStorage` favorites kept by `useFavorites`.
 *
 * A native `<button>`, not a link, so it never fights the stretched link on
 * `RepoCard`. `aria-pressed` and the label switch with the state, so screen
 * readers hear "Add {name} to favorites" / "Remove {name} from favorites".
 */
export function FavoriteButton({ repo, className }: FavoriteButtonProps) {
  const { t } = useTranslation();
  const { isFavorite, toggle } = useFavorites();
  const favorited = isFavorite(repo.id);
  const label = t(favorited ? 'favorites.remove' : 'favorites.add', { name: repo.displayName });

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={favorited}
      title={label}
      onClick={() => toggle(repo)}
      className={cn(
        'size-8 text-muted-foreground hover:text-foreground',
        favorited && 'text-brand hover:text-brand',
        className,
      )}
    >
      <HeartIcon filled={favorited} />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

/** Drawn inline (no icon library), outline when idle, filled when favorited. */
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M12 21s-7.5-4.595-10-9.312C.467 7.908 2.748 4 6.5 4c2.223 0 4.182 1.248 5.5 3 1.318-1.752 3.277-3 5.5-3 3.752 0 6.033 3.908 4.5 7.688C19.5 16.405 12 21 12 21z" />
    </svg>
  );
}
