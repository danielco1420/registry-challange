// Shared i18next instance, used identically on the server and in the
// browser. Resources are bundled at build time (no HTTP backend, no
// language detector) and the language is fixed to `en`, so initialization
// is synchronous and produces the exact same markup on both sides — no
// hydration mismatch.
import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import common from './en/common.json';

export const defaultNS = 'common';
export const resources = {
  en: { common },
} as const;

/**
 * Builds the i18next `missingKeyHandler`. In dev we throw so a missing
 * translation key fails loudly and fast; outside dev we log it instead of
 * breaking the page for users.
 */
export function createMissingKeyHandler(isDev: boolean) {
  return (lngs: readonly string[], ns: string, key: string) => {
    const message = `i18n: missing key "${key}" in namespace "${ns}" for language(s) [${lngs.join(', ')}]`;
    if (isDev) {
      throw new Error(message);
    }
    console.error(message);
  };
}

const isDev = import.meta.env.DEV;

// `i18next` is a singleton module, so guard against double-initialization
// (e.g. hot reload, or multiple imports during SSR).
if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en'],
    ns: Object.keys(resources.en),
    defaultNS,
    resources,
    interpolation: { escapeValue: false },
    saveMissing: true,
    missingKeyHandler: createMissingKeyHandler(isDev),
    react: { useSuspense: false },
  });
}

export type { I18nInstance };
export default i18next;
