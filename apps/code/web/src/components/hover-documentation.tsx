import { File } from "@pierre/diffs/react"
import { FileCodeIcon } from "@phosphor-icons/react"
import { editorThemeOptions } from "@/lib/editor-theme"
import { hoverContent, type HoverContents } from "@/lib/hover-content"

const codeOptions = {
  ...editorThemeOptions,
  disableLineNumbers: true,
  overflow: "wrap" as const,
  unsafeCSS: `${editorThemeOptions.unsafeCSS}
    :host { --diffs-font-size: 12px; --diffs-line-height: 20px; --diffs-bg: transparent; }
    pre { --diffs-bg: transparent; --diffs-dark-bg: transparent; --diffs-light-bg: transparent; }
    [data-code] { padding: 0 !important; }
  `,
}

function InlineText({ text }: { text: string }) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={index}
        className="rounded bg-foreground/5 px-1 py-0.5 font-mono text-[0.95em] text-foreground"
      >
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  )
}

export function HoverDocumentation({ contents }: { contents: HoverContents }) {
  const { source, blocks } = hoverContent(contents)
  return (
    <>
      <div className="space-y-3 px-4 py-3">
        {blocks.map((block, index) =>
          block.kind === "code" ? (
            <div
              key={index}
              className="min-w-0 rounded-md bg-background/50 px-3 py-2 ring-1 ring-foreground/5"
            >
              <File
                file={{ name: "hover.cpp", contents: block.text }}
                options={codeOptions}
              />
            </div>
          ) : block.kind === "heading" ? (
            <div
              key={index}
              className="font-mono text-[13px] leading-5 font-medium text-foreground"
            >
              <InlineText text={block.text} />
            </div>
          ) : (
            <p
              key={index}
              className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
            >
              <InlineText text={block.text} />
            </p>
          )
        )}
      </div>
      {source && (
        <div
          title={source}
          className="flex min-w-0 items-center gap-2 border-t border-foreground/8 bg-foreground/[0.025] px-4 py-2 text-xs text-muted-foreground"
        >
          <FileCodeIcon className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{source}</span>
        </div>
      )}
    </>
  )
}
