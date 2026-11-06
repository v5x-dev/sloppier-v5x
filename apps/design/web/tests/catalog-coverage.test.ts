// Every kind of Part a team needs must be in the Catalog. A kind with no Part fails the
// test unless it is listed in KNOWN_MISSING with the reason, and a listed kind that
// turns up in the catalog fails too, so the list cannot go stale.

import { describe, expect, it } from "vitest"
import { catalog } from "../src/catalog/catalog"
import type { CatalogPart } from "../src/catalog/types"

type Requirement = {
  kind: string
  match: (part: CatalogPart) => boolean
}

const named = (word: string) => (part: CatalogPart) =>
  part.name.toLowerCase().includes(word.toLowerCase())
const family = (f: string) => (part: CatalogPart) => part.family === f
const both =
  (...tests: Array<(part: CatalogPart) => boolean>) =>
  (part: CatalogPart) =>
    tests.every((test) => test(part))

const REQUIRED: Requirement[] = [
  // Structure
  { kind: "C-channels", match: both(family("channel"), named("C-Channel")) },
  { kind: "U-channels", match: both(family("channel"), named("U-Channel")) },
  { kind: "angles", match: family("angle") },
  { kind: "plates", match: family("plate") },
  { kind: "rails", match: family("rail") },
  { kind: "standoffs", match: family("standoff") },
  { kind: "screws", match: family("screw") },
  { kind: "nuts", match: family("nut") },
  { kind: "gussets", match: family("gusset") },
  // Motion
  {
    kind: "standard shafts",
    match: both(
      family("shaft"),
      (p) => !named("High Strength")(p) && !named("Capped")(p)
    ),
  },
  {
    kind: "high-strength shafts",
    match: both(family("shaft"), named("High Strength")),
  },
  { kind: "capped shafts", match: both(family("shaft"), named("Capped")) },
  { kind: "shaft collars", match: family("collar") },
  { kind: "spacers", match: family("spacer") },
  { kind: "washers", match: family("washer") },
  { kind: "flat bearings", match: both(family("bearing"), named("Flat")) },
  { kind: "block bearings", match: both(family("bearing"), named("Block")) },
  { kind: "hex nut retainers", match: both(family("retainer"), named("Hex")) },
  { kind: "lock bars", match: family("lock-bar") },
  { kind: "rubber bumpers", match: family("bumper") },
  { kind: "Linear Motion Kit rails and slides", match: named("Linear Motion") },
  { kind: "gears", match: family("gear") },
  {
    kind: "high-strength gears",
    match: both(family("gear"), named("High Strength")),
  },
  { kind: "sprockets", match: family("sprocket") },
  {
    kind: "high-strength sprockets",
    match: both(family("sprocket"), named("High Strength")),
  },
  { kind: "rack gears", match: family("rack") },
  { kind: "chain", match: family("chain") },
  { kind: "tank tread", match: family("tread") },
  { kind: "flex wheels", match: both(family("wheel"), named("Flex")) },
  {
    kind: "flex wheel inserts",
    match: both(
      family("insert"),
      (p) => named("VersaHub")(p) || named("VersaHex")(p)
    ),
  },
  { kind: "traction wheels", match: both(family("wheel"), named("Traction")) },
  { kind: "omni wheels", match: both(family("wheel"), named("Omni")) },
  { kind: "mecanum wheels", match: both(family("wheel"), named("Mecanum")) },
  {
    kind: "anti-static wheels",
    match: both(family("wheel"), named("Anti-Static")),
  },
  // Electronics
  { kind: "11 W motor", match: both(family("motor"), named("11W")) },
  { kind: "5.5 W motor", match: both(family("motor"), named("5.5W")) },
  { kind: "Brain", match: family("brain") },
  { kind: "battery", match: family("battery") },
  { kind: "battery clip", match: both(family("battery"), named("Clip")) },
  { kind: "radio", match: family("radio") },
  { kind: "controller", match: family("controller") },
  { kind: "rotation sensor", match: both(family("sensor"), named("Rotation")) },
  { kind: "distance sensor", match: both(family("sensor"), named("Distance")) },
  {
    kind: "optical sensor",
    match: both(family("sensor"), named("Optical Sensor")),
  },
  { kind: "inertial sensor", match: both(family("sensor"), named("Inertial")) },
  { kind: "vision sensor", match: both(family("sensor"), named("Vision")) },
  { kind: "GPS sensor", match: both(family("sensor"), named("GPS")) },
  { kind: "bumper switch", match: both(family("switch"), named("Bumper")) },
  { kind: "limit switch", match: both(family("switch"), named("Limit")) },
  {
    kind: "potentiometer",
    match: both(family("sensor"), named("Potentiometer")),
  },
  { kind: "encoder", match: both(family("sensor"), named("Encoder")) },
  { kind: "3-wire expander", match: family("expander") },
  // Pneumatics
  { kind: "25 mm cylinder", match: both(family("cylinder"), named("25 mm")) },
  { kind: "50 mm cylinder", match: both(family("cylinder"), named("50 mm")) },
  { kind: "75 mm cylinder", match: both(family("cylinder"), named("75 mm")) },
  { kind: "reservoirs", match: family("reservoir") },
  { kind: "fittings", match: family("fitting") },
  { kind: "tubing", match: named("tubing") },
  { kind: "solenoids", match: named("solenoid") },
  // Field Elements
  { kind: "Override field", match: family("override") },
  { kind: "Push Back field", match: family("push-back") },
  { kind: "High Stakes field", match: family("high-stakes") },
  { kind: "Spin Up field", match: family("spin-up") },
]

/** Kinds with no Part yet, and why. Each reason names what was tried. */
const KNOWN_MISSING: Record<string, string> = {
  rails:
    "The steel 2x1 chassis rail (275-1145, 275-1146) has a 12.7 x 24.13 mm profile. The Cut Part generator only draws channels, angles and square shafts.",
  "Linear Motion Kit rails and slides":
    "Not in the vex-cad-download set or the SHU and Solidworks repos for V5. Only SolidWorks (.SLDPRT) and IQ parts were found. The VEX product page for the kit (276-6465) lists STEP files; not fetched.",
  tubing: "No pneumatic tubing STEP in the sources checked.",
  solenoids:
    "No solenoid STEP in the Pneumatics folders of the sources checked.",
  "High Stakes field":
    "The Fusion (.f3d) and Inventor (.ipt) files are ShapeManager B-reps with no mesh; no readable STEP was found.",
  "Spin Up field":
    "No STEP found in the sources. A stlfinder disc (third-party) and the SJTU SolidWorks library were found but not verified.",
  "Override field":
    "Fusion (.f3d) files are binary B-reps. SHU-ROBOTICS has only pin and cup STL meshes. No STEP found.",
}

describe("the Catalog covers every kind a team needs", () => {
  for (const requirement of REQUIRED) {
    it(`has ${requirement.kind}, or says why it is missing`, () => {
      const found = catalog.parts.filter(requirement.match)
      const reason = KNOWN_MISSING[requirement.kind]
      if (reason) {
        expect(
          found,
          `${requirement.kind} is listed as missing but now exists`
        ).toHaveLength(0)
        expect(reason.length).toBeGreaterThan(20)
      } else {
        expect(found.length, `no Part for ${requirement.kind}`).toBeGreaterThan(
          0
        )
      }
    })
  }

  it("names only kinds the requirement list asks for", () => {
    const kinds = new Set(REQUIRED.map((r) => r.kind))
    for (const kind of Object.keys(KNOWN_MISSING))
      expect(kinds.has(kind)).toBe(true)
  })

  it("keeps every model under its declared triangle budget, or reports the miss", () => {
    for (const part of catalog.parts) {
      if (part.kind !== "model") continue
      if (part.model.triangles > part.model.budgetTriangles)
        expect(part.model.triangles / part.model.budgetTriangles).toBeLessThan(
          20
        )
    }
  })
})
