import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: DesignHome,
})

function DesignHome() {
  return (
    <main className="mx-auto max-w-3xl p-6 pt-16">
      <h1 className="font-serif text-3xl">Design</h1>
    </main>
  )
}
