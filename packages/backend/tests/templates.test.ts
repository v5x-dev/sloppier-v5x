import { afterEach, expect, test, vi } from "vitest"
import { strToU8, zipSync } from "fflate"
import { EZ_PROS_VERSION, loadTemplateFiles } from "../convex/lib/templates"

afterEach(() => vi.unstubAllGlobals())

test("EZ starter upgrades managed SDKs while preserving robot source", async () => {
  const manifest = {
    "py/state": {
      project_name: "old",
      templates: Object.fromEntries(
        ["kernel", "liblvgl", "okapilib", "EZ-Template"].map((name) => [
          name,
          { version: "old", location: "old" },
        ])
      ),
    },
  }
  const archive = (files: Record<string, string>) =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([path, value]) => [path, strToU8(value)])
      )
    )
  const sdk = (files: Record<string, string>) =>
    archive({
      ...files,
      "template.pros": JSON.stringify({
        "py/state": {
          system_files: Object.keys(files),
          supported_kernels: ">=4.2.0",
        },
      }),
    })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const contents = url.includes("RW-Template-PROS.zip")
        ? archive({
            "template.pros": JSON.stringify({
              "py/state": { name: "RW-Template", version: "4.1.0" },
            }),
            "src/rw-config.cpp": "robot configuration",
            "include/rw/api.h": "RW API",
            "firmware/RW-Template.a": "RW library",
          })
        : url.includes("kernel@")
          ? sdk({
              "include/api.h": `#define PROS_VERSION_STRING "${EZ_PROS_VERSION}"`,
              "include/pros/ai_vision.hpp": "class AIVision {};",
              "common.mk": "-mfloat-abi=hard",
            })
          : url.includes("liblvgl@")
            ? sdk({ "include/liblvgl/lvgl.h": "new LVGL" })
            : url.includes("OkapiLib")
              ? archive({ "repo/include/okapi/api.hpp": "new Okapi" })
              : archive({
                  "project.pros": JSON.stringify(manifest),
                  "include/pros/obsolete.h": "old",
                  "include/liblvgl/obsolete.h": "old",
                  "src/main.cpp": "robot source",
                  "include/main.h": "robot header",
                  Makefile: "robot rules",
                })
      return new Response(contents)
    })
  )
  const files = await loadTemplateFiles("ez-template", "My robot")
  const text = (path: string) => {
    const value = files.find((file) => file.path === path)?.contents
    return typeof value === "string" ? value : new TextDecoder().decode(value)
  }
  expect(text("include/pros/ai_vision.hpp")).toContain("AIVision")
  expect(text("common.mk")).toContain("-mfloat-abi=hard")
  expect(files.some((file) => file.path.endsWith("obsolete.h"))).toBe(false)
  expect(text("src/main.cpp")).toBe("robot source")
  expect(text("include/main.h")).toBe("robot header")
  expect(text("Makefile")).toBe("robot rules")
  const state = JSON.parse(text("project.pros"))["py/state"]
  expect(state.project_name).toBe("my-robot")
  expect(state.templates.kernel.version).toBe(EZ_PROS_VERSION)
  expect(state.templates.kernel.system_files).toContain(
    "include/pros/ai_vision.hpp"
  )
  expect(state.templates.liblvgl.version).toBe("8.3.9")
})

test("RW starter combines the PROS kernel and RW user files", async () => {
  const zip = (files: Record<string, string>) =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([path, value]) => [path, strToU8(value)])
      )
    )
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("RW-Template-PROS.zip"))
        return new Response(
          zip({
            "template.pros": JSON.stringify({
              "py/state": { name: "RW-Template", version: "4.1.0" },
            }),
            "src/rw-config.cpp": "robot configuration",
            "include/rw/api.h": "RW API",
            "firmware/RW-Template.a": "RW library",
          })
        )
      if (url.includes("kernel@") || url.includes("liblvgl@"))
        return new Response(
          zip({
            "template.pros": JSON.stringify({
              "py/state": { system_files: [], supported_kernels: ">=4.2.0" },
            }),
          })
        )
      if (url.includes("OkapiLib")) return new Response(zip({}))
      return new Response(
        zip({
          "project.pros": JSON.stringify({
            "py/state": {
              project_name: "old",
              templates: Object.fromEntries(
                ["kernel", "liblvgl", "okapilib", "EZ-Template"].map((name) => [
                  name,
                  { version: "old", location: "old" },
                ])
              ),
            },
          }),
          "common.mk": "rules",
          "include/main.h": "old header",
          "src/main.cpp": "old main",
          "src/autons.cpp": "EZ source",
        })
      )
    })
  )
  const files = await loadTemplateFiles("rw", "My robot")
  const file = (path: string) =>
    files.find((item) => item.path === path)?.contents
  expect(file("src/rw-config.cpp")).toBeDefined()
  expect(file("firmware/RW-Template.a")).toBeDefined()
  expect(file("src/main.cpp")).toContain("runAutonomous()")
  expect(file("src/autons.cpp")).toBeUndefined()
  const state = JSON.parse(file("project.pros") as string)["py/state"]
  expect(state.project_name).toBe("my-robot")
  expect(state.templates["RW-Template"].version).toBe("4.1.0")
  expect(state.templates["EZ-Template"]).toBeUndefined()
})
