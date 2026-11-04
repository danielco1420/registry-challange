import { useEffect, useRef, useState } from 'react';

import { initials } from '~/lib/initials';
import { cn } from '~/lib/utils';

import { usePublisherAvatar } from './use-publisher-avatar';

const SIZES = {
  sm: { px: 32, className: 'size-8 text-xs' },
  md: { px: 48, className: 'size-12 text-base' },
  lg: { px: 64, className: 'size-16 text-xl' },
} as const;

export interface RepoLogoProps {
  /** The repository's namespace; also the publisher whose avatar is the fallback. */
  namespace: string;
  /** Repository name without the namespace; the initials come from it. */
  name: string;
  /** `RepoSummary.logoUrl`: absent when Docker Hub has no logo. */
  logoUrl?: string;
  /**
   * The publisher's avatar, when the caller already has it (`Publisher.avatarUrl`):
   * a URL, or `null` for "no avatar". Left `undefined`, `RepoLogo` looks it up
   * through `/api/publishers/:name`, but only if the logo is missing or fails.
   */
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * A repository's logo with fallbacks (RISKS.md 3.2, 4.3; docs/API.md D):
 * the logo, else the publisher's avatar, else the name's initials. An image
 * that fails to load moves on to the next one. Third-party images are sent
 * no referrer.
 *
 * Decorative: it always sits next to the repository name, so the image has
 * `alt=""` and the initials are hidden from assistive tech.
 *
 * The server renders the logo, or the initials when there's no logo; the
 * avatar lookup runs in the browser. While it's loading, or if it fails, the
 * initials stay, so the tile is never empty.
 */
export function RepoLogo({
  namespace,
  name,
  logoUrl,
  avatarUrl,
  size = 'md',
  className,
}: RepoLogoProps) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);

  const usable = (url: string | null | undefined): url is string => !!url && !failed.includes(url);
  const needsAvatar = !usable(logoUrl);
  const fetchedAvatar = usePublisherAvatar(namespace, needsAvatar && avatarUrl === undefined);
  const avatar = avatarUrl === undefined ? fetchedAvatar : avatarUrl;
  const src = usable(logoUrl) ? logoUrl : usable(avatar) ? avatar : undefined;

  // An image that failed before hydration fired its `error` event before React
  // was listening. It's `complete` but has no pixels. An SVG without intrinsic
  // dimensions also reports `naturalWidth` 0 when it loaded fine, so where the
  // browser has `decode()` (it rejects only for a broken image), ask it first.
  useEffect(() => {
    const image = imageRef.current;
    if (!src || !image?.complete || image.naturalWidth !== 0) return;
    const markFailed = () => setFailed((previous) => [...previous, src]);
    if (typeof image.decode === 'function') {
      void image.decode().catch(markFailed);
    } else {
      markFailed();
    }
  }, [src]);

  const { px, className: sizeClass } = SIZES[size];
  const frame = cn(
    'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted',
    sizeClass,
    className,
  );

  if (!src) {
    return (
      <span aria-hidden="true" className={cn(frame, 'font-semibold text-muted-foreground')}>
        {initials(name)}
      </span>
    );
  }

  return (
    <span className={frame}>
      <img
        key={src}
        ref={imageRef}
        src={src}
        alt=""
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="size-full object-contain"
        onError={() => setFailed((previous) => [...previous, src])}
      />
    </span>
  );
}
