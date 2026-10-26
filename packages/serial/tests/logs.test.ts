import { describe, expect, it } from "vitest"
import { logRead, logStatus, ProtocolError } from "../src"

describe("brain event log packets", () => {
  it("decodes upstream status count and event field layout", () => {
    expect(
      logStatus().decode(Uint8Array.of(0, 2, 0, 0, 0, ...new Array(12).fill(0)))
    ).toEqual({ count: 2 })
    const command = logRead(20, 20)
    expect(command.ecmd).toBe(0x25)
    expect(
      command.decode(
        Uint8Array.of(8, 20, 0, 0, 0, 1, 0, 7, 8, 9, 0, 0xe8, 3, 0, 0)
      )
    ).toEqual({
      offset: 20,
      entries: [{ code: 7, type: 8, description: 9, spare: 0, time: 1000 }],
    })
  })
  it("rejects malformed or truncated log replies and invalid requests", () => {
    expect(() => logRead(-1, 20)).toThrow(RangeError)
    expect(() =>
      logRead(0, 1).decode(Uint8Array.of(8, 0, 0, 0, 0, 1, 0))
    ).toThrow(ProtocolError)
    expect(() =>
      logRead(0, 1).decode(Uint8Array.of(9, 0, 0, 0, 0, 0, 0))
    ).toThrow(ProtocolError)
    expect(
      logRead(0, 0).decode(Uint8Array.of(8, 0, 0, 0, 0, 0, 0)).entries
    ).toEqual([])
  })
})
