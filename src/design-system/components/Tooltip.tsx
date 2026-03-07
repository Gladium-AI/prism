import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx';

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  label: ReactNode;
  side?: TooltipSide;
  bubbleClassName?: string;
  children: ReactNode;
}

export function Tooltip({
  label,
  side = 'top',
  className,
  bubbleClassName,
  children,
  ...props
}: TooltipProps) {
  return (
    <span className={cx('ds-tooltip', `ds-tooltip--${side}`, className)} {...props}>
      <span className="ds-tooltip__trigger">{children}</span>
      <span role="tooltip" className={cx('ds-tooltip__bubble', bubbleClassName)}>
        {label}
      </span>
    </span>
  );
}
