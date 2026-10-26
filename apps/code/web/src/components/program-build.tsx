import { useEffect, useRef, useState } from "react"
import { HammerIcon } from "@phosphor-icons/react"
import { submitBuild, type BuildSource } from "@/lib/build-program"
import { useProgramConnection } from "./program-connection"
import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@workspace/ui/components/sheet"
import { toast } from "@workspace/ui/components/toast"
import { errorMessage } from "@/lib/errors"

export function ProgramBuild({
  dirty,
  prepareSource,
}: {
  dirty: boolean
  prepareSource: () => Promise<BuildSource>
}) {
  const logRef = useRef<HTMLPreElement>(null)
  const {
    status: state,
    ready,
    error: presenceError,
    request,
  } = useProgramConnection()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [state?.logs, open])
  async function build() {
    setOpen(true)
    setPending(true)
    try {
      await submitBuild(request, await prepareSource())
    } catch (error) {
      toast.add({
        type: "error",
        title: "Could not build",
        description: errorMessage(error),
      })
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={state?.building ? "View build logs" : "Build program"}
        title={state?.building ? "View build logs" : "Build program"}
        aria-busy={pending || state?.building}
        onClick={() => {
          if (pending || state?.building || !ready) {
            setOpen(true)
          } else {
            void build()
          }
        }}
      >
        <HammerIcon />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="data-[side=bottom]:h-[55svh]">
          <SheetHeader>
            <SheetTitle>Build logs</SheetTitle>
            <SheetDescription>
              {state?.building ? "Building" : ready ? "Ready" : "Connecting"}.
              Builds use committed source.
              {dirty && " Commit your changes to include them in the build."}
            </SheetDescription>
          </SheetHeader>
          <pre
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-relevant="text"
            className="min-h-0 flex-1 overflow-auto px-4 pb-4 font-mono text-xs break-words whitespace-pre-wrap"
          >
            {presenceError ?? state?.logs ?? "Connecting to the build service…"}
          </pre>
        </SheetContent>
      </Sheet>
    </>
  )
}
