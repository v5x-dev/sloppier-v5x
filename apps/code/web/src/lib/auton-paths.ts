export type PathPoint = {
  x: number
  y: number
  heading: number
  start?: boolean
  interpolated?: boolean
  source?: { file: string; line: number }
}
export type AutonPath = {
  id: string
  name: string
  file: string
  points: PathPoint[]
  warnings: string[]
}
export type AutonTemplate = "ez-template" | "jar"

// Calls that make a function a route. `motion` finds them; `names` lets the walker follow them.
const templateCalls: Record<AutonTemplate, { motion: RegExp; names: RegExp }> =
  {
    "ez-template": {
      motion:
        /\bpid_(?:drive|turn|turn_relative|swing|swing_relative|odom|odom_boomerang|odom_pure_pursuit)_set\s*\(/,
      names:
        /^(?:pid_(?:drive|turn|turn_relative|swing|swing_relative|odom|odom_boomerang|odom_pure_pursuit)_set|odom_xyt_set|odom_set|drive_angle_set)$/,
    },
    jar: {
      motion:
        /\b(?:drive_distance|turn_to_angle|left_swing_to_angle|right_swing_to_angle|drive_to_point|turn_to_point|drive_to_pose|holonomic_drive_to_pose)\s*\(/,
      names:
        /^(?:drive_distance|turn_to_angle|left_swing_to_angle|right_swing_to_angle|drive_to_point|turn_to_point|drive_to_pose|holonomic_drive_to_pose|set_coordinates|set_heading)$/,
    },
  }

const toRadians = (degrees: number) => (degrees * Math.PI) / 180
const toDegrees = (radians: number) => (radians * 180) / Math.PI
// Wraps an angle to [-180, 180), the same shortest-turn rule both templates use.
const wrap = (degrees: number) => (((degrees % 360) + 540) % 360) - 180

// Keep offsets and newlines stable while removing comments and string contents.
function clean(source: string) {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (text) => text.replace(/[^\n]/g, " ")
  )
}
function endOf(source: string, start: number, open: string, close: string) {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === open) depth++
    if (source[i] === close && --depth === 0) return i
  }
  return source.length - 1
}
function number(text: string): number | null {
  const match = text
    .trim()
    .match(/^([+-]?\s*(?:\d+(?:\.\d*)?|\.\d+))(?:_(in|ft|cm|mm|deg|rad))?$/)
  if (!match) return null
  const value = Number(match[1].replace(/\s/g, ""))
  const scale = new Map<string, number>([
    ["ft", 12],
    ["cm", 1 / 2.54],
    ["mm", 1 / 25.4],
    ["rad", 180 / Math.PI],
  ])
  return value * (scale.get(match[2]) ?? 1)
}
// Reads a constant assignment such as `chassis.boomerang_lead = .5;` from any file.
function assignedNumber(files: ReadonlyMap<string, string>, name: string) {
  for (const source of files.values()) {
    const match = clean(source).match(new RegExp(`\\b${name}\\s*=\\s*([^;]+);`))
    const value = match ? number(match[1]) : null
    if (value !== null) return value
  }
  return null
}

export function parseAutonPaths(
  files: ReadonlyMap<string, string>,
  template: AutonTemplate,
  trackWidth = 12
): AutonPath[] {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0)
    throw new Error("Track width must be a positive number.")
  const { motion, names } = templateCalls[template]
  // Resolve literal project constants without evaluating arbitrary C++ expressions.
  const constants = new Map<string, number | null>()
  for (const source of files.values()) {
    const code = clean(source)
    const declarations = [
      ...code.matchAll(
        /\b(?:constexpr|const)\s+(?:\w+\s+)*?(\w+)\s*=\s*([^;]+);/g
      ),
      ...code.matchAll(/^\s*#\s*define\s+(\w+)\s+([^\n]+)/gm),
    ]
    for (const match of declarations) {
      const value = number(match[2])
      constants.set(
        match[1],
        constants.has(match[1]) && constants.get(match[1]) !== value
          ? null
          : value
      )
    }
  }
  const resolveNumber = (text: string) =>
    number(text) ?? constants.get(text.trim()) ?? null
  // JAR's boomerang tuning is set in constants; fall back to the template's usual values.
  const boomerangLead = assignedNumber(files, "boomerang_lead") ?? 0.5
  const boomerangSetback = assignedNumber(files, "boomerang_setback") ?? 0
  const functions: {
    name: string
    file: string
    body: string
    startLine: number
  }[] = []
  for (const [file, source] of files) {
    const code = clean(source)
    const pattern = /\bvoid\s+(\w+)\s*\(\s*(?:void)?\s*\)\s*\{/g
    for (const match of code.matchAll(pattern)) {
      const start = match.index + match[0].length - 1
      functions.push({
        name: match[1],
        file,
        startLine: code.slice(0, start + 1).split("\n").length,
        body: code.slice(start + 1, endOf(code, start, "{", "}")),
      })
    }
  }
  // Templates set the starting pose in autonomous() before running the
  // selected routine, so every route starts from the last pose set there.
  const poseCall =
    template === "jar"
      ? /\bset_coordinates\s*\(([^()]*)\)/g
      : /\bodom_(?:xyt_)?set\s*\(([^()]*)\)/g
  let entry: PathPoint = { x: 0, y: 0, heading: 0, start: true }
  for (const fn of functions.filter((item) => item.name === "autonomous"))
    for (const match of fn.body.matchAll(poseCall)) {
      const [x, y, heading] = match[1].split(",").map(number)
      if (x != null && y != null && heading != null)
        entry = { x, y, heading, start: true }
    }
  const hasMotion = (body: string, seen = new Set<string>()): boolean => {
    if (motion.test(body)) return true
    return functions.some(
      (fn) =>
        !seen.has(fn.name) &&
        new RegExp(`\\b${fn.name}\\s*\\(\\s*\\)`).test(body) &&
        hasMotion(fn.body, new Set([...seen, fn.name]))
    )
  }
  return functions
    .filter((fn) => hasMotion(fn.body))
    .map((fn) => {
      let pose: PathPoint = { ...entry }
      const points = [pose]
      // Until the robot moves, a pose reset replaces the starting point.
      let moved = false
      const warnings = new Set<string>()
      let budget = 2000

      // Starts a new segment at an odometry pose.
      function resetPose(x: number, y: number, heading: number) {
        pose = { x, y, heading, start: true }
        if (moved) points.push(pose)
        else points[points.length - 1] = pose
      }
      // Turns in place; the chassis does not translate.
      function turnTo(heading: number) {
        moved = true
        pose = { ...pose, start: false, heading }
        points.push(pose)
      }
      function moveTo(x: number, y: number, heading: number) {
        moved = true
        pose = { x, y, heading }
        points.push(pose)
      }
      function bearingTo(x: number, y: number) {
        return toDegrees(Math.atan2(x - pose.x, y - pose.y))
      }
      function driveAlong(distance: number) {
        const angle = toRadians(pose.heading)
        moveTo(
          pose.x + Math.sin(angle) * distance,
          pose.y + Math.cos(angle) * distance,
          pose.heading
        )
      }
      function driveTo(x: number, y: number) {
        const bearing = bearingTo(x, y)
        // JAR backs up when the target is more than 90° behind its heading.
        const reverse = Math.abs(wrap(bearing - pose.heading)) > 90
        moveTo(x, y, reverse ? bearing + 180 : bearing)
      }
      // Pivots about the side that is not driving. `ratio` is still-side speed over moving-side speed.
      function swing(
        side: string,
        target: number,
        relative: boolean,
        behavior: string | undefined,
        ratio: number
      ) {
        if (!Number.isFinite(ratio) || Math.abs(1 - ratio) < 0.000001) {
          warnings.add("Swing speeds do not define a finite turning radius.")
          return
        }
        const heading = relative ? pose.heading + target : target
        // EZ's LEFT_SWING drives the left side and pivots around the right.
        const radius =
          ((((side === "LEFT" ? 1 : -1) * trackWidth) / 2) * (1 + ratio)) /
          (1 - ratio)
        const initial = toRadians(pose.heading)
        const pivotX = pose.x + radius * Math.cos(initial)
        const pivotY = pose.y - radius * Math.sin(initial)
        const rawDelta = heading - pose.heading
        const clockwise = ((rawDelta % 360) + 360) % 360
        let delta = relative ? target : wrap(rawDelta)
        if (behavior === "cw") delta = clockwise
        else if (behavior === "ccw")
          delta = clockwise === 0 ? 0 : clockwise - 360
        else if (behavior === "raw") delta = rawDelta
        else if (behavior === "shortest") delta = wrap(clockwise)
        else if (behavior === "longest") {
          const shortest = wrap(clockwise)
          delta = shortest === 0 ? 0 : shortest - Math.sign(shortest) * 360
        }
        moved = true
        const steps = Math.min(720, Math.max(1, Math.ceil(Math.abs(delta) / 5)))
        const startHeading = pose.heading
        for (let step = 1; step <= steps; step++) {
          const angle = startHeading + (delta * step) / steps
          const radians = toRadians(angle)
          pose = {
            x: pivotX - radius * Math.cos(radians),
            y: pivotY + radius * Math.sin(radians),
            heading: angle,
            interpolated: step < steps,
          }
          points.push(pose)
        }
      }
      // Simulates JAR's boomerang carrot with an instant heading response.
      function boomerang(
        x: number,
        y: number,
        heading: number,
        lead: number,
        setback: number,
        reverse = false,
        label = "drive_to_pose"
      ) {
        warnings.add(
          `${label} is approximated with an instant heading response.`
        )
        moved = true
        for (let step = 0; step < 400; step++) {
          const distance = Math.hypot(x - pose.x, y - pose.y)
          if (distance < 0.5) break
          const carrot = lead * distance + setback
          const travelHeading = heading + (reverse ? 180 : 0)
          const carrotX = x - Math.sin(toRadians(travelHeading)) * carrot
          const carrotY = y - Math.cos(toRadians(travelHeading)) * carrot
          const aim = bearingTo(carrotX, carrotY)
          const travel = Math.min(2, distance)
          const angle = toRadians(aim)
          pose = {
            x: pose.x + Math.sin(angle) * travel,
            y: pose.y + Math.cos(angle) * travel,
            heading: aim + (reverse ? 180 : 0),
            interpolated: true,
          }
          points.push(pose)
        }
        moveTo(x, y, heading)
      }

      function ezCall(name: string, args: string, values: (number | null)[]) {
        if (name === "odom_xyt_set" || name === "odom_set") {
          if (
            values.slice(0, 3).length === 3 &&
            values.slice(0, 3).every((v) => v !== null)
          )
            resetPose(values[0]!, values[1]!, values[2]!)
          else warnings.add(`Cannot resolve ${name}.`)
        } else if (
          name === "pid_drive_set" ||
          name === "pid_odom_set" ||
          name === "pid_odom_boomerang_set" ||
          name === "pid_odom_pure_pursuit_set"
        ) {
          const targets = [
            ...args.matchAll(
              /\{\s*\{\s*([^{}]+)\}\s*,\s*((?:ez::)?(?:fwd|rev))\b[^{}]*\}/g
            ),
          ]
          if (targets.length) {
            for (const target of targets) {
              const coordinates = target[1].split(",").map(resolveNumber)
              if (coordinates[0] === null || coordinates[1] == null) {
                warnings.add("Some waypoint coordinates could not be resolved.")
                continue
              }
              const x = coordinates[0],
                y = coordinates[1]
              const reverse = target[2].endsWith("rev")
              if (coordinates.length > 2 && coordinates[2] == null) {
                warnings.add("Some waypoint headings could not be resolved.")
                continue
              }
              if (coordinates[2] != null)
                boomerang(
                  x,
                  y,
                  coordinates[2],
                  0.5,
                  0,
                  reverse,
                  "pid_odom_set pose"
                )
              else moveTo(x, y, bearingTo(x, y) + (reverse ? 180 : 0))
            }
          } else if (!args.includes("{") && values[0] !== null)
            driveAlong(values[0])
          else warnings.add(`Cannot resolve ${name} distance.`)
        } else if (
          name === "pid_swing_set" ||
          name === "pid_swing_relative_set"
        ) {
          const parts = args.split(",").map((part) => part.trim())
          const side = parts[0].match(/^(?:ez::)?(LEFT|RIGHT)_SWING$/)?.[1]
          const target = values[1]
          if (!side || target == null) {
            warnings.add(`Cannot resolve ${name} side or angle.`)
            return
          }
          const behaviorPattern = /^(?:ez::)?(cw|ccw|shortest|longest|raw)$/
          const behavior = parts
            .slice(3)
            .map((part) => part.match(behaviorPattern)?.[1])
            .find(Boolean)
          const fourthIsOption =
            parts.length > 3 &&
            (behaviorPattern.test(parts[3]) || /^(true|false)$/.test(parts[3]))
          const stillSpeed =
            parts.length > 3 && !fourthIsOption ? resolveNumber(parts[3]) : 0
          const movingSpeed = resolveNumber(parts[2] ?? "")
          let ratio = 0
          if (
            stillSpeed === null ||
            (stillSpeed !== 0 && movingSpeed == null)
          ) {
            warnings.add(
              "Swing speed ratio could not be resolved; assuming the still side is stopped."
            )
          } else if (stillSpeed !== 0 && movingSpeed !== null) {
            ratio = stillSpeed / movingSpeed
          }
          swing(
            side,
            target,
            name === "pid_swing_relative_set",
            behavior,
            ratio
          )
        } else if (
          name === "pid_turn_set" ||
          name === "pid_turn_relative_set" ||
          name === "drive_angle_set"
        ) {
          const point =
            name === "pid_turn_set" &&
            args.match(/^\s*\{\s*([^{}]+)\}\s*,\s*((?:ez::)?(?:fwd|rev))\b/)
          if (point) {
            const [x, y] = point[1].split(",").map(resolveNumber)
            if (x == null || y == null)
              warnings.add(`Cannot resolve ${name} point.`)
            else turnTo(bearingTo(x, y) + (point[2].endsWith("rev") ? 180 : 0))
            return
          }
          const angle = values[0]
          if (angle === null) warnings.add(`Cannot resolve ${name} angle.`)
          else
            turnTo(
              name === "pid_turn_relative_set" ? pose.heading + angle : angle
            )
        } else
          warnings.add(
            `${name} is not supported; subsequent positions may be approximate.`
          )
      }

      function jarCall(name: string, args: string, values: (number | null)[]) {
        const parts = args.split(",")
        const [first, second, third] = values
        if (name === "set_coordinates") {
          if (first == null || second == null || third == null)
            warnings.add(`Cannot resolve ${name} pose.`)
          else resetPose(first, second, third)
        } else if (name === "set_heading" || name === "turn_to_angle") {
          if (first == null) warnings.add(`Cannot resolve ${name} angle.`)
          else turnTo(first)
        } else if (name === "drive_distance") {
          if (first == null) warnings.add(`Cannot resolve ${name} distance.`)
          else {
            // An optional heading turns the chassis before it drives straight.
            if (parts.length > 1 && parts[1].trim()) {
              if (second == null)
                warnings.add(`Cannot resolve ${name} heading.`)
              else turnTo(second)
            }
            driveAlong(first)
          }
        } else if (
          name === "left_swing_to_angle" ||
          name === "right_swing_to_angle"
        ) {
          if (first == null) warnings.add(`Cannot resolve ${name} angle.`)
          else
            swing(
              name.startsWith("left") ? "LEFT" : "RIGHT",
              first,
              false,
              undefined,
              0
            )
        } else if (name === "drive_to_point") {
          if (first == null || second == null)
            warnings.add(`Cannot resolve ${name} point.`)
          else driveTo(first, second)
        } else if (name === "turn_to_point") {
          if (first == null || second == null)
            warnings.add(`Cannot resolve ${name} point.`)
          else {
            const extra = parts.length > 2 ? third : 0
            if (extra === null)
              warnings.add(`Cannot resolve ${name} extra angle.`)
            turnTo(bearingTo(first, second) + (extra ?? 0))
          }
        } else if (name === "drive_to_pose") {
          if (first == null || second == null || third == null)
            warnings.add(`Cannot resolve ${name} target.`)
          else {
            const lead = parts.length > 3 ? values[3] : boomerangLead
            const setback = parts.length > 4 ? values[4] : boomerangSetback
            if (lead == null || setback == null)
              warnings.add(`Cannot resolve ${name} lead or setback.`)
            boomerang(
              first,
              second,
              third,
              lead ?? boomerangLead,
              setback ?? boomerangSetback
            )
          }
        } else if (name === "holonomic_drive_to_pose") {
          const heading = parts.length > 2 ? third : pose.heading
          if (first == null || second == null || heading == null)
            warnings.add(`Cannot resolve ${name} target.`)
          else moveTo(first, second, heading)
        }
      }

      function walk(current: (typeof functions)[number], stack: string[]) {
        const { body } = current
        if (/\b(if|for|while|switch)\s*\(/.test(body))
          warnings.add("Branches and loops are shown once in source order.")
        const calls = /\b(\w+)\s*\(/g
        let match: RegExpExecArray | null
        while ((match = calls.exec(body)) && budget-- > 0) {
          const name = match[1]
          const start = match.index + match[0].length - 1
          const end = endOf(body, start, "(", ")")
          const args = body.slice(start + 1, end)
          calls.lastIndex = end + 1
          const helper = functions.filter((item) => item.name === name)
          if (helper.length === 1 && !args.trim()) {
            if (stack.includes(name))
              warnings.add("Recursive helper calls are skipped.")
            else walk(helper[0], [...stack, name])
            continue
          }
          if (!names.test(name)) continue
          const values = args.split(",").map(resolveNumber)
          const previousLength = points.length
          const previousStart = points[0]
          if (template === "jar") jarCall(name, args, values)
          else ezCall(name, args, values)
          const source = {
            file: current.file,
            line:
              current.startLine +
              body.slice(0, match.index).split("\n").length -
              1,
          }
          if (points[0] !== previousStart) points[0].source = source
          for (const point of points.slice(previousLength))
            point.source = source
        }
        if (budget <= 0) warnings.add("Preview command limit reached.")
      }
      walk(fn, [fn.name])
      return {
        id: `${fn.file}:${fn.name}`,
        name: fn.name,
        file: fn.file,
        points,
        warnings: [...warnings],
      }
    })
}
