import type { HTMLAttributes } from 'react';
import { cx } from '../utils/cx';

const badgeVariantClasses = {
  neutral: 'ds-badge--neutral',
  count: 'ds-badge--count',
  info: 'ds-badge--info',
  success: 'ds-badge--success',
  warning: 'ds-badge--warning',
  danger: 'ds-badge--danger',
  methodGet: 'ds-badge--method-get',
  methodWrite: 'ds-badge--method-write',
  methodOther: 'ds-badge--method-other',
  apiRest: 'ds-badge--api-rest',
  apiGraphql: 'ds-badge--api-graphql',
  subtle: 'ds-badge--subtle',
} as const;

const badgeSizeClasses = {
  xs: 'ds-badge--xs',
  sm: 'ds-badge--sm',
  md: 'ds-badge--md',
} as const;

export type BadgeVariant = keyof typeof badgeVariantClasses;
export type BadgeSize = keyof typeof badgeSizeClasses;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  uppercase?: boolean;
}

export function Badge({
  variant = 'neutral',
  size = 'sm',
  uppercase = true,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cx(
        'ds-badge',
        badgeVariantClasses[variant],
        badgeSizeClasses[size],
        uppercase ? 'ds-badge--caps' : '',
        className,
      )}
      {...props}
    />
  );
}
