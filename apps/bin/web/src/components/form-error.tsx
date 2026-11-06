// Sits beside the button that caused it, so an error never moves what is below.
export function FormError({ message }: { message: string | null }) {
  if (message === null) return null
  return (
    <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
      {message}
    </p>
  )
}
