import { OFFICIAL_NAMESPACE } from './pull-command';

/**
 * The repository page's URL (questionnaire C14, mirroring Docker Hub):
 * `/_/{repo}` for official images, `/r/{ns}/{repo}` for everything else.
 * Segments are URI-encoded, though DTO names are already validated.
 */
export function repoPath(namespace: string, name: string): string {
  const repo = encodeURIComponent(name);
  return namespace === OFFICIAL_NAMESPACE
    ? `/_/${repo}`
    : `/r/${encodeURIComponent(namespace)}/${repo}`;
}
