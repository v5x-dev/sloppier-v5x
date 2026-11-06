import { describe, expect, it } from "vitest"
import { Quaternion, Vector3 } from "three"
import { partById } from "@/catalog/catalog"
import type { Vec3 } from "@/catalog/types"
import type { BuildMapping, Calibration } from "@/design/build-mapping"
import {
  MAX_BUILD_FILE_CHARS,
  MAX_BUILD_PARTS,
  designFromPlan,
  designPose,
  mirrorRotation,
  parseBuildFile,
  planBuildImport,
  unityRotation,
} from "@/design/build-file"
import { alignToSnap, toWorldSnap } from "@/design/snap"

const IDENTITY_CAL: Calibration = {
  unitsToMm: 1,
  modelTurnDeg: [0, 0, 0],
  pivotMm: [0, 0, 0],
}

/** A saved file with the given parts, shaped the way the team described. */
function fileWith(
  parts: unknown[],
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({ name: "Test robot", parts, ...extra })
}

function goodPart(
  partId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    partId,
    xPos: 1,
    yPos: 2,
    zPos: 3,
    xRot: 0,
    yRot: 0,
    zRot: 0,
    rColor: 0.5,
    gColor: 0,
    bColor: 1,
    states: "",
    ...overrides,
  }
}

function parsedOk(text: string) {
  const parsed = parseBuildFile(text)
  if (!parsed.ok) throw new Error(parsed.problems.join("; "))
  return parsed
}

describe("reading a Build file", () => {
  it("refuses text that is not JSON, not an object, or has no parts list", () => {
    for (const text of [
      "not json",
      "[]",
      "null",
      JSON.stringify({ name: "x" }),
    ]) {
      const result = parseBuildFile(text)
      expect(result.ok).toBe(false)
    }
  })

  it("refuses a file that is too large or has too many parts", () => {
    expect(parseBuildFile("x".repeat(MAX_BUILD_FILE_CHARS + 1)).ok).toBe(false)
    const many = Array.from({ length: MAX_BUILD_PARTS + 1 }, () =>
      goodPart("a")
    )
    expect(parseBuildFile(fileWith(many)).ok).toBe(false)
  })

  it("reads every good part and reports each bad one with its number and reason", () => {
    const parsed = parsedOk(
      fileWith([
        goodPart("motor-a"),
        goodPart("", {}),
        goodPart("plate-b", { xPos: "1" }),
        goodPart("plate-c", { rColor: 2 }),
        null,
        42,
        { partId: "bare" },
        goodPart("plate-d", { xRot: 1e308 }),
        goodPart("plate-e", { states: 7 }),
        goodPart("plate-f", { states: null }),
      ])
    )
    expect(parsed.parts.map((p) => [p.number, p.partId])).toEqual([
      [1, "motor-a"],
      [10, "plate-f"],
    ])
    expect(parsed.rejected.map((r) => r.number)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ])
    expect(parsed.rejected[0].reason).toMatch(/part id/)
    expect(parsed.rejected[1].reason).toMatch(/xPos/)
    expect(parsed.rejected[2].reason).toMatch(/0 to 1/)
    expect(parsed.rejected[3].reason).toMatch(/object/)
    expect(parsed.rejected[3].partId).toBeUndefined()
    expect(parsed.rejected[6].partId).toBe("plate-d")
  })

  it("keeps the states text and turns the colour into a hex colour", () => {
    const [part] = parsedOk(
      fileWith([
        goodPart("m", { states: "Forward", rColor: 1, gColor: 0, bColor: 0.5 }),
      ])
    ).parts
    expect(part.states).toBe("Forward")
    expect(part.color).toBe("#ff0080")
  })

  it("cleans the robot's name and gives a default when it has none", () => {
    expect(parsedOk(fileWith([], { name: "  Drive\n base  " })).name).toBe(
      "Drive  base"
    )
    expect(parsedOk(fileWith([], { name: undefined })).name).toBe(
      "Imported Protobot Design"
    )
  })
})

describe("the rotation conversion", () => {
  it("turns a Unity quarter turn about Y into the matching right-handed turn", () => {
    // Unity's +90 about Y sends +X to -Z. Mirroring X sends -X to -Z, so the right-handed
    // turn is -90 about Y: it sends -X to -Z and +X to +Z.
    const q = mirrorRotation(unityRotation([0, 90, 0]))
    const expected = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      -Math.PI / 2
    )
    expect(sameRotation(q, expected)).toBe(true)
  })

  it("matches the mirror of the Unity rotation for any Euler triple", () => {
    const mirror = new Vector3(-1, 1, 1)
    const point = new Vector3(0.3, 0.5, -0.7)
    for (const euler of [
      [10, 20, 30],
      [-45, 120, 77],
      [90, 0, 0],
      [0, 0, 90],
      [200, -15, 3],
    ] as Vec3[]) {
      const unity = unityRotation(euler)
      const expectedPoint = point
        .clone()
        .applyQuaternion(unity)
        .multiply(mirror)
      const rightHanded = mirrorRotation(unity)
      const actualPoint = point
        .clone()
        .multiply(mirror)
        .applyQuaternion(rightHanded)
      expect(actualPoint.distanceTo(expectedPoint)).toBeLessThan(1e-9)
    }
  })

  it("applies Unity's Euler order: Z first, then X, then Y", () => {
    // (1,0,0) is fixed by a turn about X, so the X turn only matters if it comes after Y's.
    // Applying X first then Y gives (0,0,-1); Y first then X gives (0,1,0).
    const point = new Vector3(1, 0, 0)
    const actual = point.clone().applyQuaternion(unityRotation([90, 90, 0]))
    const xThenY = point
      .clone()
      .applyAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
      .applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const yThenX = point
      .clone()
      .applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      .applyAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    expect(actual.distanceTo(xThenY)).toBeLessThan(1e-9)
    expect(actual.distanceTo(yThenX)).toBeGreaterThan(1e-3)
  })
})

describe("the pose conversion", () => {
  it("negates X and scales the position to millimetres", () => {
    const pose = designPose([2, 3, 4], [0, 0, 0], {
      ...IDENTITY_CAL,
      unitsToMm: 10,
    })
    expect(pose.position).toEqual([-20, 30, 40])
    expect(pose.rotation[3]).toBeCloseTo(1)
  })

  it("moves the origin from the pivot to the centre of the Part, turned with the Part", () => {
    // Pivot 10 mm along the Part's +X. With no turn the centre sits 10 mm behind the pivot.
    const straight = designPose([2, 3, 4], [0, 0, 0], {
      ...IDENTITY_CAL,
      unitsToMm: 10,
      pivotMm: [10, 0, 0],
    })
    expect(straight.position).toEqual([-30, 30, 40])
    // Turned a quarter about Z (right-handed, after mirroring), the pivot sits along -Y.
    const turned = designPose([2, 3, 4], [0, 0, 90], {
      ...IDENTITY_CAL,
      unitsToMm: 10,
      pivotMm: [10, 0, 0],
    })
    expect(turned.position[0]).toBeCloseTo(-20)
    expect(turned.position[1]).toBeCloseTo(40)
    expect(turned.position[2]).toBeCloseTo(40)
  })

  it("applies a fixed model turn before the Part's own turn", () => {
    const pose = designPose([0, 0, 0], [0, 0, 0], {
      ...IDENTITY_CAL,
      modelTurnDeg: [0, 0, 90],
    })
    const q = new Quaternion(...pose.rotation)
    const x = new Vector3(1, 0, 0).applyQuaternion(q)
    expect(x.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9)
  })
})

describe("planning an import", () => {
  const mappings: BuildMapping[] = [
    {
      partId: "fake-motor",
      catalogId: "motor-v5-smart-11w",
      calibration: IDENTITY_CAL,
      verified: true,
      note: "test",
    },
    {
      partId: "fake-channel",
      catalogId: "channel-1x2x1-steel",
      lengthMm: 127,
      calibration: IDENTITY_CAL,
      verified: false,
      note: "test",
    },
    {
      partId: "fake-broken",
      catalogId: "no-such-part",
      calibration: IDENTITY_CAL,
      verified: true,
      note: "test",
    },
  ]

  it("imports mapped parts with their Catalog id, length, and colour", () => {
    const parsed = parsedOk(
      fileWith([
        goodPart("fake-motor"),
        goodPart("fake-channel", { rColor: 0, gColor: 0, bColor: 0 }),
      ])
    )
    const plan = planBuildImport(parsed, mappings)
    expect(plan.parts).toEqual([
      expect.objectContaining({
        id: "b1",
        catalogId: "motor-v5-smart-11w",
        color: "#8000ff",
      }),
      expect.objectContaining({
        id: "b2",
        catalogId: "channel-1x2x1-steel",
        lengthMm: 127,
        color: "#000000",
      }),
    ])
    expect(plan.skipped).toEqual([])
  })

  it("skips unmapped parts and says why, naming the part id", () => {
    const plan = planBuildImport(
      parsedOk(
        fileWith([
          goodPart("fake-motor"),
          goodPart("mystery"),
          goodPart("mystery"),
        ])
      ),
      mappings
    )
    expect(plan.parts.map((p) => p.id)).toEqual(["b1"])
    expect(plan.skipped.map((s) => [s.number, s.partId])).toEqual([
      [2, "mystery"],
      [3, "mystery"],
    ])
    expect(plan.skipped[0].reason).toMatch(/not mapped|no Catalog Part/)
  })

  it("skips a mapping that names a Part missing from the catalog", () => {
    const plan = planBuildImport(
      parsedOk(fileWith([goodPart("fake-broken")])),
      mappings
    )
    expect(plan.parts).toEqual([])
    expect(plan.skipped[0].reason).toMatch(/no-such-part/)
  })

  it("is unverified unless every mapping it used is checked", () => {
    const motorOnly = planBuildImport(
      parsedOk(fileWith([goodPart("fake-motor")])),
      mappings
    )
    expect(motorOnly.verified).toBe(true)
    const mixed = planBuildImport(
      parsedOk(fileWith([goodPart("fake-motor"), goodPart("fake-channel")])),
      mappings
    )
    expect(mixed.verified).toBe(false)
    const none = planBuildImport(
      parsedOk(fileWith([goodPart("fake-motor")])),
      []
    )
    expect(none.parts).toEqual([])
    expect(none.verified).toBe(false)
  })

  it("carries the file's rejected entries through to the plan", () => {
    const plan = planBuildImport(
      parsedOk(fileWith([goodPart("fake-motor"), null])),
      mappings
    )
    expect(plan.rejected.map((r) => r.number)).toEqual([2])
  })
})

describe("building a Design from a plan", () => {
  it("joins a screw to a plate when its pin sits in a hole, and checks the result", () => {
    const plate = partById("plate-5x15-steel")
    const screw = partById("screw-8-32-1")
    if (plate.kind !== "model" || screw.kind !== "model")
      throw new Error("expected fixed Parts")
    const hole = plate.snapPoints.find((s) => s.kind === "hole")
    const pin = screw.snapPoints.find((s) => s.kind === "pin")
    if (!hole || !pin) throw new Error("expected a hole and a pin")

    const platePose = {
      position: [0, 0, 0] as Vec3,
      rotation: [0, 0, 0, 1] as const,
    }
    const target = toWorldSnap(hole, platePose)
    const screwPose = alignToSnap(pin, target, [0, 0, 0, 1])

    const design = designFromPlan({
      name: "Joined",
      parts: [
        {
          id: "p1",
          catalogId: plate.id,
          position: platePose.position,
          rotation: [0, 0, 0, 1],
          color: "#7f8691",
        },
        {
          id: "p2",
          catalogId: screw.id,
          position: screwPose.position,
          rotation: screwPose.rotation,
          color: "#c4cad3",
        },
      ],
      skipped: [],
      rejected: [],
      verified: false,
    })
    if (!design.ok) throw new Error(design.problems.join("; "))
    expect(design.design.connections).toEqual([
      {
        id: "c1",
        fastener: "p2",
        host: "p1",
        fastenerSnap: pin.id,
        hostSnap: hole.id,
      },
    ])
  })

  it("refuses to build a Design that the Design file reader would refuse", () => {
    const result = designFromPlan({
      name: "Bad",
      parts: [
        {
          id: "p1",
          catalogId: "not-a-part",
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          color: "#000000",
        },
      ],
      skipped: [],
      rejected: [],
      verified: false,
    })
    expect(result.ok).toBe(false)
  })
})

function sameRotation(a: Quaternion, b: Quaternion): boolean {
  return Math.abs(a.dot(b)) > 1 - 1e-9
}
