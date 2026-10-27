import { describe, expect, it } from "vitest"
import { hoverContent } from "../src/lib/hover-content"

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
