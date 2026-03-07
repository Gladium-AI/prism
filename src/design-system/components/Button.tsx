import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../utils/cx';

const buttonVariantClasses = {
  primary: 'ds-button--primary',
  secondary: 'ds-button--secondary',
  ghost: 'ds-button--ghost',
  menu: 'ds-button--menu',
  danger: 'ds-button--danger',
  warning: 'ds-button--warning',
} as const;

const buttonSizeClasses = {
  xs: 'ds-button--xs',
  sm: 'ds-button--sm',
  md: 'ds-button--md',
  lg: 'ds-button--lg',
  icon: 'ds-button--icon',
} as const;

export type ButtonVariant = keyof typeof buttonVariantClasses;
export type ButtonSize = keyof typeof buttonSizeClasses;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ds-button',
        buttonVariantClasses[variant],
        buttonSizeClasses[size],
        fullWidth ? 'ds-button--full' : '',
        className,
      )}
      {...props}
    />
  );
}
