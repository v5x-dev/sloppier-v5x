// Simulates only the external machine API and direct Builder HTTP protocol.
import { createServer } from "node:http"
import { randomBytes, randomUUID } from "node:crypto"
import { zipSync, unzipSync } from "fflate"

export async function startFakeBuilder() {
  const machines = new Map()
  let failNext = false,
    builds = 0,
    uploads = 0
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type"
    )
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS"
    )
    const send = (value, status = 200) => {
      response.statusCode = status
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify(value))
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204)
      response.end()
      return
    }
    const url = new URL(request.url, "http://localhost")
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    let body
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      send({ error: "Invalid JSON" }, 400)
      return
    }
    if (url.pathname === "/__control") {
      if (body.failNext !== undefined) failNext = body.failNext
      send({ builds, uploads })
      return
    }
    if (request.headers.authorization !== "Bearer fixture-token") {
      send({ error: "Unauthorized" }, 401)
      return
    }
    if (url.pathname === "/v1/machines" && request.method === "POST") {
      const id = randomUUID()
      machines.set(id, {
        logs: "Ready",
        building: false,
        artifactId: null,
        chunks: new Map(),
        artifact: null,
      })
      send({ id })
      return
    }
    const match = url.pathname.match(/^\/v1\/machines\/([^/]+)(.*)$/)
    const machine = match && machines.get(match[1])
    if (!machine) {
      send({ error: "Unknown machine" }, 404)
      return
    }
    const path = match[2]
    if (!path) {
      if (request.method === "DELETE") machines.delete(match[1])
      send({
        ready: true,
        state: "running",
        source: { reference: "fixture-image" },
      })
      return
    }
    if (path === "/connect-token") {
      send({
        token: "fixture-token",
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      })
      return
    }
    if (path === "/exec") {
      send({
        exitCode: 0,
        stdout: JSON.stringify({
          viewers: 1,
          building: machine.building,
          completed: !machine.building && !!machine.artifactId,
          key: machine.artifactId ?? "empty",
        }),
      })
      return
    }
    if (path === "/connect/8080/status") {
      send({
        logs: machine.logs,
        building: machine.building,
        artifactId: machine.artifactId,
      })
      return
    }
    if (path === "/connect/8080/upload") {
      const bytes = Buffer.from(body.data, "base64")
      const current = machine.chunks.get(body.id) ?? Buffer.alloc(0)
      if (body.offset !== current.length) {
        send({ error: "Invalid offset" }, 400)
        return
      }
      machine.chunks.set(body.id, Buffer.concat([current, bytes]))
      uploads++
      send({})
      return
    }
    if (path === "/connect/8080/build") {
      const source = machine.chunks.get(body.id)
      if (!source || !Object.keys(unzipSync(source)).includes("src/main.cpp")) {
        send({ error: "Source snapshot missing" }, 400)
        return
      }
      builds++
      const failure = failNext
      failNext = false
      machine.building = true
      machine.logs = `Building commit ${body.commit}\n`
      setTimeout(() => {
        machine.building = false
        machine.logs += failure ? "Build failed (exit 2)." : "Build succeeded."
        machine.artifactId = failure ? null : randomUUID()
        machine.artifact = failure
          ? null
          : zipSync({ "bin/program.bin": randomBytes(8192) })
      }, 800)
      send({})
      return
    }
    if (path === "/connect/8080/artifact" && machine.artifact) {
      response.setHeader("Content-Type", "application/zip")
      response.end(machine.artifact)
      return
    }
    send({ error: `Unsupported fixture request ${path}` }, 404)
  })
  await new Promise((yes, no) => {
    server.once("error", no)
    server.listen(0, "127.0.0.1", yes)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () =>
      new Promise((yes, no) =>
        server.close((error) => (error ? no(error) : yes()))
      ),
  }
}
