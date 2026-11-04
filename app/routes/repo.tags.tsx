import { useTranslation } from 'react-i18next';

/**
 * The Tags tab. A placeholder until the tag table (questionnaire D23, T25)
 * lands; the URL already exists so the tab can be linked to.
 */
export default function RepoTags() {
  const { t } = useTranslation();

  return <p className="text-muted-foreground">{t('repo.tags.placeholder')}</p>;
}
