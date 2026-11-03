import { randomBytes } from 'node:crypto';
import type { MiddlewareFunction } from 'react-router';

/**
 * Security headers and the nonce-based Content Security Policy
 * (questionnaire G43, RISKS 3.2 and 3.3). Two places apply them:
 *
 * - **HTML documents**: `app/entry.server.tsx` creates a nonce per render, sets
 *   the headers with `setDocumentSecurityHeaders` and passes the nonce to `<ServerRouter>` and
 *   `renderToPipeableStream`, so React Router's `<Scripts>`, `<ScrollRestoration>`
 *   and streamed hydration scripts carry it. This covers every document,
 *   including 404s and error boundaries, where route middleware doesn't run.
 * - **Everything else the router answers** (`/api/*` resource routes, `.data`
 *   requests): `securityHeadersMiddleware`, the root route's middleware, sets
 *   the same headers with `API_CSP`, a policy that allows nothing, since those
 *   responses never load anything. It keeps a CSP that's already there, so the
 *   document's policy survives on its way out through the middleware.
 *
 * Not covered: static files that `react-router-serve` answers before the router
 * (`/assets/*`, `public/`) and the `/__manifest` route discovery response.
 */

/** Hosts Docker Hub serves logos (`*.cloudfront.net`) and avatars (gravatar) from. */
export const IMAGE_HOSTS = ['https://*.cloudfront.net', 'https://www.gravatar.com'] as const;

/** For responses that aren't HTML pages: they load nothing and can't be framed. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** Headers every response gets, whatever its CSP. */
export const BASE_SECURITY_HEADERS = {
  // One year. Browsers ignore it on plain-HTTP responses (e.g. localhost).
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
} as const;

/** 128 random bits, base64-encoded, as the CSP spec recommends. */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * The page CSP. `dev` loosens it for the Vite dev server only: Vite injects CSS
 * as inline `<style>` tags. Production builds link CSS files from `'self'`.
 */
export function documentCsp(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    ...(dev ? ["style-src 'self' 'unsafe-inline'"] : []),
    `img-src 'self' ${IMAGE_HOSTS.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Sets the page CSP for `nonce` and the base headers on a document's headers. */
export function setDocumentSecurityHeaders(
  headers: Headers,
  nonce: string,
  options: { dev?: boolean } = {},
): void {
  headers.set('Content-Security-Policy', documentCsp(nonce, options));
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) headers.set(name, value);
}

/**
 * Sets the base headers on `response`, and `API_CSP` unless it already has a
 * CSP. A response with immutable headers (e.g. straight from `fetch`) is copied
 * first, so the returned response may be a new object.
 */
export function withSecurityHeaders(response: Response): Response {
  const apply = (headers: Headers) => {
    if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', API_CSP);
    for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) headers.set(name, value);
  };
  try {
    apply(response.headers);
    return response;
  } catch (_error) {
    const copy = new Response(response.body, response);
    apply(copy.headers);
    return copy;
  }
}

export const securityHeadersMiddleware: MiddlewareFunction<Response> = async (_args, next) =>
  withSecurityHeaders(await next());
