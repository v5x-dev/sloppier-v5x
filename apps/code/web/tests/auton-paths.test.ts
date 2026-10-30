import { describe, expect, it } from "vitest"
import { parseAutonPaths } from "../src/lib/auton-paths"

const parse = (code: string) =>
  parseAutonPaths(new Map([["src/autons.cpp", code]]), "ez-template")
const parseJar = (code: string) =>
  parseAutonPaths(new Map([["src/autons.cpp", code]]), "jar")
describe("EZ-Template path previews", () => {
  it("expands helpers across files and uses clockwise headings from positive Y", () => {
    const routes = parseAutonPaths(
      new Map([
        [
          "src/autons.cpp",
          "void red() { forward(); chassis.pid_turn_set(90_deg, 90); chassis.pid_drive_set(-12_in, 100); }",
        ],
        [
          "src/helpers.cpp",
          "void forward() { chassis.pid_drive_set(2_ft, 100); }",
        ],
      ]),
      "ez-template"
    )
    expect(routes[0].points[1].source).toEqual({
      file: "src/helpers.cpp",
      line: 1,
    })
    expect(routes[0].points[2].source).toEqual({
      file: "src/autons.cpp",
      line: 1,
    })
    expect(routes[0].points.at(-1)).toMatchObject({
      x: -12,
      y: 24,
      heading: 90,
    })
  })
  it("reads odometry resets and nested waypoint lists", () => {
    const [route] = parse(`void skills() {
      chassis.odom_xyt_set(-24_in, -48_in, 0_deg);
      chassis.pid_odom_set({{{0_in, 24_in, 45_deg}, fwd, 100}, {{12_in, 24_in}, fwd, 100}}, true);
    }`)
    expect(route.points[0]).toMatchObject({
      x: -24,
      y: -48,
      heading: 0,
      start: true,
    })
    expect(route.points.at(-1)).toMatchObject({ x: 12, y: 24, heading: 90 })
    expect(route.warnings).toContain(
      "pid_odom_set pose is approximated with an instant heading response."
    )
  })
  it("honors odometry directions and turns to points", () => {
    const [route] = parse(`void red() {
      chassis.pid_odom_set({{0_in, 24_in}, rev, 110});
      chassis.pid_turn_set({24_in, 24_in}, rev, 90);
      chassis.pid_odom_set(-12_in, 110);
    }`)
    expect(route.points[1]).toMatchObject({ x: 0, y: 24, heading: 180 })
    expect(route.points[2].heading).toBe(270)
    expect(route.points.at(-1)!.x).toBeCloseTo(12)
    expect(route.warnings).toEqual([])
  })
  it("handles scalar odometry distances like drive distances", () => {
    const [odom] = parse(`void red() {
      chassis.pid_turn_set(90_deg, speed);
      chassis.pid_odom_set(10_in, speed);
      chassis.pid_odom_set(-2_ft, speed);
    }`)
    const [drive] = parse(`void red() {
      chassis.pid_turn_set(90_deg, speed);
      chassis.pid_drive_set(10_in, speed);
      chassis.pid_drive_set(-2_ft, speed);
    }`)
    expect(odom.points).toEqual(drive.points)
    expect(odom.points.at(-1)!.x).toBeCloseTo(-14)
    expect(odom.warnings).toEqual([])
  })
  it("resolves waypoint constants and reports unresolved headings", () => {
    const [route] = parse(`const int X = 12;
      void red() { chassis.pid_odom_set({{{X, 24}, fwd, 110}, {{0, 0, angle}, rev, 110}}); }`)
    expect(route.points.at(-1)).toMatchObject({ x: 12, y: 24 })
    expect(route.warnings).toContain(
      "Some waypoint headings could not be resolved."
    )
  })
  it("excludes PID configuration routines from route discovery", () => {
    expect(
      parse(
        "void default_constants() { chassis.pid_drive_constants_set(20, 0, 100); chassis.pid_turn_exit_condition_set(90, 3); }"
      )
    ).toEqual([])
  })
  it("ignores comments, strings, and function declarations", () => {
    expect(
      parse(`void fake(); // chassis.pid_drive_set(12, 100);
      void ignored() { const char* text = "chassis.pid_drive_set(12, 100)"; }
      /* void fake() { chassis.pid_drive_set(12, 100); } */`)
    ).toEqual([])
  })
  it("reports unresolved expressions and control flow", () => {
    const [route] = parse(
      "void red() { if (sensor()) { chassis.pid_drive_set(distance * 2, 100); } chassis.pid_swing_set(ez::LEFT_SWING, 90, 100); }"
    )
    expect(route.warnings).toHaveLength(2)
    expect(route.points.length).toBeGreaterThan(2)
  })
  it.each([
    ["LEFT", 90, 6, 6],
    ["RIGHT", -90, -6, 6],
  ])(
    "renders %s swing arcs and continues driving from their endpoint",
    (side, angle, x, y) => {
      const [route] = parse(`void red() {
      chassis.pid_swing_set(ez::${side}_SWING, ${angle}_deg, 100);
      chassis.pid_drive_set(12_in, 100);
    }`)
      const endOfSwing = route.points.at(-2)!
      expect(endOfSwing.x).toBeCloseTo(x)
      expect(endOfSwing.y).toBeCloseTo(y)
      expect(endOfSwing.heading).toBe(angle)
      expect(route.points.at(-1)!.x).toBeCloseTo(
        x + (side === "LEFT" ? 12 : -12)
      )
      expect(route.warnings).toEqual([])
    }
  )
  it("uses track width and still-side speed to set swing radius", () => {
    const [route] = parseAutonPaths(
      new Map([
        [
          "src/autons.cpp",
          "void red() { chassis.pid_swing_set(LEFT_SWING, 90_deg, 100, 50); }",
        ],
      ]),
      "ez-template",
      16
    )
    expect(route.points.at(-1)!.x).toBeCloseTo(24)
    expect(route.points.at(-1)!.y).toBeCloseTo(24)
    expect(route.warnings).toEqual([])
  })
  it("supports relative swings after a heading reset", () => {
    const [route] = parse(
      "void red() { chassis.drive_angle_set(90); chassis.pid_swing_relative_set(ez::LEFT_SWING, 90, 100); }"
    )
    expect(route.points.at(-1)!.heading).toBe(180)
    expect(route.points.at(-1)!.x).toBeCloseTo(6)
    expect(route.points.at(-1)!.y).toBeCloseTo(-6)
  })
  it("warns when swing geometry cannot be resolved", () => {
    const [route] = parse(
      "void red() { chassis.pid_swing_set(side, angle, 100); chassis.pid_swing_set(LEFT_SWING, 90, 100, 100); }"
    )
    expect(route.warnings).toHaveLength(2)
    expect(route.points).toHaveLength(1)
  })
  it("honors forced clockwise swings to negative target headings", () => {
    const [route] = parse(
      "void red() { chassis.pid_swing_set(ez::LEFT_SWING, -90_deg, SWING_SPEED, 0, ez::cw); }"
    )
    expect(route.points.at(-1)!.heading).toBe(270)
    expect(route.points.some((point) => point.heading === 90)).toBe(true)
    expect(route.warnings).toEqual([])
  })
  it.each([
    "constexpr int SWING_SPEED = 100;",
    "const int SWING_SPEED = 100;",
    "#define SWING_SPEED 100",
  ])("resolves named swing speeds from %s", (declaration) => {
    const [route] = parseAutonPaths(
      new Map([
        ["include/main.h", declaration],
        [
          "src/autons.cpp",
          "void red() { chassis.pid_swing_set(ez::LEFT_SWING, -90_deg, SWING_SPEED, 20, ez::cw); }",
        ],
      ]),
      "ez-template"
    )
    expect(route.warnings).toEqual([])
    expect(route.points.at(-1)!.heading).toBe(270)
    expect(route.points.at(-1)!.x).toBeCloseTo(9)
    expect(route.points.at(-1)!.y).toBeCloseTo(-9)
  })
  it.each([
    ["ez::cw", -90, 270],
    ["ez::ccw", 90, -270],
    ["ez::shortest", 270, -90],
    ["ez::longest", 90, -270],
    ["ez::raw", 450, 450],
  ])("supports swing direction overload %s", (behavior, target, expected) => {
    const [route] = parse(
      `void red() { chassis.pid_swing_set(ez::LEFT_SWING, ${target}_deg, 100, ${behavior}); }`
    )
    expect(route.points.at(-1)!.heading).toBe(expected)
    expect(route.warnings).toEqual([])
  })
  it("bounds recursive helper expansion", () => {
    const [route] = parse(
      "void red() { chassis.pid_drive_set(12, 100); red(); }"
    )
    expect(route.warnings).toContain("Recursive helper calls are skipped.")
    expect(route.points).toHaveLength(2)
  })
})

describe("JAR-Template path previews", () => {
  it("drives along the current heading and turns to absolute headings", () => {
    const [route] = parseJar(
      "void red() { chassis.drive_distance(12); chassis.turn_to_angle(90); chassis.drive_distance(-6); }"
    )
    expect(route.points.at(-1)!.x).toBeCloseTo(-6)
    expect(route.points.at(-1)!.y).toBeCloseTo(12)
    expect(route.points.at(-1)!.heading).toBe(90)
    expect(route.warnings).toEqual([])
  })
  it("swings with the shorter arc on the side that is not driving", () => {
    const [left] = parseJar("void red() { chassis.left_swing_to_angle(90); }")
    expect(left.points.at(-1)!.x).toBeCloseTo(6)
    expect(left.points.at(-1)!.y).toBeCloseTo(6)
    const [right] = parseJar(
      "void red() { chassis.right_swing_to_angle(-90); }"
    )
    expect(right.points.at(-1)!.x).toBeCloseTo(-6)
    expect(right.points.at(-1)!.y).toBeCloseTo(6)
    expect(right.points.at(-1)!.heading).toBe(-90)
  })
  it("drives to points on the bearing, reversing when the point is behind", () => {
    const [forward] = parseJar("void red() { chassis.drive_to_point(24, 24); }")
    expect(forward.points.at(-1)).toMatchObject({ x: 24, y: 24 })
    expect(forward.points.at(-1)!.heading).toBeCloseTo(45)
    const [reverse] = parseJar("void red() { chassis.drive_to_point(0, -10); }")
    expect(reverse.points.at(-1)).toMatchObject({ x: 0, y: -10 })
    expect(reverse.points.at(-1)!.heading % 360).toBe(0)
  })
  it("turns to points with an optional extra angle", () => {
    const [route] = parseJar(
      "void red() { chassis.turn_to_point(24, 24); chassis.turn_to_point(24, 24, 180); }"
    )
    expect(route.points.at(-2)!.heading).toBeCloseTo(45)
    expect(route.points.at(-1)!.heading).toBeCloseTo(225)
    expect(route.points.at(-1)).toMatchObject({ x: 0, y: 0 })
  })
  it("approximates boomerang drives and finishes on the target heading", () => {
    const [route] = parseJar("void red() { chassis.drive_to_pose(0, 24, 90); }")
    expect(route.points.at(-1)).toMatchObject({ x: 0, y: 24, heading: 90 })
    expect(route.warnings).toEqual([
      "drive_to_pose is approximated with an instant heading response.",
    ])
  })
  it("reads boomerang lead from program constants", () => {
    const [defaultLead] = parseJar(
      "void red() { chassis.drive_to_pose(0, 24, 90); }"
    )
    expect(defaultLead.points[1].heading).toBeCloseTo(-26.565, 2)
    const [customLead] = parseAutonPaths(
      new Map([
        [
          "src/autons.cpp",
          "void odom_constants() { chassis.boomerang_lead = 1; }\nvoid red() { chassis.drive_to_pose(0, 24, 90); }",
        ],
      ]),
      "jar"
    )
    expect(customLead.points[1].heading).toBeCloseTo(-45, 2)
  })
  it("resets odometry and heading before driving", () => {
    const [route] = parseJar(
      "void red() { chassis.set_coordinates(-24, -48, 0); chassis.set_heading(45); chassis.drive_distance(12); }"
    )
    expect(route.points[0]).toMatchObject({
      x: -24,
      y: -48,
      heading: 0,
      start: true,
    })
    expect(route.points[1]).toMatchObject({
      x: -24,
      y: -48,
      heading: 45,
      start: false,
    })
    expect(route.points.at(-1)!.x).toBeCloseTo(-15.515, 2)
    expect(route.points.at(-1)!.y).toBeCloseTo(-39.515, 2)
  })
  it("treats holonomic moves as direct pose targets", () => {
    const [route] = parseJar(
      "void red() { chassis.holonomic_drive_to_pose(12, 12, 45); }"
    )
    expect(route.points.at(-1)).toMatchObject({ x: 12, y: 12, heading: 45 })
  })
  it("optionally turns before a drive with an explicit heading", () => {
    const [route] = parseJar("void red() { chassis.drive_distance(12, 90); }")
    expect(route.points.at(-1)!.x).toBeCloseTo(12)
    expect(route.points.at(-1)!.y).toBeCloseTo(0)
    expect(route.points.at(-1)!.heading).toBe(90)
  })
  it("skips JAR configuration routines", () => {
    expect(
      parseJar(
        "void default_constants() { chassis.set_drive_constants(10, 1.5, 0, 10, 0); chassis.set_drive_exit_conditions(1.5, 300, 5000); }"
      )
    ).toEqual([])
  })
  it("keeps EZ-Template and JAR-Template calls separate", () => {
    expect(
      parseAutonPaths(
        new Map([
          ["src/autons.cpp", "void red() { chassis.drive_distance(12); }"],
        ]),
        "ez-template"
      )
    ).toEqual([])
    expect(
      parseAutonPaths(
        new Map([
          ["src/autons.cpp", "void red() { chassis.pid_drive_set(12, 100); }"],
        ]),
        "jar"
      )
    ).toEqual([])
  })
})

it("includes PROS delays in source order", () => {
  const [route] = parse(`void test_auto() {
    chassis.pid_drive_set(12, 100);
    pros::delay(500);
    other.delay(3);
    pros::delay(variable);
    chassis.pid_drive_set(-4, 100);
  }`)
  expect(
    route.points
      .filter((point) => point.wait)
      .map((point) => point.source?.line)
  ).toEqual([3, 5])
})
