// Starts a Cloudflare quick tunnel to the Metro port, then runs `expo start --go`
// with the tunnel's hostname as the packager proxy URL. Expo Go on a phone that is
// not on this machine's network can then load the bundle over HTTPS.
//
// Quick tunnels get a new random *.trycloudflare.com hostname on every run.
// Requires `cloudflared` on PATH.

import { spawn } from "node:child_process"

const port = Number(process.env.PORT ?? 8081)
const tunnelUrlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
const tunnelStartTimeoutMs = 60_000

const tunnel = spawn(
  "cloudflared",
  ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`],
  { stdio: ["ignore", "pipe", "pipe"] }
)

function waitForTunnelUrl(child) {
  return new Promise((resolve, reject) => {
    let output = ""
    const onData = (chunk) => {
      output += chunk
      const match = output.match(tunnelUrlPattern)
      if (match) finish(() => resolve(match[0]))
    }
    const onExit = (code) =>
      finish(() =>
        reject(new Error(`cloudflared exited (code ${code}) before publishing a URL`))
      )
    const onError = (error) => finish(() => reject(error))
    const timer = setTimeout(
      () => finish(() => reject(new Error("timed out waiting for the tunnel URL"))),
      tunnelStartTimeoutMs
    )

    function finish(settle) {
      clearTimeout(timer)
      child.stdout.off("data", onData)
      child.stderr.off("data", onData)
      child.off("exit", onExit)
      child.off("error", onError)
      // Keep draining cloudflared's output so its log pipe never fills up.
      child.stdout.resume()
      child.stderr.resume()
      settle()
    }

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.on("exit", onExit)
    child.on("error", onError)
  })
}

let expo = null
let shuttingDown = false

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  tunnel.kill()
  expo?.kill()
  process.exitCode = code
}

process.on("SIGINT", () => shutdown(130))
process.on("SIGTERM", () => shutdown(143))

let url
try {
  url = await waitForTunnelUrl(tunnel)
} catch (error) {
  console.error(`dev-tunnel: ${error.message}`)
  shutdown(1)
}

if (url) {
  const host = new URL(url).host
  console.log(`\ndev-tunnel: Metro is reachable at ${url}`)
  console.log(`dev-tunnel: In Expo Go, open exps://${host} (or scan the QR code below)\n`)

  expo = spawn("expo", ["start", "--go", "--port", String(port)], {
    stdio: "inherit",
    env: { ...process.env, EXPO_PACKAGER_PROXY_URL: url },
  })
  expo.on("exit", (code) => shutdown(code ?? 0))
  expo.on("error", (error) => {
    console.error(`dev-tunnel: could not start expo: ${error.message}`)
    shutdown(1)
  })
  tunnel.on("exit", (code) => {
    console.error(`dev-tunnel: cloudflared exited (code ${code})`)
    shutdown(code ?? 1)
  })
}
