/**
 * Per-platform image helpers for the tags table's architecture breakdown
 * (questionnaire D23, E28). Pure string formatting only.
 */

import type { TagImage } from './dto';

/** Hex characters a short digest keeps, like `docker images`' IMAGE ID column. */
export const SHORT_DIGEST_LENGTH = 12;

/**
 * `linux/arm64/v8`, as in `docker pull --platform linux/arm64/v8`. Leaves out
 * an empty OS (some very old images) and a missing variant.
 */
export function platformLabel(image: Pick<TagImage, 'os' | 'arch' | 'variant'>): string {
  return [image.os, image.arch, image.variant].filter(Boolean).join('/');
}

/**
 * `sha256:9b6786d8d129` for `sha256:9b6786d8d129fe8e…`: the algorithm and the
 * first 12 hex characters. A digest that's already short is returned as is.
 */
export function shortDigest(digest: string): string {
  const colon = digest.indexOf(':');
  const algorithm = colon === -1 ? '' : digest.slice(0, colon + 1);
  const hex = digest.slice(colon + 1);
  return algorithm + hex.slice(0, SHORT_DIGEST_LENGTH);
}
