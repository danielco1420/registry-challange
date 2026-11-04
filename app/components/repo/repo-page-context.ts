import { useOutletContext } from 'react-router';

import type { RepoDetails } from '~/lib/dto';

/**
 * What the repository page's layout (`app/routes/repo.tsx`) hands its tabs
 * through `<Outlet context>`. The layout serves two route ids (`/r/:ns/:repo`
 * and `/_/:repo`), so the tabs read it here instead of looking up a loader id.
 */
export interface RepoPageContext {
  repo: RepoDetails;
  /** The page's base URL (`repoPath`), e.g. `/_/nginx`; tabs append to it. */
  basePath: string;
}

export function useRepoPage(): RepoPageContext {
  return useOutletContext<RepoPageContext>();
}
