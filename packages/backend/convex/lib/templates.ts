import { unzipSync } from "fflate"
import type { ProgramTemplate } from "./templateCatalog"

export type TemplateFile = {
  path: string
  contents: string | Uint8Array
}

const JAR_REVISION = "0e8c9ce388fe9fd6bb40ea05c36d9eb71ea2df88"
const EZ_TEMPLATE_REVISION = "2733127f518bcf57558c45390bd9eb59a961ef19"
const EZ_TEMPLATE_ARCHIVE = `https://raw.githubusercontent.com/EZ-Robotics/EZ-Template/${EZ_TEMPLATE_REVISION}/EZ-Template-Example-Project.zip`

const jarFiles = [
  "JAR-Template.v5code",
  "makefile",
  "vex/mkenv.mk",
  "vex/mkrules.mk",
  "include/vex.h",
  "include/robot-config.h",
  "include/autons.h",
  "include/JAR-Template/PID.h",
  "include/JAR-Template/drive.h",
  "include/JAR-Template/odom.h",
  "include/JAR-Template/util.h",
  "src/main.cpp",
  "src/robot-config.cpp",
  "src/autons.cpp",
  "src/JAR-Template/PID.cpp",
  "src/JAR-Template/drive.cpp",
  "src/JAR-Template/odom.cpp",
  "src/JAR-Template/util.cpp",
] as const

export async function loadTemplateFiles(
  template: ProgramTemplate,
  programName: string
): Promise<TemplateFile[]> {
  switch (template) {
    case "vexcode":
      return vexcodeFiles(programName)
    case "jar":
      return loadJarFiles()
    case "pros":
      return loadProsFiles(programName)
    case "ez-template":
      return loadEzTemplateFiles(programName)
  }
}

function vexcodeFiles(programName: string): TemplateFile[] {
  return [
    {
      path: "README.md",
      contents: `# ${programName}\n\nVEXcode V5 C++ program. The working source tree follows the VEX VS Code Extension layout.\n`,
    },
    {
      path: "include/vex.h",
      contents: `#pragma once\n\n#include "v5.h"\n#include "v5_vcs.h"\n#include "robot-config.h"\n`,
    },
    {
      path: "include/robot-config.h",
      contents: `#pragma once\n\n#include "v5.h"\n\nextern vex::brain Brain;\n`,
    },
    {
      path: "src/robot-config.cpp",
      contents: `#include "vex.h"\n\nvex::brain Brain;\n`,
    },
    {
      path: "src/main.cpp",
      contents: `#include "vex.h"\n\nusing namespace vex;\n\ncompetition Competition;\n\nvoid autonomous() {}\nvoid usercontrol() {\n  while (true) {\n    wait(20, msec);\n  }\n}\n\nint main() {\n  Competition.autonomous(autonomous);\n  Competition.drivercontrol(usercontrol);\n  while (true) {\n    wait(100, msec);\n  }\n}\n`,
    },
  ]
}

async function loadJarFiles(): Promise<TemplateFile[]> {
  const files = await Promise.all(
    jarFiles.map(async (path) => ({
      path,
      contents: await fetchRawFile(
        `https://raw.githubusercontent.com/JacksonAreaRobotics/JAR-Template/${JAR_REVISION}/${path}`
      ),
    }))
  )
  return files.map(({ path, contents }) => ({ path, contents }))
}

async function loadProsFiles(programName: string): Promise<TemplateFile[]> {
  const archiveFiles = await fetchExampleProjectArchive()
  const files: TemplateFile[] = []

  for (const [path, contents] of Object.entries(archiveFiles)) {
    if (!isProsKernelFile(path)) continue
    if (path === "project.pros") {
      files.push({
        path,
        contents: makeProsProjectManifest(contents, programName),
      })
    } else if (path === "src/main.cpp") {
      files.push({ path, contents: prosMain(programName) })
    } else if (path === "include/main.h") {
      files.push({ path, contents: prosMainHeader() })
    } else {
      files.push({ path, contents })
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function loadEzTemplateFiles(
  programName: string
): Promise<TemplateFile[]> {
  const archiveFiles = await fetchExampleProjectArchive()
  const files: TemplateFile[] = []

  for (const [path, contents] of Object.entries(archiveFiles)) {
    if (path === "EZ-Template@3.2.2.zip" || path === "compile_commands.json") {
      continue
    }
    if (path === "project.pros") {
      files.push({
        path,
        contents: makeEzProjectManifest(contents, programName),
      })
    } else {
      files.push({ path, contents })
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function fetchExampleProjectArchive() {
  const response = await fetch(EZ_TEMPLATE_ARCHIVE)
  if (!response.ok) {
    throw new Error(
      `Could not download the pinned EZ-Template starter (${response.status}).`
    )
  }
  const archive = new Uint8Array(await response.arrayBuffer())
  const files = unzipSync(archive)

  return Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => path !== "" && !path.endsWith("/"))
      .map(([path, contents]) => [path.replace(/^\/+/, ""), contents])
  ) as Record<string, Uint8Array>
}

function isProsKernelFile(path: string) {
  return (
    path === ".gitignore" ||
    path === "common.mk" ||
    path === "Makefile" ||
    path === "project.pros" ||
    path === "include/api.h" ||
    path === "include/main.h" ||
    path === "src/main.cpp" ||
    path.startsWith("include/pros/") ||
    path === "firmware/libc.a" ||
    path === "firmware/libm.a" ||
    path === "firmware/libpros.a" ||
    path === "firmware/v5.ld" ||
    path === "firmware/v5-common.ld" ||
    path === "firmware/v5-hot.ld"
  )
}

function makeProsProjectManifest(contents: Uint8Array, programName: string) {
  const manifest = JSON.parse(new TextDecoder().decode(contents)) as {
    "py/state": {
      project_name: string
      templates: Record<string, Record<string, unknown>>
    }
  }
  const state = manifest["py/state"]
  state.project_name = toProjectSlug(programName)

  const kernel = state.templates.kernel
  if (kernel) {
    kernel.location = "kernel@4.1.1"
    state.templates = { kernel }
  }

  return JSON.stringify(manifest, null, 2) + "\n"
}

function makeEzProjectManifest(contents: Uint8Array, programName: string) {
  const manifest = JSON.parse(new TextDecoder().decode(contents)) as {
    "py/state": {
      project_name: string
      templates: Record<string, { location?: string }>
    }
  }
  const state = manifest["py/state"]
  state.project_name = toProjectSlug(programName)
  for (const template of Object.values(state.templates)) {
    if (template.location) {
      template.location =
        template.location.split(/[\\/]/).pop() ?? template.location
    }
  }

  return JSON.stringify(manifest, null, 2) + "\n"
}

function prosMain(programName: string) {
  return `#include "main.h"\n\nvoid initialize() { pros::lcd::initialize(); }\nvoid disabled() {}\nvoid competition_initialize() {}\nvoid autonomous() {}\nvoid opcontrol() {\n  while (true) {\n    pros::delay(20);\n  }\n}\n\n// ${programName}\n`
}

function prosMainHeader() {
  return `#ifndef _PROS_MAIN_H_\n#define _PROS_MAIN_H_\n\n#include "api.h"\n\n#ifdef __cplusplus\nextern "C" {\n#endif\nvoid initialize(void);\nvoid disabled(void);\nvoid competition_initialize(void);\nvoid autonomous(void);\nvoid opcontrol(void);\n#ifdef __cplusplus\n}\n#endif\n\n#endif\n`
}

async function fetchRawFile(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Could not download a pinned starter file (${response.status}).`
    )
  }
  return new Uint8Array(await response.arrayBuffer())
}

function toProjectSlug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "vex-program"
  )
}
