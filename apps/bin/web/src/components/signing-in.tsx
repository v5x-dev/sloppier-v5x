import { Spinner } from "@v5x/ui/components/spinner"

// Shown during the WorkOS redirect. The words say what is happening.
export function SigningIn() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3">
      <Spinner className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  )
}
