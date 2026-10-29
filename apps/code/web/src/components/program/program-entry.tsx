import { AuthGate } from "@/components/app/auth-gate"
import { ActionsBar } from "@/components/program/program-actions-bar"
import { ProgramConnection } from "@/components/program/program-connection"
import { Workbench } from "@/components/program/program-workbench"
import { WorkbenchSource } from "@/lib/workbench-source"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/lib/auth"
import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { Link, getRouteApi } from "@tanstack/react-router"
import { api } from "@v5x/backend/api"
import type { Doc, Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@v5x/ui/components/sidebar"
import { Spinner } from "@v5x/ui/components/spinner"
import { toast } from "@v5x/ui/components/toast"
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react"
import { useEffect, useState } from "react"

const programRoute = getRouteApi("/programs/$programId")
export function ProgramEntry() {
  return (
    <AuthGate renderWhileLoading>
      <ProgramPage />
    </AuthGate>
  )
}

export function ProgramPage() {
  const { programId: rawProgramId } = programRoute.useParams()
  return (
    <ProgramLoader
      key={rawProgramId}
      programId={rawProgramId as Id<"programs">}
    />
  )
}

function ProgramLoader({ programId }: { programId: Id<"programs"> }) {
  const { isAuthenticated } = useConvexAuth()
  const auth = useAuth()
  const program = useQuery(
    api.programs.get,
    isAuthenticated ? { programId } : "skip"
  )
  const buildManifest = useAction(api.codeStorage.buildManifest)
  const listFiles = useAction(api.codeStorage.listFiles)
  const readFile = useAction(api.codeStorage.readFile)
  const openLiveFile = useAction(api.codeStorage.openLiveFile)
  const commitFiles = useAction(api.codeStorage.commitFiles)
  const restoreHistoryFile = useAction(api.codeStorage.restoreHistoryFile)
  const restoreHistoryCommit = useAction(api.codeStorage.restoreHistoryCommit)
  const [source] = useState(
    () =>
      new WorkbenchSource(programId, {
        buildManifest,
        listFiles,
        readFile,
        openLiveFile,
        commitFiles,
        restoreHistoryFile,
        restoreHistoryCommit,
      })
  )
  useEffect(() => {
    if (program === undefined && !auth.isLoading && auth.user)
      source.prefetchPaths()
  }, [source, program, auth.isLoading, auth.user])

  if (program === undefined) {
    return <ProgramBootShape />
  }

  if (program.repositoryStatus === "ready") {
    return (
      <ProgramConnection key={program._id} programId={program._id}>
        <Workbench program={program} source={source} />
      </ProgramConnection>
    )
  }

  return (
    <div className="flex h-svh flex-col">
      <ProvisioningState program={program} />
    </div>
  )
}

// Convex has no program result during SSR. Render the empty workbench frame so
// the page has its final shape before the program query hydrates.
function ProgramBootShape() {
  return (
    <SidebarProvider
      className="h-svh min-h-0"
      style={
        {
          "--sidebar-width": "18rem",
          "--sidebar-border":
            "color-mix(in oklab, var(--foreground) 20%, var(--background))",
        } as React.CSSProperties
      }
    >
      <Sidebar variant="floating">
        <SidebarHeader className="flex-row items-center gap-1 p-1 text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to="/" aria-label="All programs" />}
            nativeButton={false}
          >
            <CaretLeftIcon />
          </Button>
        </SidebarHeader>
        <SidebarContent className="overflow-hidden" />
        <SidebarFooter className="h-11 p-0" />
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 pt-2">
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        </div>
        <ActionsBar activePath={null} leftAction={null}>
          {null}
        </ActionsBar>
      </SidebarInset>
    </SidebarProvider>
  )
}

function ProvisioningState({ program }: { program: Doc<"programs"> }) {
  const retry = useMutation(api.programs.retryProvisioning)

  if (program.repositoryStatus === "failed") {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Repository setup failed</EmptyTitle>
          <EmptyDescription>
            {program.repositoryError ??
              "Code Storage could not import the template."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() =>
              retry({ programId: program._id }).catch((error) =>
                toast.add({
                  type: "error",
                  title: "Could not retry setup",
                  description: errorMessage(error),
                })
              )
            }
          >
            <ArrowClockwiseIcon data-icon="inline-start" />
            Retry setup
          </Button>
          <Button
            variant="outline"
            render={<Link to="/" />}
            nativeButton={false}
          >
            All programs
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyTitle>Setting up the repository</EmptyTitle>
        <EmptyDescription>
          Copying the starter files into Code Storage. This page opens the
          editor when it finishes.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" render={<Link to="/" />} nativeButton={false}>
          All programs
        </Button>
      </EmptyContent>
    </Empty>
  )
}
