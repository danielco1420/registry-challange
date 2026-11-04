import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Markdown } from '~/components/markdown/markdown';
import { useRepoPage } from '~/components/repo/repo-page-context';
import { Empty } from '~/components/state/empty';
import { buttonVariants } from '~/components/ui/button';

/**
 * The Overview tab (questionnaire D24): the repository's `full_description`,
 * rendered as sanitized Markdown (RISKS.md 3.1). A repository without one gets
 * an empty state that points to its tags.
 */
export default function RepoOverview() {
  const { t } = useTranslation();
  const { repo, basePath } = useRepoPage();

  if (repo.fullDescriptionMd.trim() === '') {
    return (
      <Empty
        title={t('repo.overview.empty.title')}
        description={t('repo.overview.empty.description')}
        action={
          <Link to={`${basePath}/tags`} className={buttonVariants({ variant: 'outline' })}>
            {t('repo.overview.empty.action')}
          </Link>
        }
      />
    );
  }

  return <Markdown>{repo.fullDescriptionMd}</Markdown>;
}
