import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { Route } from './+types/root';
import { securityHeadersMiddleware } from './server/securityHeaders.server';

// Security headers on resource route (/api/*) and .data responses. Documents get
// theirs, with the CSP nonce, in entry.server.tsx.
export const middleware: Route.MiddlewareFunction[] = [securityHeadersMiddleware];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
  return <Outlet />;
}
