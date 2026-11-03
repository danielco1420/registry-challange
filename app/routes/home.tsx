import { useTranslation } from 'react-i18next';

import { Wordmark } from '~/components/brand/wordmark';
import i18next from '~/i18n/i18next';

import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: i18next.t('brand.name') }];
}

export default function Home() {
  const { t } = useTranslation();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl">
        <Wordmark />
      </h1>
      <p className="mt-4 text-muted-foreground">{t('home.placeholder')}</p>
    </main>
  );
}
