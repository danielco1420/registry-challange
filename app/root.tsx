import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { I18nextProvider } from 'react-i18next';

import './app.css';
import { RouteErrorState } from './components/state/route-error-state';
import i18next from './i18n/i18next';
import type { Route } from './+types/root';
import { securityHeadersMiddleware } from './server/securityHeaders.server';

// Security headers on resource route (/api/*) and .data responses. Documents get
// theirs, with the CSP nonce, in entry.server.tsx.
export const middleware: Route.MiddlewareFunction[] = [securityHeadersMiddleware];

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

// Unmatched URLs, page-loader failures (see `toPageErrorResponse` in
// app/server/pageError.server.ts) and render errors: one error state each
// (questionnaire C16).
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <I18nextProvider i18n={i18next}>
      <RouteErrorState error={error} />
    </I18nextProvider>
  );
}
