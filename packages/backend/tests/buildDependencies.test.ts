import { expect, test } from "vitest"
import { isBuildDependency } from "../convex/lib/buildDependencies"

test("PROS uploads keep user code and exclude the preinstalled kernel", () => {
  for (const path of [
    "firmware/libpros.a",
    "include/pros/motors.hpp",
    "include/api.h",
    "common.mk",
  ])
    expect(isBuildDependency("pros", path)).toBe(true)
  for (const path of [
    "src/main.cpp",
    "include/main.h",
    "include/subsystems.hpp",
    "Makefile",
    "project.pros",
    "include/pros-custom.h",
  ])
    expect(isBuildDependency("pros", path)).toBe(false)
})

test("EZ uploads exclude SDKs and libraries while retaining editable robot headers", () => {
  for (const path of [
    "firmware/okapilib.a",
    "include/EZ-Template/drive/drive.hpp",
    "include/okapi/api.hpp",
    "include/liblvgl/lvgl.h",
  ])
    expect(isBuildDependency("ez-template", path)).toBe(true)
  for (const path of [
    "src/autons.cpp",
    "include/autons.hpp",
    "include/subsystems.hpp",
    "include/main.h",
  ])
    expect(isBuildDependency("ez-template", path)).toBe(false)
  expect(isBuildDependency("jar", "include/api.h")).toBe(false)
  expect(isBuildDependency("vexcode", "firmware/custom.a")).toBe(false)
})

test("RW keeps robot configuration while managing its PROS and RW libraries", () => {
  for (const path of [
    "firmware/RW-Template.a",
    "include/rw/api.h",
    "include/pros/motors.hpp",
    "common.mk",
  ])
    expect(isBuildDependency("rw", path)).toBe(true)
  for (const path of [
    "include/rw-config.h",
    "src/rw-config.cpp",
    "src/rw-autons.cpp",
  ])
    expect(isBuildDependency("rw", path)).toBe(false)
})
