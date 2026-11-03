import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { I18nextProvider } from 'react-i18next';

import i18next from './i18n/i18next';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={i18next.language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <I18nextProvider i18n={i18next}>
      <Outlet />
    </I18nextProvider>
  );
}
