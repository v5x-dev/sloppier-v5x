import { afterEach, expect, test, vi } from "vitest"
import { readAutonRoute, writeAutonRoute } from "../src/lib/editor-persistence"

afterEach(() => vi.unstubAllGlobals())

test("selected routes persist independently for each Program", () => {
  const storage = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })

  writeAutonRoute("one", "src/autons.cpp:skills")
  writeAutonRoute("two", "src/autons.cpp:match")
  expect(readAutonRoute("one")).toBe("src/autons.cpp:skills")
  expect(readAutonRoute("two")).toBe("src/autons.cpp:match")
  expect(readAutonRoute("three")).toBe("")
  storage.set("v5x:editor:one:auton-route", "null")
  expect(readAutonRoute("one")).toBe("")
})

test("unavailable storage leaves route selection usable", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("unavailable")
    },
    setItem: () => {
      throw new Error("unavailable")
    },
  })
  expect(() => writeAutonRoute("one", "route")).not.toThrow()
  expect(readAutonRoute("one")).toBe("")
})
