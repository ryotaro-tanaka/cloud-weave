import './shared-utilities.css'

type SpinnerProps = {
  /** When false, `aria-hidden` is omitted so the spinner can be announced. */
  decorative?: boolean
}

export function Spinner({ decorative = true }: SpinnerProps) {
  return <span className="spinner" aria-hidden={decorative ? 'true' : undefined} />
}
