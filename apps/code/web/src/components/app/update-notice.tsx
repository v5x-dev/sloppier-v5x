import { useEffect } from "react"
import { ArrowClockwiseIcon, InfoIcon } from "@phosphor-icons/react"
import { Button } from "@v5x/ui/components/button"
import release from "virtual:code-release"
import {
  Toast,
  ToastClose,
  ToastContent,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  useToastManager,
} from "@v5x/ui/components/toast"

const updates = createToastManager()

function UpdateToast() {
  const { toasts } = useToastManager()
  return toasts.map((item) => (
    <Toast key={item.id} toast={item}>
      <ToastContent>
        <span className="flex h-5 shrink-0 items-center text-muted-foreground">
          <InfoIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <ToastTitle />
        </div>
        <div className="-my-0.5 -mr-1 flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Reload"
            title="Reload"
            onClick={() => window.location.reload()}
          >
            <ArrowClockwiseIcon />
          </Button>
          <ToastClose />
        </div>
      </ToastContent>
    </Toast>
  ))
}

export function UpdateNotice() {
  useEffect(() => {
    if (import.meta.env.DEV) return
    let disposed = false
    let notified = false
    let checking = false
    async function check() {
      if (checking || notified || document.visibilityState !== "visible") return
      checking = true
      try {
        const response = await fetch("/release.json", { cache: "no-store" })
        if (!response.ok) return
        const data: unknown = await response.json()
        if (
          !disposed &&
          typeof data === "object" &&
          data !== null &&
          "release" in data &&
          typeof data.release === "string" &&
          data.release !== release
        ) {
          notified = true
          updates.add({
            type: "info",
            title: "A new version is available",
            timeout: 0,
          })
        }
      } catch {
        // Retry on the next interval or return to the tab.
      } finally {
        checking = false
      }
    }
    void check()
    const interval = window.setInterval(check, 5 * 60 * 1000)
    document.addEventListener("visibilitychange", check)
    return () => {
      disposed = true
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", check)
    }
  }, [])
  return (
    <ToastProvider toastManager={updates}>
      <ToastPortal>
        <ToastViewport>
          <UpdateToast />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  )
}
