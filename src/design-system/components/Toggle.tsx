import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../utils/cx';

const toneClasses = {
  success: 'ds-toggle--success',
  warning: 'ds-toggle--warning',
  danger: 'ds-toggle--danger',
  info: 'ds-toggle--info',
  neutral: 'ds-toggle--neutral',
} as const;

type ToggleTone = keyof typeof toneClasses;

export interface ToggleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  checked: boolean;
  checkedLabel: string;
  uncheckedLabel: string;
  checkedTone?: ToggleTone;
  uncheckedTone?: ToggleTone;
}

export function Toggle({
  checked,
  checkedLabel,
  uncheckedLabel,
  checkedTone = 'danger',
  uncheckedTone = 'success',
  className,
  type = 'button',
  ...props
}: ToggleProps) {
  const toneClass = checked ? toneClasses[checkedTone] : toneClasses[uncheckedTone];

  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      className={cx('ds-toggle', toneClass, className)}
      {...props}
    >
      <span className="ds-toggle__dot" aria-hidden="true"></span>
      <span>{checked ? checkedLabel : uncheckedLabel}</span>
    </button>
  );
}
