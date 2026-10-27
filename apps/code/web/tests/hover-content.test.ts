import { describe, expect, it } from "vitest"
import { hoverContent, inlineSegments } from "../src/lib/hover-content"

describe("inline documentation text", () => {
  it("keeps a namespace-qualified constant in one code span", () => {
    expect(
      inlineSegments("'pros::E_MOTOR_BRAKE_COAST' 'pros::E_MOTOR_BRAKE_HOLD'")
    ).toEqual([
      { text: "'" },
      { text: "pros::E_MOTOR_BRAKE_COAST", style: "code" },
      { text: "' '" },
      { text: "pros::E_MOTOR_BRAKE_HOLD", style: "code" },
      { text: "'" },
    ])
  })
  it("styles parameter names, calls, and bold text without touching prose", () => {
    expect(
      inlineSegments(
        "`brake_type`: the 'brake mode' of **drive**, see pros::delay() and E_MOTOR_BRAKE_INVALID."
      )
    ).toEqual([
      { text: "brake_type", style: "code" },
      { text: ": the 'brake mode' of " },
      { text: "drive", style: "strong" },
      { text: ", see " },
      { text: "pros::delay()", style: "code" },
      { text: " and " },
      { text: "E_MOTOR_BRAKE_INVALID", style: "code" },
      { text: "." },
    ])
  })
})

describe("hover documentation", () => {
  it("separates API markdown signatures, documentation, and source paths", () => {
    expect(
      hoverContent({
        kind: "markdown",
        value:
          '### class Drive\nprovided by "include/EZ-Template/drive/drive.hpp"\n\n---\n\n```cpp\n// In namespace ez\nclass Drive {};\n```\n\nControls the **drive**.',
      })
    ).toEqual({
      source: "include/EZ-Template/drive/drive.hpp",
      blocks: [
        { kind: "heading", text: "class Drive" },
        {
          kind: "code",
          language: "cpp",
          text: "// In namespace ez\nclass Drive {};",
        },
        { kind: "text", text: "Controls the **drive**." },
      ],
    })
  })
  it("supports plaintext responses from API metadata", () => {
    const result = hoverContent(
      'class Drive\nprovided by "include/drive.hpp"\n\n// In namespace ez\nclass Drive {}'
    )
    expect(result.source).toBe("include/drive.hpp")
    expect(result.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "code",
    ])
  })
  it("renders structured API paragraphs, parameters and errors as separate blocks", () => {
    expect(
      hoverContent(`Sets motor voltage.

A second paragraph.

### Parameters

- \`voltage\`: The new voltage.
- \`reversed\`: Whether to reverse.

### Returns

1 on success.

Errors:
- \`ENODEV\`: Not a motor.`).blocks
    ).toEqual([
      { kind: "text", text: "Sets motor voltage." },
      { kind: "text", text: "A second paragraph." },
      { kind: "heading", text: "Parameters" },
      {
        kind: "list",
        text: "`voltage`: The new voltage.\n`reversed`: Whether to reverse.",
      },
      { kind: "heading", text: "Returns" },
      { kind: "text", text: "1 on success." },
      { kind: "text", text: "Errors:" },
      { kind: "list", text: "`ENODEV`: Not a motor." },
    ])
  })
  it("preserves marked code and literal HTML as text", () => {
    const result = hoverContent([
      { language: "cpp", value: "void drive();" },
      "<script>alert(1)</script>",
    ])
    expect(result.blocks).toEqual([
      { kind: "code", language: "cpp", text: "void drive();" },
      { kind: "text", text: "<script>alert(1)</script>" },
    ])
  })
})
