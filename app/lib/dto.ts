/**
 * The DTOs our `/api/*` routes and loaders return (docs/API.md, "What our
 * frontend consumes"). No server imports, so client code can use them; the
 * normalizers that build them from Docker Hub payloads live server-side in
 * `app/server/normalize.server.ts`.
 */

/** Every trust badge a repository can have (`BADGES` in `params.ts` is the narrower search filter). */
export const BADGE_VALUES = [
  'official',
  'verified_publisher',
  'open_source',
  'hardened',
  'none',
] as const;
export type Badge = (typeof BADGE_VALUES)[number];

export interface RepoSummary {
  /** `namespace/name`, e.g. `library/nginx`. */
  id: string;
  /** `library` for official images. */
  namespace: string;
  /** Repository name without the namespace, e.g. `nginx`. */
  name: string;
  /** `nginx` for official images, else `fluent/fluent-bit`. */
  displayName: string;
  /** Publisher display name when Docker Hub gives one (e.g. `NGINX Inc.`), else the namespace. */
  owner: string;
  /** Short description; `''` when the repository has none. */
  description: string;
  /** An `https:` logo URL; absent when Docker Hub has none (use the avatar fallback). */
  logoUrl?: string;
  badge: Badge;
  /** Pull count as a number; approximate when Docker Hub only sent a label like `1B+`. */
  pulls: number;
  /** Docker Hub's display label, e.g. `1B+`, `7.0K` or `82`. */
  pullsLabel: string;
  stars: number;
  /** ISO timestamp; `''` when unknown. */
  updatedAt: string;
  /**
   * Search's display labels, e.g. `x86-64`, `ARM 64` (not the raw `amd64` of
   * `TagImage.arch`); empty when there was no search result to take them from.
   */
  archs: string[];
  /** The publisher archived the repository: read-only, no new pushes. */
  archived: boolean;
}

export interface RepoDetails extends RepoSummary {
  /** Raw Markdown from Docker Hub. Untrusted: sanitize before rendering. `''` when absent. */
  fullDescriptionMd: string;
  /** ISO timestamp; `''` when unknown. */
  registeredAt: string;
  /** Total storage of all tags, in bytes; absent when unknown or 0. */
  storageSize?: number;
  categories: string[];
}

export interface TagImage {
  /** Raw platform name (`amd64`, `arm64`), as in `docker pull --platform linux/arm64`. */
  arch: string;
  variant?: string;
  /** `linux`, `windows`; `''` for some very old images. */
  os: string;
  /** Compressed size in bytes; 0 when unknown. */
  size: number;
}

export interface Tag {
  name: string;
  /** ISO timestamp; `''` when unknown. */
  updatedAt: string;
  /** Compressed size in bytes; 0 when unknown (render as "—"). */
  size: number;
  digest?: string;
  pushedBy?: string;
  lastPulled?: string;
  /** Per-platform images; attestation entries (`unknown/unknown`) are dropped. */
  images: TagImage[];
}

export interface Page<T> {
  items: T[];
  total: number;
  /** 1-based. */
  page: number;
  pageSize: number;
}
