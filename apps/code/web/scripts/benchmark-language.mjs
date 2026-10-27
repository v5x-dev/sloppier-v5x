/** Real Chromium benchmark, including edits, SDK navigation, and UI responsiveness.
 * Run with Bun. PLAYWRIGHT_MODULE can locate an existing global installation.
 */
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { readFile, writeFile } from "node:fs/promises"

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const web = resolve(import.meta.dir, "..")
const bundle = await Bun.build({
  entrypoints: [resolve(web, "src/lib/language/clangd.worker.ts")],
  target: "browser",
  minify: true,
})
if (!bundle.success) throw new Error(String(bundle.logs))
const assets = process.env.LANGUAGE_ASSET_DIR || resolve(web, "public/language")
const workerBundle = process.env.WORKER_BUNDLE
  ? Bun.file(process.env.WORKER_BUNDLE)
  : bundle.outputs[0]
const requests = []
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    requests.push(url.pathname)
    const headers = {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    }
    if (url.pathname === "/")
      return new Response(
        '<!doctype html><title>Language benchmark</title><link rel="icon" href="data:,">',
        { headers: { ...headers, "Content-Type": "text/html" } }
      )
    if (url.pathname === "/worker.js")
      return new Response(workerBundle, {
        headers: { ...headers, "Content-Type": "text/javascript" },
      })
    if (!url.pathname.startsWith("/language/") || url.pathname.includes(".."))
      return new Response(null, { status: 404 })
    const file = Bun.file(
      resolve(assets, url.pathname.slice("/language/".length))
    )
    if (!(await file.exists())) return new Response(null, { status: 404 })
    return new Response(file, {
      headers: {
        ...headers,
        "Content-Type": file.type,
        ...(/\.wasm$/.test(url.pathname)
          ? { "Content-Encoding": "gzip", "Content-Type": "application/wasm" }
          : {}),
        "Cache-Control": /\.json$/.test(url.pathname)
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      },
    })
  },
})
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
})
try {
  const page = await browser.newPage()
  page.on("console", (message) => console.log("browser:", message.text()))
  page.on("pageerror", (error) => console.log("browser error:", error.message))
  await page.goto(`http://localhost:${server.port}`)
  const results = await page.evaluate(
    async (options) => {
      const percentile = (values, p) =>
        [...values].sort((a, b) => a - b)[
          Math.min(values.length - 1, Math.floor(values.length * p))
        ] ?? 0
      const results = []
      for (let run = 0; run < options.runs; run++) {
        const worker = new Worker("/worker.js", { type: "module" })
        const began = performance.now()
        const longTasks = []
        const observer = new PerformanceObserver((list) =>
          longTasks.push(...list.getEntries().map((entry) => entry.duration))
        )
        observer.observe({ type: "longtask", buffered: false })
        const heartbeat = []
        let tick = performance.now()
        const interval = setInterval(() => {
          const now = performance.now()
          heartbeat.push(now - tick)
          tick = now
        }, 16)
        let next = 1
        const pending = new Map()
        const diagnostics = []
        let ready, fail
        const boot = new Promise((resolve, reject) => {
          ready = resolve
          fail = reject
        })
        const failed = (error) => {
          fail(error)
          for (const request of pending.values())
            request({ error: { message: error.message } })
          pending.clear()
        }
        worker.onerror = (event) => failed(new Error(event.message))
        let metrics
        worker.onmessage = ({ data }) => {
          if (data.type === "error") {
            failed(new Error(data.error))
            return
          }
          if (data.type === "ready") {
            ready(data)
            return
          }
          if (data.type === "metrics") {
            metrics = data
            return
          }
          if (data.type === "read") {
            pending.get(data.id)?.(data)
            return
          }
          const m = data.message
          if (!m) return
          if (m.method === "textDocument/publishDiagnostics")
            diagnostics.push(m.params)
          if (m.method && m.id !== undefined)
            worker.postMessage({
              type: "messages",
              messages: [{ jsonrpc: "2.0", id: m.id, result: null }],
            })
          else if (m.id !== undefined) pending.get(m.id)?.(m)
        }
        const request = (send, description = "definition read") => {
          const id = next++
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () =>
                reject(new Error(`Language request timed out: ${description}`)),
              120000
            )
            pending.set(id, (m) => {
              clearTimeout(timeout)
              pending.delete(id)
              m.error
                ? reject(new Error(JSON.stringify(m.error)))
                : resolve(m.result)
            })
            send(id)
          })
        }
        const call = (method, params) =>
          request(
            (id) =>
              worker.postMessage({
                type: "messages",
                messages: [{ jsonrpc: "2.0", id, method, params }],
              }),
            method
          )
        const notify = (method, params) =>
          worker.postMessage({
            type: "messages",
            messages: [{ jsonrpc: "2.0", method, params }],
          })
        const pros =
          options.template === "pros" || options.template === "ez-template"
        const includes =
          options.template === "ez-template"
            ? '#include "api.h"\n#include "EZ-Template/api.hpp"'
            : pros
              ? '#include "api.h"'
              : '#include "v5.h"\n#include "v5_vcs.h"'
        const code =
          includes +
          (pros
            ? "\nvoid probe() { pros::Motor motor(1); motor. }\n// π 🤖\n"
            : "\nvoid probe() { vex::motor motor(1); motor. }\n// π 🤖\n")
        const uri = "file:///workspace/src/main.cpp"
        worker.postMessage({
          type: "start",
          debug: true,
          template: options.template,
          files: { "src/main.cpp": new TextEncoder().encode(code) },
          initialMemory: options.memory,
          runtime: options.runtime,
          threads: options.threads,
        })
        const startup = await boot
        await call("initialize", {
          processId: null,
          rootUri: "file:///workspace",
          capabilities: {
            general: { positionEncodings: ["utf-16"] },
            textDocument: {
              completion: { completionItem: { snippetSupport: true } },
              hover: { contentFormat: ["markdown"] },
            },
          },
        })
        notify("initialized", {})
        notify("textDocument/didOpen", {
          textDocument: { uri, languageId: "cpp", version: 1, text: code },
        })
        const line = includes.split("\n").length
        const position = {
          line,
          character: code.split("\n")[line].indexOf("motor.") + 6,
        }
        let version = 1
        const completion = (at) =>
          call("textDocument/completion", {
            textDocument: { uri },
            position: at,
            context: { triggerKind: 1 },
          })
        const completionLabels = (response) =>
          (Array.isArray(response) ? response : (response?.items ?? [])).map(
            (item) => item.label
          )
        const hasMotorMembers = (labels) =>
          labels.some((label) => /move|spin/.test(label))
        const first = performance.now()
        const initialLabels = completionLabels(await completion(position))
        if (!hasMotorMembers(initialLabels))
          throw new Error(
            `First completion has no SDK motor members: ${initialLabels.slice(0, 15)}`
          )
        const firstCompletionMs = performance.now() - first
        const timeToFirstCompletionMs = performance.now() - began
        const timings = []
        let labels = []
        for (let i = 0; i < 30; i++) {
          const start = performance.now()
          notify("textDocument/didChange", {
            textDocument: { uri, version: ++version },
            wantDiagnostics: options.diagnostics ? undefined : false,
            contentChanges: [
              {
                range: { start: position, end: position },
                text: pros ? "m" : "s",
              },
            ],
          })
          const end = { ...position, character: position.character + 1 }
          const response = await completion(end)
          timings.push(performance.now() - start)
          labels = completionLabels(response)
          notify("textDocument/didChange", {
            textDocument: { uri, version: ++version },
            wantDiagnostics: options.diagnostics ? undefined : false,
            contentChanges: [{ range: { start: position, end }, text: "" }],
          })
        }
        if (!hasMotorMembers(labels))
          throw new Error(
            `SDK completion failed: ${labels.slice(0, 15)}; diagnostics: ${JSON.stringify(diagnostics)}`
          )
        const symbol = {
          line,
          character:
            code.split("\n")[line].indexOf(pros ? "Motor" : "motor") + 1,
        }
        const hover = await call("textDocument/hover", {
          textDocument: { uri },
          position: symbol,
        })
        if (!hover?.contents) throw new Error("SDK hover is missing")
        const definitions = await call("textDocument/definition", {
          textDocument: { uri },
          position: symbol,
        })
        const location = Array.isArray(definitions)
          ? definitions[0]
          : definitions
        const definitionUri = location?.uri || location?.targetUri
        if (!definitionUri) throw new Error("SDK definition is missing")
        const definition = await request((id) =>
          worker.postMessage({ type: "read", id, uri: definitionUri })
        )
        if (!definition?.contents.includes(pros ? "Motor" : "motor"))
          throw new Error("SDK definition read failed")
        const formatting = await call("textDocument/formatting", {
          textDocument: { uri },
          options: { tabSize: 2, insertSpaces: true },
        })
        if (!Array.isArray(formatting)) throw new Error("Formatting failed")
        const headerErrors = diagnostics
          .flatMap((message) => message.diagnostics)
          .filter((d) =>
            /file_not_found|unknown_typename|undeclared_var_use/.test(
              String(d.code)
            )
          )
        if (headerErrors.length)
          throw new Error(
            `SDK diagnostics failed: ${JSON.stringify(headerErrors)}`
          )
        if (options.multifile) {
          // Exercise dynamic pthread growth when several documents are open.
          const extraCode =
            "struct Extra { int member; }; void probe() { Extra value; value. }\n"
          const extraUris = [0, 1, 2, 3].map(
            (index) => `file:///workspace/src/extra-${index}.cpp`
          )
          for (const extraUri of extraUris)
            notify("textDocument/didOpen", {
              textDocument: {
                uri: extraUri,
                languageId: "cpp",
                version: 1,
                text: extraCode,
              },
            })
          await Promise.all(
            extraUris.map(async (extraUri) => {
              const response = await call("textDocument/completion", {
                textDocument: { uri: extraUri },
                position: {
                  line: 0,
                  character: extraCode.indexOf("value.") + 6,
                },
              })
              if (
                !completionLabels(response).some((label) =>
                  /member/.test(label)
                )
              )
                throw new Error("Multi-file completion failed")
            })
          )
          for (const extraUri of extraUris)
            notify("textDocument/didClose", { textDocument: { uri: extraUri } })
        }
        worker.postMessage({ type: "metrics" })
        await new Promise((resolve) => setTimeout(resolve, 100))
        worker.terminate()
        clearInterval(interval)
        observer.disconnect()
        results.push({
          ...startup,
          type: undefined,
          totalMs: performance.now() - began,
          firstCompletionMs,
          timeToFirstCompletionMs,
          editP50Ms: percentile(timings, 0.5),
          editP95Ms: percentile(timings, 0.95),
          heapBytes: metrics?.heapBytes,
          firstCompletionCount: initialLabels.length,
          completionCount: labels.length,
          mainThreadLongTasks: longTasks,
          heartbeatP95Ms: percentile(heartbeat, 0.95),
          definitionPath: definition.path,
        })
      }
      return results
    },
    {
      memory: process.env.INITIAL_MEMORY_MB
        ? Number(process.env.INITIAL_MEMORY_MB) * 1024 * 1024
        : undefined,
      runtime: process.env.LANGUAGE_RUNTIME,
      threads: Number(process.env.LANGUAGE_THREADS || 8),
      template: process.env.LANGUAGE_TEMPLATE || "pros",
      runs: Number(process.env.BENCHMARK_RUNS || 2),
      diagnostics: process.env.BENCHMARK_DIAGNOSTICS === "1",
      multifile: process.env.BENCHMARK_MULTIFILE === "1",
    }
  )
  if (
    requests.some(
      (path) =>
        path.startsWith("/language/") && !/\.(json|js|zip|wasm)$/.test(path)
    )
  )
    throw new Error("Unexpected language service network request")
  // Opt in only inside a dedicated cgroup: a desktop session's peak includes
  // unrelated applications. This includes Chromium processes and this harness.
  let processGroupPeakBytes
  if (process.env.BENCHMARK_CGROUP === "1") {
    const membership = await readFile("/proc/self/cgroup", "utf8")
    const path = membership
      .split("\n")
      .find((line) => line.startsWith("0::"))
      ?.slice(3)
    if (!path) throw new Error("A cgroup v2 process group is required")
    processGroupPeakBytes = Number(
      await readFile(
        resolve("/sys/fs/cgroup", "." + path, "memory.peak"),
        "utf8"
      )
    )
  }
  const runtimeManifest = JSON.parse(
    await readFile(resolve(assets, "runtime.json"), "utf8")
  )
  const report = {
    timestamp: new Date().toISOString(),
    environment: process.env.BENCHMARK_ENVIRONMENT || "unconstrained desktop",
    template: process.env.LANGUAGE_TEMPLATE || "pros",
    processGroupPeakBytes,
    runtimeArtifact: runtimeManifest[results[0]?.runtime],
    workerSha256: createHash("sha256")
      .update(new Uint8Array(await workerBundle.arrayBuffer()))
      .digest("hex"),
    threads: Number(process.env.LANGUAGE_THREADS || 8),
    diagnosticsOnEdit:
      process.env.BENCHMARK_DIAGNOSTICS === "1" ? "automatic" : "disabled",
    multifile: process.env.BENCHMARK_MULTIFILE === "1",
    results,
  }
  console.log(JSON.stringify(report, null, 2))
  if (process.env.BENCHMARK_OUTPUT)
    await writeFile(
      process.env.BENCHMARK_OUTPUT,
      JSON.stringify(report, null, 2) + "\n"
    )
} finally {
  await browser.close()
  server.stop(true)
}
