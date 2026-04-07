type SortMenuOptionButtonProps = {
  active: boolean
  label: string
  onSelect: () => void
}

export function SortMenuOptionButton({ active, label, onSelect }: SortMenuOptionButtonProps) {
  return (
    <button
      className={`toolbar-select-option ${active ? 'active' : ''}`}
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onSelect}
    >
      <span>{label}</span>
      {active ? <span aria-hidden="true">•</span> : null}
    </button>
  )
}
