import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: FilmHome,
})

function FilmHome() {
  return (
    <main className="mx-auto max-w-3xl p-6 pt-16">
      <h1 className="font-serif text-3xl">Film</h1>
    </main>
  )
}
