import { afterEach, expect, test, vi } from "vitest"
import {
  readAutonDimension,
  readAutonRoute,
  writeAutonDimension,
  writeAutonRoute,
} from "../src/lib/editor-persistence"

afterEach(() => vi.unstubAllGlobals())

test("dimensions persist per Program and reject invalid stored values", () => {
  const storage = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  writeAutonDimension("one", "trackWidth", 14.25)
  writeAutonDimension("one", "robotWidth", 18)
  writeAutonDimension("one", "robotLength", 17)
  expect(readAutonDimension("one", "trackWidth")).toBe(14.25)
  expect(readAutonDimension("one", "robotWidth")).toBe(18)
  expect(readAutonDimension("one", "robotLength")).toBe(17)
  expect(readAutonDimension("two", "trackWidth")).toBe(12)
  storage.set("v5x:editor:one:auton-trackWidth", "99")
  expect(readAutonDimension("one", "trackWidth")).toBe(12)
})

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
