import { useTranslation } from 'react-i18next';

import i18next from '~/i18n/i18next';

import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: i18next.t('home.title') }];
}

export default function Home() {
  const { t } = useTranslation();

  return (
    <main>
      <h1>{t('home.heading')}</h1>
      <p>{t('home.placeholder')}</p>
    </main>
  );
}
