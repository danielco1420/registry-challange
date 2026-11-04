import { useTranslation } from 'react-i18next';

import { RepoCard } from './repo-card';
import { useFavorites } from './use-favorites';

export interface FavoritesSectionProps {
  className?: string;
}

/**
 * The Explore page's "Favorites" section (questionnaire E28, T21): the
 * favorited repositories as the same `RepoCard` grid as "Popular official
 * images". Renders nothing when there are no favorites yet — that is this
 * view's empty state, since a dashed placeholder box has nothing useful to
 * say here.
 */
export function FavoritesSection({ className }: FavoritesSectionProps) {
  const { t } = useTranslation();
  const { favorites } = useFavorites();

  if (favorites.length === 0) return null;

  return (
    <section className={className}>
      <h2 className="text-xl font-semibold text-foreground">{t('favorites.heading')}</h2>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {favorites.map((repo) => (
          <RepoCard key={repo.id} repo={repo} />
        ))}
      </div>
    </section>
  );
}
