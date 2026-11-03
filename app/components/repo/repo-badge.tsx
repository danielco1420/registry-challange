import { useTranslation } from 'react-i18next';

import { Badge } from '~/components/ui/badge';
import type { Badge as RepoBadgeValue } from '~/lib/dto';

type ShownBadge = Exclude<RepoBadgeValue, 'none'>;

/** Official stands out with the green fill; the others are quieter. All pairs are contrast-checked. */
const VARIANTS: Record<ShownBadge, 'default' | 'secondary' | 'outline'> = {
  official: 'default',
  verified_publisher: 'secondary',
  open_source: 'outline',
  hardened: 'outline',
};

export interface RepoBadgeProps {
  badge: RepoBadgeValue;
  className?: string;
}

/**
 * A repository's trust badge (questionnaire D22, E28): "Official Image",
 * "Verified Publisher", and the other values the DTO carries. Renders nothing
 * for `none`. Visible text, so no extra label is needed.
 */
export function RepoBadge({ badge, className }: RepoBadgeProps) {
  const { t } = useTranslation();
  if (badge === 'none') return null;

  return (
    <Badge variant={VARIANTS[badge]} className={className}>
      {t(`repo.badge.${badge}`)}
    </Badge>
  );
}
