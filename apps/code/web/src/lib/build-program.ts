import type { ArtifactEntries } from "./build-binaries"
import { sourceHash } from "./build-source"
import { selectUploadProgram } from "./upload-binaries"

/** Builder status cadence during a build. Short enough that a finished build is picked up almost at once. */
const BUILD_POLL_MS = 25

export type BuildSource = { sha: string; files: Record<string, Uint8Array> }
export type BuildRequest = (
  path: string,
  body?: unknown,
  signal?: AbortSignal
) => Promise<Response>
export type BuildStatus = {
  logs: string
  building: boolean
  startedAt?: number | null
  artifactId: string | null
  /** Changes whenever the status does; a long poll with `since` returns on the next change. */
  version?: number
  /** Set for builds started speculatively; they never write diagnostics or replace a normal build. */
  speculative?: boolean
  /** Hash of the source the last build extracted; matches the client's sourceHash. */
  sourceHash?: string | null
  /** Digest and size of each binary in the current artifact. Absent from Builders that predate it. */
  artifactEntries?: ArtifactEntries | null
}

/** Upload a source snapshot in chunks that fit the cloud request limit. */
export async function uploadSource(
  request: BuildRequest,
  source: BuildSource,
  signal?: AbortSignal
) {
  const { zipSync } = await import("fflate")
  const snapshot = zipSync(source.files)
  const id = crypto.randomUUID()
  for (let offset = 0; offset < snapshot.length; offset += 512 * 1024) {
    signal?.throwIfAborted()
    let text = ""
    for (const byte of snapshot.subarray(offset, offset + 512 * 1024))
      text += String.fromCharCode(byte)
    await request("/upload", { id, offset, data: btoa(text) }, signal)
  }
  return id
}

export async function submitBuild(
  request: BuildRequest,
  source: BuildSource,
  signal?: AbortSignal
) {
  const id = await uploadSource(request, source, signal)
  await request("/build", { id, commit: source.sha }, signal)
}

function delay(signal: AbortSignal, ms = 500) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)
    signal.addEventListener("abort", abort, { once: true })
  })
}
/**
 * Waits for a change to the source's state, or for `ms` to pass, whichever comes first.
 * Live sync reports through the source's subscription, so the wait wakes when a sync finishes.
 */
function nextChange(
  subscribe: ((listener: () => void) => () => void) | undefined,
  signal: AbortSignal,
  ms: number
) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    let unsubscribe = () => {}
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      unsubscribe()
      resolve()
    }
    const abort = () => {
      clearTimeout(timer)
      unsubscribe()
      reject(signal.reason)
    }
    const timer = setTimeout(finish, ms)
    unsubscribe = subscribe?.(finish) ?? (() => {})
    signal.addEventListener("abort", abort, { once: true })
  })
}

/**
 * Let the last keystroke reach collaboration before creating the upload commit. The check reads local sync
 * state, so it wakes on the source's own updates; the 250 ms timer is only a fallback for a missed update.
 */
export async function waitForSourceSync(
  isSynced: () => boolean,
  signal: AbortSignal,
  subscribe?: (listener: () => void) => () => void
) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  while (!isSynced()) await nextChange(subscribe, deadline, 250)
  deadline.throwIfAborted()
}

const matches = (status: BuildStatus, sha: string) =>
  !status.building &&
  !!status.artifactId &&
  status.logs.startsWith(`Building commit ${sha}\n`) &&
  status.logs.trimEnd().endsWith("Build succeeded.")

/** A finished build's artifact and the digests of its files, as the Builder reports them. */
export type ClaimedBuild = {
  artifactId: string
  entries: ArtifactEntries | null
}

/** Never fall back to a previous successful artifact after this build fails. */
export async function prepareUploadBuild(options: {
  commitChanges: (signal: AbortSignal) => Promise<void>
  prepareSource: () => Promise<BuildSource>
  request: BuildRequest
  signal: AbortSignal
  onStage: (message: string) => void
  isInstalled?: (sha: string) => Promise<boolean>
  /**
   * Returns the speculative build for this exact source hash, waiting for it if it is still building.
   * Resolves to null when no speculative build produced this source.
   */
  claimSpeculative?: (hash: string) => Promise<ClaimedBuild | null>
}) {
  const { request, onStage } = options
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(300_000)])
  signal.throwIfAborted()
  onStage("Checking and committing changes…")
  await options.commitChanges(signal)
  signal.throwIfAborted()
  onStage("Preparing source…")
  const source = await options.prepareSource()
  // The Brain check needs only the committed revision, so it runs while a speculative build finishes.
  const installed = options.isInstalled?.(source.sha)
  installed?.catch(() => {})
  onStage("Building program…")
  const claimed = options.claimSpeculative
    ? await options.claimSpeculative(await sourceHash(source.files))
    : null
  // A claimed artifact downloads while the Brain is checked. If the Brain already has this revision, the download is dropped.
  const download = new AbortController()
  const downloading = claimed
    ? import("./build-binaries").then(({ loadArtifactFiles }) =>
        loadArtifactFiles(
          request,
          claimed,
          AbortSignal.any([signal, download.signal])
        )
      )
    : null
  downloading?.catch(() => {})
  if (installed && (await installed)) {
    download.abort()
    return null
  }
  if (downloading) {
    // The Builder finished this exact source before Upload was pressed; only the download remains.
    onStage("Downloading build binaries…")
    const files = await downloading
    signal.throwIfAborted()
    return selectUploadProgram(files)
  }
  const status = async (since?: number) => {
    signal.throwIfAborted()
    const query = since === undefined ? "" : `?since=${since}&wait=5000`
    return (await (
      await request(`/status${query}`, undefined, signal)
    ).json()) as BuildStatus
  }
  // The next status after `previous`: a long poll when the Builder reports versions, else a short poll.
  const nextStatus = async (previous: BuildStatus) => {
    if (previous.version !== undefined) return status(previous.version)
    await delay(signal, BUILD_POLL_MS)
    return status()
  }
  let current = await status()
  // A speculative build yields to this one: the Builder cancels it when the build is submitted.
  while (current.building && !current.speculative) {
    onStage("Waiting for the current build…")
    current = await nextStatus(current)
  }
  if (!matches(current, source.sha)) {
    onStage("Building program…")
    const previousArtifact = current.artifactId
    await submitBuild(request, source, signal)
    current = await status()
    while (current.building) {
      current = await nextStatus(current)
    }
    if (
      !matches(current, source.sha) ||
      current.artifactId === previousArtifact
    )
      throw new Error(
        "Build failed or was replaced. Open Build logs for details and try uploading again."
      )
  }
  onStage("Downloading build binaries…")
  const artifactId = current.artifactId
  if (!artifactId) throw new Error("The build produced no binaries.")
  const { loadArtifactFiles } = await import("./build-binaries")
  const files = await loadArtifactFiles(
    request,
    { artifactId, entries: current.artifactEntries },
    signal
  )
  current = await status()
  if (current.artifactId !== artifactId || !matches(current, source.sha))
    throw new Error("The build changed while downloading. Try uploading again.")
  signal.throwIfAborted()
  return selectUploadProgram(files)
}
