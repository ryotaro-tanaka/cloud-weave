import type { ButtonHTMLAttributes, ReactNode } from 'react'

type RowMenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
}

/** Native control styled as `.row-menu-item` (toolbar uses `Button`; row menus stay unstyled for menu CSS). */
export function RowMenuItem({ children, className, type = 'button', role = 'menuitem', ...rest }: RowMenuItemProps) {
  return (
    <button className={className ? `row-menu-item ${className}` : 'row-menu-item'} type={type} role={role} {...rest}>
      {children}
    </button>
  )
}
