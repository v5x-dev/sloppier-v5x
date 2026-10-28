import { describe, expect, it } from "vitest"
import { AutocompleteEngine } from "../src/lib/autocomplete/engine"
import { positionAt } from "../src/lib/autocomplete/types"
import { indexSource, tokenize } from "../src/lib/autocomplete/source-index"
import vex from "../src/lib/autocomplete/data/vexcode.json"
import pros from "../src/lib/autocomplete/data/pros.json"
import ez from "../src/lib/autocomplete/data/ez-template.json"

function setup(
  text: string,
  database = vex,
  files: Record<string, string> = {}
) {
  const engine = new AutocompleteEngine(database)
  const offset = text.indexOf("|")
  text = text.replace("|", "")
  for (const [path, contents] of Object.entries(files))
    engine.setFile(path, contents)
  engine.setFile("src/main.cpp", text)
  const at = positionAt(text, offset)
  return {
    engine,
    at,
    text,
    items: () => engine.complete("src/main.cpp", at).items,
    labels: () => engine.complete("src/main.cpp", at).items.map((s) => s.label),
  }
}

describe("local SDK completion", () => {
  it("completes AI Vision from the EZ-Template PROS 4.2 SDK", () => {
    expect(setup("void run() { pros::| }", ez).labels()).toContain("AIVision")
    expect(
      setup("pros::AIVision sensor{1}; void run() { sensor.| }", ez).labels()
    ).toContain("get_all_objects")
  })
  it("completes VEX members, overloads and descriptions from actual metadata", () => {
    const { items } = setup(
      "#include <vex.h>\nusing namespace vex;\nmotor left(PORT1);\nvoid run() { left.| }"
    )
    const spin = items().filter((s) => s.label === "spin")
    expect(spin.length).toBeGreaterThan(1)
    expect(spin[0].documentation).toContain("motor")
    expect(spin[0].insertText).toBe("spin($0)")
    expect(spin[0].retrigger).toBe(true)
    expect(items().some((s) => s.label === "motor")).toBe(false)
  })
  it("replaces an existing word suffix and reuses existing parentheses", () => {
    const { items, text, at } = setup(
      "vex::motor left{1}; void run() { left.sp|in(vex::fwd); }"
    )
    const spin = items().find((s) => s.label === "spin")!
    expect(spin.insertText).toBe("spin")
    expect(spin.textEdit?.range.end.character).toBe(at.character + 2)
    expect(spin.textEdit?.newText).toBe("spin")
    expect(text).toContain("left.spin(")
  })
  it("exposes namespace aliases and unscoped VEX enums", () => {
    expect(
      setup("namespace robot = vex; void run() { robot::| }").labels()
    ).toContain("motor")
    expect(setup("using namespace vex; void run() { fw| }").labels()).toContain(
      "fwd"
    )
  })
  it("completes the PROS C API in C source files", () => {
    const engine = new AutocompleteEngine(pros)
    const text = "void run() { motor_move_ }"
    engine.setFile("main.c", text)
    expect(
      engine
        .complete("main.c", positionAt(text, text.indexOf(" }")))
        .items.map((s) => s.label)
    ).toContain("motor_move_velocity")
  })
  it("follows nested fields, pointers and returned objects", () => {
    expect(
      setup(
        "using namespace vex; brain Brain; void run() { Brain.Screen.| }"
      ).labels()
    ).toContain("print")
    expect(
      setup("pros::Motor *left; void run() { left->| }", pros).labels()
    ).toContain("move_velocity")
  })
  it("includes inherited PROS motor methods and inline namespace members", () => {
    expect(
      setup("pros::Motor left(1); void run() { left.| }", pros).labels()
    ).toContain("get_position")
    expect(setup("void run() { pros::| }", pros).labels()).toContain("Motor")
    expect(setup("void run() { pros::v5::| }", pros).labels()).toContain(
      "Motor"
    )
  })
  it("completes PROS device types after the inline declaration specifier", () => {
    expect(setup("inline pros::|", pros).labels()).toContain("Motor")
    expect(setup("inline pros::Mo|", pros).labels()).toContain("Motor")
    expect(setup("inline pros::|", ez).labels()).toContain("AIVision")
  })
  it("supports EZ-Template without showing APIs from other templates", () => {
    const { labels } = setup("ez::Drive chassis; void run() { chassis.| }", ez)
    expect(labels()).toContain("pid_drive_set")
    expect(setup("void run() { vex::| }", pros).labels()).toEqual([])
  })
  it("completes an EZ chassis declared after a C linkage block in a header", () => {
    const { labels } = setup(
      '#include "main.h"\nvoid opcontrol() { chassis.| }',
      ez,
      {
        "include/main.h": `#include "EZ-Template/api.hpp"
#ifdef __cplusplus
extern "C" {
#endif
void opcontrol(void);
#ifdef __cplusplus
}
#endif
extern ez::Drive chassis;`,
      }
    )
    expect(labels()).toContain("pid_drive_set")
  })
  it.each(['"C"', '"C++"'])(
    "preserves declarations inside and after an extern %s block",
    (linkage) => {
      const { labels } = setup(
        `namespace robot { extern ${linkage} { extern ez::Drive chassis; }
         extern ez::Drive other; }
         void run() { robot::| }`,
        ez
      )
      expect(labels()).toEqual(expect.arrayContaining(["chassis", "other"]))
    }
  )
  it("completes chassis members after multiline documentation with apostrophes", () => {
    const { labels } = setup(
      `ez::Drive chassis({-20, -19}, {17, 16}, 13, 2.75, 600);
/**
 * Gives you some extras in opcontrol.
 * Only enabled when you're not connected to competition control.
 */
void extras() {}
void opcontrol() { chassis.| }`,
      ez
    )
    expect(labels()).toContain("pid_drive_set")
  })
  it.each([
    "if (enabled) chassis.|",
    "while (enabled) chassis.|",
    "for (int i = 0; i < 1; i++) chassis.|",
    "if (enabled) {} else chassis.|",
  ])("completes members in an unbraced control body: %s", (body) => {
    expect(
      setup(`ez::Drive chassis; void run() { ${body} }`, ez).labels()
    ).toContain("pid_drive_set")
  })
  it("suggests parameter enum values and preserves full signatures", () => {
    const { engine, at, items } = setup(
      "using namespace vex; motor left(PORT1); void run() { left.spin(|); }"
    )
    expect(items().map((s) => s.label)).toEqual(
      expect.arrayContaining(["fwd", "rev"])
    )
    const help = engine.signatures("src/main.cpp", at)
    expect(help?.activeParameter).toBe(0)
    expect(help?.signatures.length).toBeGreaterThan(1)
  })
  it("counts arguments across lines without counting nested calls", () => {
    const { engine, at, labels } = setup(
      "using namespace vex; motor left(PORT1); void run() { left.spin(fwd,\n compute(1, 2),\n |); }"
    )
    expect(engine.signatures("src/main.cpp", at)?.activeParameter).toBe(2)
    expect(labels()).toContain("pct")
  })
  it("offers scoped PROS enums with their required qualifiers", () => {
    const { items } = setup(
      "pros::Motor left(1); void run() { left.set_brake_mode(|); }",
      pros
    )
    expect(items().some((s) => s.insertText?.includes("::coast"))).toBe(true)
  })
  it("suppresses completion in comments, strings, raw strings and numeric literals", () => {
    for (const tail of [
      "// left.|",
      "/* left.| */",
      '"left.|"',
      'R"tag(left.|)tag"',
      "123.|",
    ]) {
      expect(
        setup(
          `using namespace vex; motor left(PORT1); void run() { ${tail} }`
        ).labels()
      ).toEqual([])
    }
  })
  it("completes include paths from SDK metadata and program headers", () => {
    const { items } = setup('#include "pros/mot|"', pros, {
      "include/robot.hpp": "extern pros::Motor left;",
    })
    expect(items().map((s) => s.label)).toContain("pros/motors.hpp")
    expect(
      items().find((s) => s.label === "pros/motors.hpp")?.textEdit?.newText
    ).toBe("pros/motors.hpp")
  })
})

describe("program source context", () => {
  it("indexes declarations in other files and follows aliases", () => {
    const { labels } = setup(
      '#include "robot.hpp"\nvoid run() { left.| }',
      vex,
      { "include/robot.hpp": "using Motor = vex::motor; extern Motor left;" }
    )
    expect(labels()).toContain("spin")
  })
  it("uses local shadowing and excludes locals in other functions", () => {
    const { labels } = setup(
      "using namespace vex; motor device(PORT1); void other() { int hidden; } void run() { brain device; device.| }"
    )
    expect(labels()).toContain("Screen")
    expect(labels()).not.toContain("spin")
    expect(
      setup("void other() { int hidden; } void run() { hi| }").labels()
    ).not.toContain("hidden")
  })
  it("tracks function parameters, braced declarations, const references and auto aliases", () => {
    expect(
      setup("void run(const vex::motor &left) { left.| }").labels()
    ).toContain("spin")
    expect(
      setup("vex::motor left{1}; void run() { left.| }").labels()
    ).toContain("spin")
    expect(
      setup(
        "vex::motor left{1}; void run() { auto &alias = left; alias.| }"
      ).labels()
    ).toContain("spin")
  })
  it("follows user fields, method returns, public inheritance and container elements", () => {
    const header =
      "struct Robot { vex::motor left; vex::motor &get(); }; struct Child : public Robot {};"
    expect(
      setup(`${header} Child bot; void run() { bot.left.| }`).labels()
    ).toContain("spin")
    expect(
      setup(`${header} Robot bot; void run() { bot.get().| }`).labels()
    ).toContain("spin")
    expect(
      setup(
        "std::vector<vex::motor> motors; void run() { motors[0].| }"
      ).labels()
    ).toContain("spin")
  })
  it("updates and removes source declarations without retaining stale symbols", () => {
    const { engine, at } = setup("void run() { left.| }", vex, {
      "include/robot.hpp": "vex::motor left{1};",
    })
    expect(
      engine.complete("src/main.cpp", at).items.map((s) => s.label)
    ).toContain("spin")
    engine.setFile("include/robot.hpp", "vex::brain left;")
    expect(
      engine.complete("src/main.cpp", at).items.map((s) => s.label)
    ).toContain("Screen")
    engine.removeFile("include/robot.hpp")
    expect(engine.complete("src/main.cpp", at).items).toEqual([])
  })
  it("hides private members in user classes", () => {
    const { labels } = setup(
      "class Robot { int secret; public: int visible; }; Robot bot; void run() { bot.| }"
    )
    expect(labels()).toContain("visible")
    expect(labels()).not.toContain("secret")
  })
  it("uses project enum types for argument completion", () => {
    const { items, engine, at } = setup(
      "enum class Mode { slow, fast }; void move(Mode mode, int speed); void run() { move(|); }"
    )
    expect(items().map((s) => s.insertText)).toEqual([
      "Mode::slow",
      "Mode::fast",
    ])
    expect(
      engine.signatures("src/main.cpp", at)?.signatures[0].label
    ).toContain("Mode mode")
  })
  it("finds source and SDK definitions with UTF-16 locations and hover docs", () => {
    const { engine, at } = setup(
      "// 🤖\nvex::motor left{1}; void run() { left.sp|in(vex::fwd); }"
    )
    const symbol = engine.symbolAt("src/main.cpp", at)[0]
    expect(symbol.name).toBe("spin")
    expect(symbol.path).toBe("sdk/vex_motor.h")
    expect(symbol.position!.line).toBeGreaterThan(1)
    expect(engine.describe("src/main.cpp", at)).toContain("```cpp")
    const source = setup("// 🤖\nint value; void run() { val|ue; }")
    expect(
      source.engine.symbolAt("src/main.cpp", source.at)[0].position
    ).toEqual({ line: 1, character: 4 })
  })
  it("keeps multiline block comments intact through the closing delimiter or EOF", () => {
    const comment = "/* first line\n * you're inside a comment\n */"
    expect(tokenize(comment + "\nint value;")[0]).toEqual({
      value: comment,
      start: 0,
      end: comment.length,
      kind: "comment",
    })
    const unfinished = "/* unfinished\nsecond line\nint fake;"
    expect(tokenize(unfinished)).toEqual([
      { value: unfinished, start: 0, end: unfinished.length, kind: "comment" },
    ])
  })
  it("tokenizes incomplete input without inventing declarations from comments", () => {
    expect(
      indexSource(
        "main.cpp",
        '// vex::motor fake;\nconst char* s = R"(vex::motor fake;)";'
      ).symbols.map((s) => s.name)
    ).not.toContain("fake")
    expect(tokenize("/* unfinished").at(-1)?.kind).toBe("comment")
  })
})

it("follows namespace imports through the template's included headers", () => {
  const { labels } = setup('#include "vex.h"\nvoid run() { left.| }', vex, {
    "include/vex.h": '#include "robot-config.h"\nusing namespace vex;',
    "include/robot-config.h": "using namespace vex; extern motor left;",
  })
  expect(labels()).toContain("spin")
})

it("recognizes PROS controller constructor arguments as instance initialization", () => {
  expect(
    setup(
      "pros::Controller master(pros::E_CONTROLLER_MASTER); void run() { master.| }",
      pros
    ).labels()
  ).toContain("get_analog")
})

it("offers configured vision signatures when a method expects a signature object", () => {
  const { labels } = setup(
    "vex::vision camera; vex::vision::signature BLUE{1}; void run() { camera.takeSnapshot(|); }"
  )
  expect(labels()).toContain("BLUE")
})
