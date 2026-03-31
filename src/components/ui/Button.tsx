import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './button.css'

type ButtonFamily = 'primary' | 'secondary' | 'quiet' | 'icon'
type ButtonSize = 'sm' | 'md'
type ButtonTone = 'default' | 'warning' | 'danger'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  family: ButtonFamily
  size?: ButtonSize
  tone?: ButtonTone
  children: ReactNode
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function Button({
  family,
  size = 'md',
  tone = 'default',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        'cw-button',
        `cw-button-${family}`,
        `cw-button-${size}`,
        tone !== 'default' && `cw-button-tone-${tone}`,
        className,
      )}
    >
      {children}
    </button>
  )
}

