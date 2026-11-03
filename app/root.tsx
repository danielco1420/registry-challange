import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { I18nextProvider } from 'react-i18next';

import './app.css';
import { AppShell } from './components/layout/app-shell';
import { RouteErrorState } from './components/state/route-error-state';
import { useTheme } from './components/theme/use-theme';
import i18next from './i18n/i18next';
import { themeClassName } from './lib/theme';
import type { Route } from './+types/root';
import { securityHeadersMiddleware } from './server/securityHeaders.server';
import { readTheme } from './server/theme.server';

// Security headers on resource route (/api/*) and .data responses. Documents get
// theirs, with the CSP nonce, in entry.server.tsx.
export const middleware: Route.MiddlewareFunction[] = [securityHeadersMiddleware];

/** The theme cookie, so the server renders `<html>` in the right theme (no flash). */
export function loader({ request }: Route.LoaderArgs) {
  return { theme: readTheme(request) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <html lang={i18next.language} className={themeClassName(theme)}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <I18nextProvider i18n={i18next}>
          <AppShell>{children}</AppShell>
        </I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

// Unmatched URLs, page-loader failures (see `toPageErrorResponse` in
// app/server/pageError.server.ts) and render errors: one error state each
// (questionnaire C16). Rendered inside `Layout`, so it gets the shell and i18n.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteErrorState error={error} />;
}
