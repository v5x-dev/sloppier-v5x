import { zipSync } from "fflate"
import { readBuildBinaries } from "./build-binaries"
import { selectUploadProgram } from "./upload-binaries"

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
}

/** Upload a source snapshot in chunks that fit the cloud request limit. */
export async function uploadSource(
  request: BuildRequest,
  source: BuildSource,
  signal?: AbortSignal
) {
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

function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, 500)
    signal.addEventListener("abort", abort, { once: true })
  })
}
/** Let the last keystroke reach collaboration before creating the upload commit. */
export async function waitForSourceSync(
  isSynced: () => boolean,
  signal: AbortSignal
) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  while (!isSynced()) await delay(deadline)
  deadline.throwIfAborted()
}

const matches = (status: BuildStatus, sha: string) =>
  !status.building &&
  !!status.artifactId &&
  status.logs.startsWith(`Building commit ${sha}\n`) &&
  status.logs.trimEnd().endsWith("Build succeeded.")

/** Never fall back to a previous successful artifact after this build fails. */
export async function prepareUploadBuild(options: {
  commitChanges: (signal: AbortSignal) => Promise<void>
  prepareSource: () => Promise<BuildSource>
  request: BuildRequest
  signal: AbortSignal
  onStage: (message: string) => void
}) {
  const { request, onStage } = options
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(300_000)])
  signal.throwIfAborted()
  onStage("Checking and committing changes…")
  await options.commitChanges(signal)
  signal.throwIfAborted()
  onStage("Preparing source…")
  const source = await options.prepareSource()
  const status = async () => {
    signal.throwIfAborted()
    return (await (
      await request("/status", undefined, signal)
    ).json()) as BuildStatus
  }
  let current = await status()
  while (current.building) {
    onStage("Waiting for the current build…")
    await delay(signal)
    current = await status()
  }
  if (!matches(current, source.sha)) {
    onStage("Building program…")
    const previousArtifact = current.artifactId
    await submitBuild(request, source, signal)
    current = await status()
    while (current.building) {
      await delay(signal)
      current = await status()
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
  const response = await request("/artifact", undefined, signal)
  const files = readBuildBinaries(new Uint8Array(await response.arrayBuffer()))
  current = await status()
  if (current.artifactId !== artifactId || !matches(current, source.sha))
    throw new Error("The build changed while downloading. Try uploading again.")
  signal.throwIfAborted()
  return selectUploadProgram(files)
}
