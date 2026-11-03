import { data, redirect } from 'react-router';

import { safeRedirectPath, ThemeFormSchema } from '~/lib/theme';
import { parseParams } from '~/lib/validate';
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
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = parseParams(ThemeFormSchema, Object.fromEntries(form));
  if (!parsed.ok) return parsed.response;

  const { theme, redirectTo } = parsed.value;
  const headers = { 'Set-Cookie': themeCookieHeader(theme), 'Cache-Control': 'no-store' };
  if (redirectTo !== undefined) {
    return redirect(safeRedirectPath(redirectTo), { status: 303, headers });
  }
  return data({ theme }, { headers });
}
