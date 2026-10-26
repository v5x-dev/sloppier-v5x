export type RpcMessage = {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { message: string }
}

/** Parse LSP's byte-counted framing without rescanning or shifting buffers. */
export class LspOutput {
  private header = ""
  private body: Uint8Array | null = null
  private offset = 0
  private decoder = new TextDecoder()

  constructor(private receive: (message: RpcMessage) => void) {}

  push(byte: number) {
    if (this.body) {
      this.body[this.offset++] = byte
      if (this.offset === this.body.length) {
        const body = this.body
        this.body = null
        this.offset = 0
        this.receive(JSON.parse(this.decoder.decode(body)))
      }
      return
    }
    this.header += String.fromCharCode(byte)
    if (this.header.length > 8192) throw new Error("Invalid LSP header")
    if (!this.header.endsWith("\r\n\r\n")) return
    const length = /^Content-Length: (\d+)\r\n/im.exec(this.header)?.[1]
    this.header = ""
    if (!length || +length < 1 || +length > 32 * 1024 * 1024)
      throw new Error("Invalid LSP message length")
    this.body = new Uint8Array(+length)
  }
}

export function encodeMessage(message: RpcMessage) {
  const body = new TextEncoder().encode(JSON.stringify(message))
  const header = new TextEncoder().encode(
    `Content-Length: ${body.length}\r\n\r\n`
  )
  const bytes = new Uint8Array(header.length + body.length)
  bytes.set(header)
  bytes.set(body, header.length)
  return bytes
}

/** Decode before normalizing so encoded slashes cannot bypass the SDK roots. */
export function definitionPath(uri: string) {
  const url = new URL(uri)
  if (url.protocol !== "file:" || url.host || url.search || url.hash)
    throw new Error("Invalid definition URI")
  const parts: string[] = []
  for (const part of decodeURIComponent(url.pathname).split("/")) {
    if (part === "..") parts.pop()
    else if (part && part !== ".") parts.push(part)
  }
  const path = "/" + parts.join("/")
  if (
    !["/workspace/", "/usr/include/", "/opt/vex/sdk/"].some((prefix) =>
      path.startsWith(prefix)
    )
  )
    throw new Error("Definition is outside the program and SDK directories")
  return path
}
