import { File } from "@pierre/diffs/react"
import { FileCodeIcon } from "@phosphor-icons/react"
import { editorThemeOptions } from "@/lib/editor-theme"
import { hoverContent, type HoverContents } from "@/lib/hover-content"

const proseStyle = { fontFamily: '"DM Sans Variable", sans-serif' }

const codeOptions = {
  ...editorThemeOptions,
  disableLineNumbers: true,
  overflow: "scroll" as const,
  unsafeCSS: `${editorThemeOptions.unsafeCSS}
    :host { --diffs-font-size: 12px; --diffs-line-height: 20px; --diffs-bg: transparent; }
    pre { --diffs-bg: transparent; --diffs-dark-bg: transparent; --diffs-light-bg: transparent; }
    [data-code] { padding: 0 !important; }
  `,
}

function InlineText({ text }: { text: string }) {
  return text
    .split(
      /(`[^`]+`|\*\*[^*]+\*\*|\b\w+(?:::\w+)*\(\)|\bE[A-Z0-9_]{2,}\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b)/g
    )
    .map((part, index) =>
      (part.startsWith("`") && part.endsWith("`")) ||
      /^(?:\w+(?:::\w+)*\(\)|E[A-Z0-9_]{2,}|[A-Z][A-Z0-9]*_[A-Z0-9_]+)$/.test(
        part
      ) ? (
        <code
          key={index}
          className="rounded bg-foreground/5 px-1 py-0.5 font-mono text-[0.95em] text-foreground"
        >
          {part.startsWith("`") ? part.slice(1, -1) : part}
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

export function HoverDocumentation({
  contents,
  compact = false,
}: {
  contents: HoverContents
  compact?: boolean
}) {
  const { source, blocks } = hoverContent(contents)
  return (
    <>
      <div
        style={proseStyle}
        className={`font-documentation leading-relaxed [overflow-wrap:anywhere] ${compact ? "space-y-2 text-xs" : "space-y-3 px-4 py-3 text-[13px]"}`}
      >
        {blocks.map((block, index) =>
          block.kind === "code" ? (
            <div
              key={index}
              className="min-w-0 overflow-x-auto rounded-md bg-background/50 px-3 py-2 ring-1 ring-foreground/5"
            >
              <File
                file={{ name: "hover.cpp", contents: block.text }}
                options={codeOptions}
              />
            </div>
          ) : block.kind === "heading" ? (
            <div
              key={index}
              style={proseStyle}
              className="text-xs font-semibold text-foreground"
            >
              <InlineText text={block.text} />
            </div>
          ) : block.kind === "list" ? (
            <ul
              style={proseStyle}
              key={index}
              className="list-disc space-y-1.5 pl-4 text-muted-foreground marker:text-foreground/35"
            >
              {block.text.split("\n").map((item, itemIndex) => (
                <li key={itemIndex} className="pl-1">
                  <InlineText text={item} />
                </li>
              ))}
            </ul>
          ) : (
            <p
              style={proseStyle}
              key={index}
              className="whitespace-pre-wrap text-muted-foreground"
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
