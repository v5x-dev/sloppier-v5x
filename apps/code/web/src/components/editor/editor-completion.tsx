import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import "@vscode/codicons/dist/codicon.css"
import type { EditorChangeEvent } from "@pierre/diffs/edit"
import { cn } from "@workspace/ui/lib/utils"
import {
  expandSnippet,
  filterItems,
  inCommentOrString,
  isWordChar,
  itemLabel,
  wordStartAt,
  type Match,
} from "@/lib/completion"
import {
  RequestCancelled,
  type CompletionItem,
  type SignatureHelp,
} from "@/lib/language-service"
import type { PierreCollaboration } from "@/lib/pierre-collaboration"
import { useLanguageService } from "./language-session"

type Menu = {
  items: CompletionItem[]
  matches: Match[]
  selected: number
  wordStart: number
  /** The word used for this query; incomplete lists re-query when it changes. */
  queried: string
  incomplete: boolean
}
type Anchor = { left: number; top: number; bottom: number }

// VS Code's completion item icons (codicons) and default dark theme colors,
// indexed by completion kind.
const PURPLE = "#b180d7"
const BLUE = "#75beff"
const ORANGE = "#ee9d28"
const KINDS: Record<number, [string, string?]> = {
  1: ["symbol-text"],
  2: ["symbol-method", PURPLE],
  3: ["symbol-method", PURPLE],
  4: ["symbol-method", PURPLE],
  5: ["symbol-field", BLUE],
  6: ["symbol-variable", BLUE],
  7: ["symbol-class", ORANGE],
  8: ["symbol-interface", BLUE],
  9: ["symbol-namespace"],
  10: ["symbol-property"],
  11: ["symbol-ruler"],
  12: ["symbol-enum", ORANGE],
  13: ["symbol-enum", ORANGE],
  14: ["symbol-keyword"],
  15: ["symbol-snippet"],
  16: ["symbol-color"],
  17: ["symbol-file"],
  18: ["references"],
  19: ["symbol-folder"],
  20: ["symbol-enum-member", BLUE],
  21: ["symbol-constant"],
  22: ["symbol-structure"],
  23: ["symbol-event", ORANGE],
  24: ["symbol-operator"],
  25: ["symbol-type-parameter"],
}
let measureCanvas: HTMLCanvasElement | undefined
const PAIRS = new Set(["()", "[]", "{}", "<>", '""', "''"])
const ROWS = 12

// Header comments carry Doxygen commands that add noise to a short popup.
const documentation = (value?: string | { value: string }) =>
  (typeof value === "string" ? value : value?.value)
    ?.replace(
      /[\\@](ingroup|enum|class|struct|union|typedef|fn|var|def|namespace)\s+\S+\s*/g,
      ""
    )
    .replace(/[\\@](brief|details)\s*/g, "")
    .trim()

/**
 * VS Code-style completion for a collaborative Pierre editor: quick
 * suggestions while typing, member and argument triggers, Ctrl+Space,
 * client-side refiltering, and signature help.
 */
export function useEditorCompletion(
  binding: PierreCollaboration,
  path: string
) {
  const client = useLanguageService()
  const wrapper = useRef<HTMLDivElement>(null)
  const [shownMenu, setMenuState] = useState<Menu | null>(null)
  const [signature, setSignatureState] = useState<SignatureHelp | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const state = useRef({
    menu: null as Menu | null,
    signature: null as SignatureHelp | null,
    request: null as AbortController | null,
    signatureRequest: null as AbortController | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    accepting: false,
  }).current

  const setMenu = (next: Menu | null) => {
    state.menu = next
    setMenuState(next)
  }
  const setSignature = (next: SignatureHelp | null) => {
    state.signature = next
    setSignatureState(next)
  }
  const caret = () => {
    const selections = binding.editor?.getViewState().selections
    const selection = selections?.length === 1 ? selections[0] : undefined
    if (!selection) return null
    const start = binding.document.offsetAt(selection.start)
    return start === binding.document.offsetAt(selection.end) ? start : null
  }
  const close = () => {
    clearTimeout(state.timer)
    state.request?.abort()
    if (state.menu) setMenu(null)
  }

  const measure = () => {
    const host = wrapper.current
    if (!host) return
    let element: Element | null = null
    for (const node of host.querySelectorAll("*")) {
      element = node.shadowRoot?.querySelector("[data-caret]") ?? null
      if (element) break
    }
    const rect = element?.getBoundingClientRect()
    if (!element || !rect?.height) return setAnchor(null)
    // Like VS Code, the menu stays aligned to the start of the word.
    const offset = caret()
    const typed =
      state.menu && offset !== null ? offset - state.menu.wordStart : 0
    const font = getComputedStyle(element.parentElement ?? element).font
    const context = (measureCanvas ??=
      document.createElement("canvas")).getContext("2d")
    let width = 0
    if (context && typed > 0) {
      context.font = font
      width = context.measureText(
        binding.document.getText().slice(offset! - typed, offset!)
      ).width
    }
    setAnchor({ left: rect.left - width, top: rect.top, bottom: rect.bottom })
  }

  const refilter = (menu = state.menu) => {
    if (!menu) return
    const offset = caret()
    const text = binding.document.getText()
    if (
      offset === null ||
      offset < menu.wordStart ||
      wordStartAt(text, offset) !== menu.wordStart
    )
      return close()
    const word = text.slice(menu.wordStart, offset)
    const matches = filterItems(menu.items, word)
    if (!matches.length && !menu.incomplete) return close()
    const selected = matches.indexOf(
      matches.find((m) => m.item === menu.matches[menu.selected]?.item)!
    )
    setMenu({ ...menu, matches, selected: Math.max(0, selected) })
    if (menu.incomplete && word !== menu.queried) {
      clearTimeout(state.timer)
      state.timer = setTimeout(() => complete(), 50)
    }
    requestAnimationFrame(measure)
  }

  const complete = () => {
    if (!client?.isReady) return
    const offset = caret()
    if (offset === null) return close()
    state.request?.abort()
    const controller = new AbortController()
    state.request = controller
    const text = binding.document.getText()
    const wordStart = wordStartAt(text, offset)
    const lineStart = text.lastIndexOf("\n", wordStart - 1) + 1
    const prefix = text.slice(lineStart, wordStart)
    client
      .completion(path, binding.document.positionAt(offset), controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        // Discard results whose word moved; refiltering covers typing inside it.
        const now = binding.document.getText()
        if (now.slice(lineStart, wordStart) !== prefix) return close()
        const menu: Menu = {
          items: list.items,
          matches: [],
          selected: 0,
          wordStart,
          queried: text.slice(wordStart, offset),
          incomplete: list.isIncomplete,
        }
        if (!list.items.length) return close()
        refilter(menu)
      })
      .catch((error) => {
        if (!(error instanceof RequestCancelled)) close()
      })
  }

  const signatureHelp = () => {
    if (!client?.isReady) return
    const offset = caret()
    if (offset === null) return setSignature(null)
    state.signatureRequest?.abort()
    const controller = new AbortController()
    state.signatureRequest = controller
    client
      .signatureHelp(
        path,
        binding.document.positionAt(offset),
        controller.signal
      )
      .then((help) => {
        if (controller.signal.aborted) return
        setSignature(help?.signatures.length ? help : null)
        requestAnimationFrame(measure)
      })
      .catch(() => {})
  }

  const accept = (item: CompletionItem) => {
    const editor = binding.editor
    const offset = caret()
    if (!editor || offset === null || !state.menu) return close()
    const document = binding.document
    const edit = item.textEdit
    const start = edit
      ? document.offsetAt(edit.range.start)
      : state.menu.wordStart
    // Characters typed after the request extend the replaced range.
    const end = Math.max(
      offset,
      edit ? document.offsetAt(edit.range.end) : offset
    )
    const raw = edit?.newText ?? item.insertText ?? itemLabel(item)
    const { text, selection } =
      item.insertTextFormat === 2
        ? expandSnippet(raw)
        : { text: raw, selection: [raw.length, raw.length] as const }
    const additional = item.additionalTextEdits ?? []
    let shift = 0
    for (const extra of additional)
      if (document.offsetAt(extra.range.start) < start)
        shift +=
          extra.newText.length -
          (document.offsetAt(extra.range.end) -
            document.offsetAt(extra.range.start))
    close()
    state.accepting = true
    binding.undo.stopCapturing()
    try {
      // One applyEdits call is one Yjs transaction, so one undo step.
      editor.applyEdits([
        {
          range: {
            start: document.positionAt(start),
            end: document.positionAt(end),
          },
          newText: text,
        },
        ...additional,
      ])
    } finally {
      binding.undo.stopCapturing()
      state.accepting = false
    }
    editor.setSelections([
      {
        start: document.positionAt(start + shift + selection[0]),
        end: document.positionAt(start + shift + selection[1]),
        direction: "forward",
      },
    ])
    if (text.includes("(")) signatureHelp()
    if (item.retrigger) complete()
  }

  const onLocalChange = (
    event: EditorChangeEvent<"file", undefined, { name: string }>
  ) => {
    if (state.accepting || binding.document.applyingRemote || !client) return
    const changes = event.changes
    // Let Pierre settle the caret after this change before reading it.
    setTimeout(() => {
      if (changes.length !== 1) return close()
      const typed = changes[0].text
      const char = PAIRS.has(typed) ? typed[0] : typed.at(-1)
      const offset = caret()
      if (offset === null) return close()
      const text = binding.document.getText()
      if (state.menu) {
        if (!typed || [...typed].every(isWordChar)) refilter()
        else if (char && client.triggerCharacters.has(char)) complete()
        else close()
      } else if (char && typed.length <= 2) {
        if (client.triggerCharacters.has(char)) complete()
        else if (
          isWordChar(char) &&
          !/\d/.test(text[wordStartAt(text, offset)] ?? "") &&
          !inCommentOrString(text, offset)
        ) {
          clearTimeout(state.timer)
          state.timer = setTimeout(() => complete(), 50)
        }
      }
      if (char && client.signatureTriggerCharacters.has(char)) signatureHelp()
      else if (state.signature) signatureHelp()
    })
  }

  useEffect(() => {
    const host = wrapper.current
    if (!host) return
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const consume = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (event.code === "Space" && event.ctrlKey && !event.altKey) {
        consume()
        if (event.shiftKey) signatureHelp()
        else complete()
        return
      }
      const menu = state.menu
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey
      if (menu && plain && menu.matches.length) {
        const count = menu.matches.length
        const move = {
          ArrowDown: 1,
          ArrowUp: -1,
          PageDown: ROWS - 1,
          PageUp: 1 - ROWS,
        }[event.key]
        if (move) {
          consume()
          const next = menu.selected + move
          setMenu({
            ...menu,
            selected:
              Math.abs(move) === 1
                ? (next + count) % count
                : Math.min(count - 1, Math.max(0, next)),
          })
          return
        }
        if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
          consume()
          accept(menu.matches[menu.selected].item)
          return
        }
      }
      const help = state.signature
      if (
        !menu &&
        help &&
        plain &&
        help.signatures.length > 1 &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        consume()
        const count = help.signatures.length
        const step = event.key === "ArrowDown" ? 1 : -1
        setSignature({
          ...help,
          activeSignature: ((help.activeSignature ?? 0) + step + count) % count,
        })
        return
      }
      if (event.key === "Escape" && (menu || state.signature)) {
        consume()
        if (menu) close()
        else setSignature(null)
        return
      }
      // Caret movement keeps the menu only while the caret stays in the word.
      if (/^(Arrow|Home|End|Page)/.test(event.key))
        setTimeout(() => {
          refilter()
          if (state.signature) signatureHelp()
        })
    }
    const pointer = () => {
      close()
      setSignature(null)
    }
    const blur = (event: FocusEvent) => {
      if (!host.contains(event.relatedTarget as Node | null)) pointer()
    }
    const scroll = () => {
      if (state.menu || state.signature) requestAnimationFrame(measure)
    }
    host.addEventListener("keydown", keydown, true)
    host.addEventListener("pointerdown", pointer, true)
    host.addEventListener("focusout", blur)
    window.addEventListener("scroll", scroll, true)
    return () => {
      host.removeEventListener("keydown", keydown, true)
      host.removeEventListener("pointerdown", pointer, true)
      host.removeEventListener("focusout", blur)
      window.removeEventListener("scroll", scroll, true)
    }
  })
  useEffect(
    () => () => {
      clearTimeout(state.timer)
      state.request?.abort()
      state.signatureRequest?.abort()
    },
    [state]
  )

  const popup =
    anchor && (shownMenu?.matches.length || signature)
      ? createPortal(
          <CompletionPopup
            anchor={anchor}
            menu={shownMenu}
            signature={signature}
            onAccept={accept}
            onSelect={(selected) =>
              shownMenu && setMenu({ ...shownMenu, selected })
            }
          />,
          document.body
        )
      : null
  return { wrapper, onLocalChange, popup }
}

function CompletionPopup({
  anchor,
  menu,
  signature,
  onAccept,
  onSelect,
}: {
  anchor: Anchor
  menu: Menu | null
  signature: SignatureHelp | null
  onAccept: (item: CompletionItem) => void
  onSelect: (index: number) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const selected = menu?.matches[menu.selected]
  useLayoutEffect(() => {
    list.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest" })
  }, [menu?.selected, menu?.matches])
  const below = window.innerHeight - anchor.bottom > 320
  const docs = selected && documentation(selected.item.documentation)
  const active = signature?.signatures[signature.activeSignature ?? 0]
  const parameter =
    active?.parameters?.[
      active.activeParameter ?? signature?.activeParameter ?? 0
    ]?.label
  const [from, to] =
    !active || parameter === undefined
      ? [0, 0]
      : typeof parameter === "string"
        ? [
            active.label.indexOf(parameter),
            active.label.indexOf(parameter) + parameter.length,
          ]
        : parameter
  return (
    <div
      className="pointer-events-none fixed z-50 flex flex-col gap-1 font-mono text-xs"
      style={{
        left: Math.min(anchor.left, window.innerWidth - 520),
        ...(below
          ? { top: anchor.bottom + 2 }
          : {
              bottom: window.innerHeight - anchor.top + 2,
              flexDirection: "column-reverse",
            }),
      }}
      // Clicks inside the popup must not move the editor caret.
      onPointerDown={(event) => event.preventDefault()}
    >
      {active && !menu?.matches.length && (
        <div className="pointer-events-auto max-w-[520px] rounded-md bg-popover px-2 py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {signature.signatures.length > 1 && (
            <span className="mr-2 text-muted-foreground">
              {(signature.activeSignature ?? 0) + 1}/
              {signature.signatures.length}
            </span>
          )}
          {from >= 0 && to > from ? (
            <>
              {active.label.slice(0, from)}
              <span className="font-semibold text-primary underline">
                {active.label.slice(from, to)}
              </span>
              {active.label.slice(to)}
            </>
          ) : (
            active.label
          )}
        </div>
      )}
      {menu && menu.matches.length > 0 && (
        <div className="pointer-events-auto flex w-[520px] flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
          <div
            ref={list}
            role="listbox"
            aria-label="Suggestions"
            className="overflow-y-auto py-0.5"
            style={{ maxHeight: `calc(${ROWS} * 1.5rem + 0.25rem)` }}
          >
            {menu.matches.map((match, index) => {
              const label = itemLabel(match.item)
              const [icon, color] = KINDS[match.item.kind ?? 1] ?? [
                "symbol-misc",
              ]
              return (
                <div
                  key={index}
                  role="option"
                  aria-selected={index === menu.selected}
                  className={cn(
                    "flex h-6 cursor-default items-center gap-2 px-2",
                    index === menu.selected &&
                      "bg-accent text-accent-foreground"
                  )}
                  onPointerMove={() =>
                    index !== menu.selected && onSelect(index)
                  }
                  onClick={() => onAccept(match.item)}
                >
                  <i
                    aria-hidden
                    className={`codicon codicon-${icon} shrink-0`}
                    style={{ fontSize: 14, color }}
                  />
                  <span className="shrink-0">
                    {[...label].map((char, i) =>
                      match.positions.includes(i) ? (
                        <span key={i} className="font-semibold text-primary">
                          {char}
                        </span>
                      ) : (
                        char
                      )
                    )}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {match.item.labelDetails?.detail}
                  </span>
                  <span className="ml-auto shrink-0 truncate pl-2 text-muted-foreground">
                    {match.item.labelDetails?.description ?? ""}
                  </span>
                </div>
              )
            })}
          </div>
          {/* Reserve the same space for every selection, including undocumented
              items, so wrapping cannot move the list when it opens above the caret. */}
          <div className="h-32 shrink-0 overflow-y-auto border-t px-2 py-1.5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {selected?.item.detail && (
              <div className="text-foreground">{selected.item.detail}</div>
            )}
            {docs && <div className="mt-1 font-sans">{docs}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
