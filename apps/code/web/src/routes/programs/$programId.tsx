import { createFileRoute } from "@tanstack/react-router"
import { ProgramEntry } from "@/components/program/program-entry"

export const Route = createFileRoute("/programs/$programId")({
  component: ProgramEntry,
})
