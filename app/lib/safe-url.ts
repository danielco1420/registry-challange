/**
 * URL allowlist for publisher-controlled Markdown (RISKS.md 3.1). Client-safe.
 *
 * Only absolute URLs survive, so a link can never run script (`javascript:`,
 * `vbscript:`, `data:`) and a README's relative link (written for GitHub) can't
 * point into our own app:
 * - links (`href`): `https:`, `http:` and `mailto:`;
 * - images (`src`): `https:` only, the only scheme the CSP's `img-src` allows.
 *
 * The URL is parsed with WHATWG `URL`, the same parser the browser uses, so
 * tricks like `JaVaScRiPt:`, leading spaces or a tab inside the scheme are seen
 * the way the browser would see them.
 */
const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['https:', 'http:', 'mailto:']);
const IMAGE_PROTOCOLS: ReadonlySet<string> = new Set(['https:']);

export type UrlKind = 'link' | 'image';

/** The normalized URL when it's allowed for `kind`, else `null` (drop the attribute). */
export function safeUrl(value: string, kind: UrlKind = 'link'): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    // Relative, protocol-relative or malformed: nothing to resolve it against.
    return null;
  }
  const allowed = kind === 'image' ? IMAGE_PROTOCOLS : LINK_PROTOCOLS;
  return allowed.has(url.protocol) ? url.href : null;
}
