/**
 * `docker pull` command helpers (D26, RISKS.md 4.1).
 *
 * Official images live in the `library` namespace, but Docker Hub's own
 * `docker pull` convention omits it (CLAUDE.md hard rule 6): `docker pull
 * nginx:tag`, not `docker pull library/nginx:tag`.
 *
 * Pure string formatting only — no validation here. Callers pass values
 * that already went through the param schemas in `app/lib/params.ts`.
 */

/** Official images namespace. Its name is omitted from the pull command. */
export const OFFICIAL_NAMESPACE = 'library';

/** `image` without the namespace when it's `library`, else `ns/image`. */
export function imageRef(ns: string, repo: string): string {
  return ns === OFFICIAL_NAMESPACE ? repo : `${ns}/${repo}`;
}

/** `docker pull nginx:latest` or `docker pull fluent/fluent-bit:3.1.9`. */
export function pullCommand(ns: string, repo: string, tag: string): string {
  return `docker pull ${imageRef(ns, repo)}:${tag}`;
}

/** `docker pull nginx@sha256:...` — pin by digest instead of a mutable tag. */
export function pullByDigest(ns: string, repo: string, digest: string): string {
  return `docker pull ${imageRef(ns, repo)}@${digest}`;
}
