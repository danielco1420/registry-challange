import { data, redirect } from 'react-router';

import { safeRedirectPath, ThemeFormSchema } from '~/lib/theme';
import { parseParams } from '~/lib/validate';
import { config } from '~/server/config.server';
import { themeCookieHeader } from '~/server/theme.server';

import type { Route } from './+types/theme';

/**
 * POST /theme: stores the Light / Dark / System choice in the theme cookie
 * (questionnaire D19, B8). Action only; nothing here calls Docker Hub.
 *
 * - From the toggle's fetcher (JavaScript): answers `{ theme }` with the
 *   cookie; the root loader then revalidates and `<html>` gets the new class.
 * - From the native form (no JavaScript): the form also sends `redirectTo`,
 *   and the action answers a 303 back to it, limited to same-origin paths.
 *
 * A cross-origin POST gets a `403`. React Router checks the `Origin` header
 * itself for document and `.data` actions, but not for resource routes like
 * this one, which the no-JS form posts to directly.
 */
export async function action({ request }: Route.ActionArgs) {
  if (isCrossOrigin(request)) {
    return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  // A body that isn't form data (JSON, a broken multipart boundary) is a 400, not a 500.
  const form = await request.formData().catch(() => new FormData());
  const parsed = parseParams(ThemeFormSchema, Object.fromEntries(form));
  if (!parsed.ok) return parsed.response;

  const { theme, redirectTo } = parsed.value;
  const headers = { 'Set-Cookie': themeCookieHeader(theme), 'Cache-Control': 'no-store' };
  if (redirectTo !== undefined) {
    return redirect(safeRedirectPath(redirectTo), { status: 303, headers });
  }
  return data({ theme }, { headers });
}

/**
 * True when a browser sent this request from another origin: the `Origin`
 * header, when present, must match ours (`Origin: null` doesn't). Ours is
 * `PUBLIC_ORIGIN` when set, since behind a TLS-terminating proxy `request.url`
 * is `http://` while the browser sends `https://`; otherwise the request URL's
 * origin. `X-Forwarded-*` headers are never trusted for this.
 */
function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  const expected = config.app.publicOrigin ?? new URL(request.url).origin;
  return origin !== null && origin !== expected;
}
