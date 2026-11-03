// Shared i18next instance, used identically on the server and in the
// browser. Resources are bundled at build time (no HTTP backend, no
// language detector) and the language is fixed to `en`, so initialization
// is synchronous and produces the exact same markup on both sides — no
// hydration mismatch.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import common from './en/common.json';

export const defaultNS = 'common';
export const resources = {
  en: { common },
} as const;

// Type the catalog so `t('some.typo')` fails `pnpm typecheck` instead of
// only surfacing at runtime.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['en'];
  }
}

/**
 * Builds the i18next `missingKeyHandler`. In dev we throw so a missing
 * translation key fails loudly and fast; outside dev we log it instead of
 * breaking the page for users, once per key so a key rendered in a list
 * doesn't flood the server logs on every request.
 */
export function createMissingKeyHandler(isDev: boolean) {
  const reported = new Set<string>();
  return (lngs: readonly string[], ns: string, key: string) => {
    const message = `i18n: missing key "${key}" in namespace "${ns}" for language(s) [${lngs.join(', ')}]`;
    if (isDev) {
      throw new Error(message);
    }
    const id = `${ns}:${key}`;
    if (reported.has(id)) {
      return;
    }
    reported.add(id);
    console.error(message);
  };
}

const isDev = import.meta.env.DEV;

// `i18next` is a singleton module, so guard against double-initialization
// (e.g. multiple imports during SSR). When the module is re-evaluated by HMR
// after a catalog edit, refresh the bundles instead, or the instance would
// keep the old strings and the dev handler would throw on new keys.
if (i18next.isInitialized) {
  for (const [ns, bundle] of Object.entries(resources.en)) {
    // Replace rather than merge: addResourceBundle's deep merge would keep
    // keys removed from the catalog on disk, masking deletions during HMR.
    i18next.removeResourceBundle('en', ns);
    i18next.addResourceBundle('en', ns, bundle, true, true);
  }
} else {
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

export default i18next;
