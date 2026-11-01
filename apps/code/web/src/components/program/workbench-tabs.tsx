import { makefileIcons } from "@/lib/makefile-icons"
import { useDndContext } from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { XIcon } from "@phosphor-icons/react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { Button } from "@v5x/ui/components/button"
import { TabsList, TabsTrigger } from "@v5x/ui/components/tabs"
import { cn } from "@v5x/ui/lib/utils"

import { treeStyle } from "./workbench-tree"

export function TabChip({ path }: { path: string }) {
  const name = path.split("/").at(-1) ?? path
  const { model } = useFileTree({
    paths: [name],
    initialSelectedPaths: [name],
    density: "compact",
    icons: makefileIcons,
    unsafeCSS: `[data-type="item"][data-item-selected="true"]:before {
      content: ""; position: absolute; inset: 0; pointer-events: none;
      border-radius: var(--trees-border-radius);
      outline: var(--trees-focus-ring-width) solid var(--trees-selected-focused-border-color);
      outline-offset: var(--trees-focus-ring-offset);
    }`,
  })
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none w-48 overflow-hidden rounded-md shadow-overlay"
    >
      <FileTree
        model={model}
        style={
          {
            ...treeStyle,
            height: "24px",
            "--trees-bg-override": "transparent",
          } as React.CSSProperties
        }
      />
    </div>
  )
}

export function SortableTabsList(props: React.ComponentProps<typeof TabsList>) {
  const { active } = useDndContext()
  return (
    <TabsList
      {...props}
      onKeyDown={(event) => {
        if (active) event.preventBaseUIHandler()
      }}
    />
  )
}

export function SortableFileTab({
  id,
  path,
  dirty,
  focused,
  dropBefore,
  onClose,
}: {
  id: string
  path: string
  dirty: boolean
  /** False in a group that is not the active one, so its selected tab reads quieter. */
  focused: boolean
  dropBefore: boolean
  onClose: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { path } })

  return (
    <div
      ref={setNodeRef}
      data-tab-path={path}
      className={cn(
        "group/tab relative flex shrink-0 items-center",
        isDragging && "z-10",
        dropBefore &&
          "before:absolute before:inset-y-1 before:-left-px before:w-0.5 before:rounded-full before:bg-primary"
      )}
      style={{
        transform: CSS.Transform.toString(
          transform ? { ...transform, y: 0 } : null
        ),
        transition,
      }}
    >
      <TabsTrigger
        ref={setActivatorNodeRef}
        {...listeners}
        onKeyDown={(event) => {
          listeners?.onKeyDown(event)
          if (isDragging) event.preventBaseUIHandler()
        }}
        aria-describedby={attributes["aria-describedby"]}
        aria-roledescription="sortable tab"
        value={path}
        title={path}
        className={cn(
          "h-7 flex-none touch-pan-y rounded-lg border-0 px-3 pr-8 font-normal text-muted-foreground transition-[translate,box-shadow,color] duration-100 after:hidden active:translate-y-px",
          "data-active:bg-secondary! data-active:text-foreground data-active:shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.3),0_0_0_1px_color-mix(in_oklab,var(--secondary),white_7%)]!",
          !focused && "data-active:bg-secondary/50! data-active:shadow-none!",
          isDragging && "opacity-50"
        )}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault()
            onClose()
          }
        }}
      >
        {path.split("/").at(-1)}
        {dirty && (
          <span
            className="size-1.5 rounded-full bg-current"
            role="img"
            aria-label="Unsaved changes"
          />
        )}
      </TabsTrigger>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${path}`}
        className="absolute right-1 size-5 text-muted-foreground"
        onClick={onClose}
      >
        <XIcon />
      </Button>
    </div>
  )
}

// Sortable ids are unique across groups, since one file can be open in several.
export const tabId = (groupId: string, path: string) => `${groupId}|${path}`
