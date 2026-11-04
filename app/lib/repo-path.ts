import { OFFICIAL_NAMESPACE } from './pull-command';

/**
 * The app URL of a repository page (questionnaire C14, mirroring Docker Hub):
 * `/_/{repo}` for official images, `/r/{ns}/{repo}` otherwise. Segments are
 * URI-encoded, so a value that didn't come through the param schemas still
 * can't change the path.
 */
export function repoPath(namespace: string, name: string): string {
  return namespace === OFFICIAL_NAMESPACE
    ? `/_/${encodeURIComponent(name)}`
    : `/r/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}
