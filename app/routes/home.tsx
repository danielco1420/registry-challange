import { useTranslation } from 'react-i18next';

import { Wordmark } from '~/components/brand/wordmark';
import { SearchBar } from '~/components/search/search-bar';
import i18next from '~/i18n/i18next';

import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: i18next.t('brand.name') }];
}

// Rendered inside the app shell's <main> (app/components/layout/app-shell.tsx).
export default function Home() {
  const { t } = useTranslation();

  return (
    <>
      <h1 className="text-3xl">
        <Wordmark />
      </h1>
      <SearchBar variant="hero" className="mt-6 max-w-2xl" />
      <p className="mt-6 text-muted-foreground">{t('home.placeholder')}</p>
    </>
  );
}
