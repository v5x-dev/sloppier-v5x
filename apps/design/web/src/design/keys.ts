// The editor's keyboard shortcuts: one registry of every action, the keys each one uses by
// default, and the rules for reading a key press, rebinding an action, and spotting clashes.
// Everything here is a pure function. key-store.ts keeps a person's changes in their browser.
//
// A combo is a key with its modifiers, written as lower-case tokens joined by "+": "mod"
// (Ctrl or Cmd), "alt", "shift", then the key, as in "mod+shift+z". A symbol key already
// says whether Shift was held ("?" or "!"), so Shift is left out of symbols.

export type ActionGroup = "Select" | "Move and turn" | "Edit" | "Place and view"

export type ActionDef = {
  id: string
  group: ActionGroup
  label: string
  /** Each combo that triggers the action. Rebinding replaces the whole list. */
  defaults: readonly string[]
}

const SWATCH_KEYS = 8

/**
 * Every shortcut in the editor. A new tool adds one entry here and it is rebindable, shows in
 * the reference, and is checked for clashes, with no other change.
 */
export const ACTIONS: readonly ActionDef[] = [
  {
    id: "selectAll",
    group: "Select",
    label: "Select everything",
    defaults: ["mod+a"],
  },
  {
    id: "cancel",
    group: "Select",
    label: "Clear the selection, or stop placing",
    defaults: ["Escape"],
  },
  {
    id: "moveMode",
    group: "Move and turn",
    label: "Move handles",
    defaults: ["w"],
  },
  {
    id: "turnMode",
    group: "Move and turn",
    label: "Turn rings",
    defaults: ["e"],
  },
  {
    id: "localAxes",
    group: "Move and turn",
    label: "Use the Part's own axes",
    defaults: ["l"],
  },
  {
    id: "duplicate",
    group: "Edit",
    label: "Duplicate",
    defaults: ["mod+d"],
  },
  {
    id: "delete",
    group: "Edit",
    label: "Delete",
    defaults: ["Delete", "Backspace"],
  },
  {
    id: "undo",
    group: "Edit",
    label: "Undo",
    defaults: ["mod+z"],
  },
  {
    id: "redo",
    group: "Edit",
    label: "Redo",
    defaults: ["mod+shift+z", "mod+y"],
  },
  ...Array.from({ length: SWATCH_KEYS }, (_, i): ActionDef => ({
    id: `recolor${i + 1}`,
    group: "Edit",
    label: `Recolour to swatch ${i + 1}`,
    defaults: [String(i + 1)],
  })),
  {
    id: "turnPlacing",
    group: "Place and view",
    label: "Turn the Part being placed",
    defaults: ["r"],
  },
  {
    id: "frame",
    group: "Place and view",
    label: "Frame everything",
    defaults: ["f"],
  },
  {
    id: "projection",
    group: "Place and view",
    label: "Switch between perspective and orthographic",
    defaults: ["o"],
  },
  {
    id: "shortcuts",
    group: "Place and view",
    label: "Show this list",
    defaults: ["?"],
  },
]

export type ActionId = string
export type Bindings = Readonly<Record<ActionId, readonly string[]>>
/** What a person changed: only the actions whose combos differ from the defaults. */
export type Overrides = Readonly<Record<ActionId, readonly string[]>>

export const ACTION_IDS: ReadonlySet<string> = new Set(ACTIONS.map((a) => a.id))

export type KeyEventLike = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MODIFIER_ONLY_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "OS",
  "AltGraph",
  "CapsLock",
  "Fn",
])

// Keys that are only modifiers, or that the page and dialogs need for themselves.
const UNBINDABLE_KEYS = new Set([
  ...MODIFIER_ONLY_KEYS,
  "Tab",
  "Enter",
  "Unidentified",
  "Dead",
  "Process",
  "ContextMenu",
])

// Combos the browser keeps for itself (tabs, windows, reload, address bar, print, devtools).
// A page cannot take these back, so binding one would never work.
const BROWSER_RESERVED = new Set([
  "mod+t",
  "mod+w",
  "mod+n",
  "mod+r",
  "mod+l",
  "mod+p",
  "mod+q",
  "mod+shift+t",
  "mod+shift+n",
  "mod+shift+r",
  "mod+shift+i",
  "mod+shift+j",
  "mod+shift+c",
  "f5",
  "f12",
])

const MODIFIER_ORDER = ["mod", "alt", "shift"] as const
const MODIFIER_LABELS: Record<(typeof MODIFIER_ORDER)[number], string> = {
  mod: "Ctrl",
  alt: "Alt",
  shift: "Shift",
}
const KEY_LABELS: Record<string, string> = {
  delete: "Del",
  escape: "Esc",
  space: "Space",
  backspace: "Backspace",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
}

/** The combo a key press makes, or undefined when the key cannot be bound. */
export function comboFromEvent(event: KeyEventLike): string | undefined {
  const raw = event.key
  if (!raw || UNBINDABLE_KEYS.has(raw)) return undefined
  const isChar = raw.length === 1
  const isLetter = isChar && /^[a-z]$/i.test(raw)
  let key = isChar ? raw.toLowerCase() : raw
  if (key === " ") key = "space"
  const mods: string[] = []
  if (event.ctrlKey || event.metaKey) mods.push("mod")
  if (event.altKey) mods.push("alt")
  if (event.shiftKey && (isLetter || !isChar)) mods.push("shift")
  return [...mods, key].join("+")
}

/** Splits a combo into its modifiers and key. A "+" key is written as the last token. */
export function parseCombo(
  combo: string
): { mods: string[]; key: string } | undefined {
  if (combo === "") return undefined
  const key = combo.endsWith("+")
    ? "+"
    : combo.slice(combo.lastIndexOf("+") + 1)
  const head = combo.slice(0, combo.length - key.length)
  const mods = head.split("+").filter((token) => token !== "")
  if (
    key === "" ||
    mods.some((m) => !(MODIFIER_ORDER as readonly string[]).includes(m))
  )
    return undefined
  if (new Set(mods).size !== mods.length) return undefined
  return { mods, key }
}

/** Whether a combo is one a person may bind, with the reason if not. */
export function checkCombo(
  combo: string
): { ok: true; combo: string } | { ok: false; message: string } {
  const parsed = parseCombo(combo)
  if (!parsed) return { ok: false, message: "That key can't be used." }
  if (UNBINDABLE_KEYS.has(parsed.key))
    return { ok: false, message: "That key can't be used." }
  const canonical = [
    ...MODIFIER_ORDER.filter((m) => parsed.mods.includes(m)),
    parsed.key,
  ].join("+")
  if (canonical !== combo)
    return { ok: false, message: "That key can't be used." }
  if (BROWSER_RESERVED.has(combo))
    return {
      ok: false,
      message: `${labelOf([combo])} is reserved by the browser.`,
    }
  return { ok: true, combo }
}

/** A readable name for one combo, such as "Ctrl Shift Z" or "Del". */
export function comboLabel(combo: string): string {
  const parsed = parseCombo(combo)
  if (!parsed) return combo
  const mods = MODIFIER_ORDER.filter((m) => parsed.mods.includes(m)).map(
    (m) => MODIFIER_LABELS[m]
  )
  const lower = parsed.key.toLowerCase()
  const key =
    KEY_LABELS[lower] ??
    (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key)
  return [...mods, key].join(" ")
}

/** Keys that only hold a modifier. Pressing one on its own never ends a rebinding. */
export function isModifierOnly(key: string): boolean {
  return MODIFIER_ONLY_KEYS.has(key)
}

/** The action a key press triggers, if any. */
export function actionForEvent(
  event: KeyEventLike,
  bindings: Bindings
): ActionId | undefined {
  const combo = comboFromEvent(event)
  return combo === undefined ? undefined : actionForCombo(bindings, combo)
}

/** The first key an action uses, for hints and tooltips that have room for one. */
export function primaryLabel(bindings: Bindings, id: ActionId): string {
  const list: readonly string[] = bindings[id]
  return list.length === 0 ? "" : comboLabel(list[0])
}

/** The tokens to show as keys for an action, one group per combo. */
export function labelOf(combos: readonly string[]): string {
  return combos.map(comboLabel).join(" or ")
}

export function defaultBindings(): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.defaults]]))
}

/** Actions other than `id` that already use one of these combos. */
export function clashesFor(
  bindings: Bindings,
  id: ActionId,
  combos: readonly string[]
): ActionId[] {
  const wanted = new Set(combos)
  return Object.keys(bindings).filter(
    (other) =>
      other !== id && bindings[other].some((combo) => wanted.has(combo))
  )
}

/** The action a combo triggers, if any. */
export function actionForCombo(
  bindings: Bindings,
  combo: string
): ActionId | undefined {
  for (const id of Object.keys(bindings))
    if (bindings[id].includes(combo)) return id
  return undefined
}

export type RebindResult =
  { ok: true; bindings: Bindings } | { ok: false; message: string }

/**
 * Gives an action new combos, or says why it cannot: an unusable key, or a key another
 * action already uses. Nothing changes on failure.
 */
export function rebind(
  bindings: Bindings,
  id: ActionId,
  combos: readonly string[]
): RebindResult {
  if (!ACTION_IDS.has(id)) return { ok: false, message: "Unknown shortcut." }
  if (combos.length === 0) return { ok: false, message: "Choose a key." }
  for (const combo of combos) {
    const checked = checkCombo(combo)
    if (!checked.ok) return checked
  }
  const clashes = clashesFor(bindings, id, combos)
  if (clashes.length > 0) {
    const used = combos.find((combo) =>
      clashes.some((other) => bindings[other].includes(combo))
    ) as string
    const other = ACTIONS.find((a) => a.id === clashes[0])
    return {
      ok: false,
      message: `${comboLabel(used)} is already used by ${other?.label ?? clashes[0]}.`,
    }
  }
  return { ok: true, bindings: { ...bindings, [id]: [...combos] } }
}

/** Only the actions a person changed, so that reset and storage agree with the defaults. */
export function overridesFrom(bindings: Bindings): Overrides {
  const defaults = defaultBindings()
  const overrides: Record<string, readonly string[]> = {}
  for (const id of Object.keys(bindings))
    if (!sameList(bindings[id], defaults[id])) overrides[id] = [...bindings[id]]
  return overrides
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((combo, i) => combo === b[i])
}

/**
 * Applies saved overrides to the defaults. Anything that cannot be read is skipped: an
 * unknown action, a bad combo, or a list that is not an array. When two actions end up with
 * the same combo, the override gives way, so a saved change never silently shadows another
 * action. Returns the overrides that were kept and the ids of the ones that were dropped.
 */
export function resolveOverrides(raw: unknown): {
  bindings: Bindings
  kept: Overrides
  dropped: string[]
} {
  const read = readOverrides(raw)
  const overrides: Record<string, readonly string[]> = { ...read.valid }
  const dropped = [...read.invalid]
  for (;;) {
    const bindings = applyOverrides(overrides)
    const clash = findClash(bindings, overrides)
    if (clash === undefined) return { bindings, kept: overrides, dropped }
    dropped.push(clash)
    delete overrides[clash]
  }
}

// The later action of a clashing pair gives way if it was changed, otherwise the earlier one
// does. Two defaults never clash (a test checks that), so one of the pair has an override.
function findClash(
  bindings: Bindings,
  overrides: Record<string, readonly string[]>
): ActionId | undefined {
  const owners = new Map<string, ActionId>()
  for (const id of Object.keys(bindings)) {
    for (const combo of bindings[id]) {
      const owner = owners.get(combo)
      if (owner === undefined) {
        owners.set(combo, id)
        continue
      }
      if (id in overrides) return id
      if (owner in overrides) return owner
      return undefined
    }
  }
  return undefined
}

function applyOverrides(
  overrides: Record<string, readonly string[]>
): Bindings {
  const bindings: Record<string, readonly string[]> = { ...defaultBindings() }
  for (const id of Object.keys(overrides)) bindings[id] = overrides[id]
  return bindings
}

function readOverrides(raw: unknown): {
  valid: Record<string, readonly string[]>
  invalid: string[]
} {
  const valid: Record<string, readonly string[]> = {}
  const invalid: string[] = []
  const entries: unknown =
    typeof raw === "object" && raw !== null && "bindings" in raw
      ? raw.bindings
      : undefined
  if (typeof entries !== "object" || entries === null) return { valid, invalid }
  for (const [id, list] of Object.entries(entries)) {
    const combos = readCombos(list)
    if (!ACTION_IDS.has(id) || combos === undefined) invalid.push(id)
    else valid[id] = combos
  }
  return { valid, invalid }
}

function readCombos(list: unknown): string[] | undefined {
  if (!Array.isArray(list) || list.length === 0 || list.length > 4)
    return undefined
  const combos: string[] = []
  for (const combo of list) {
    if (typeof combo !== "string" || !checkCombo(combo).ok) return undefined
    combos.push(combo)
  }
  return new Set(combos).size === combos.length ? combos : undefined
}

/** The envelope written to storage. Versioned, so a later format can still read this one. */
export function serializeOverrides(overrides: Overrides): string {
  return JSON.stringify({ version: 1, bindings: overrides })
}

export function groupedActions(): {
  group: ActionGroup
  actions: ActionDef[]
}[] {
  const order: ActionGroup[] = [
    "Select",
    "Move and turn",
    "Edit",
    "Place and view",
  ]
  return order.map((group) => ({
    group,
    actions: ACTIONS.filter((a) => a.group === group),
  }))
}
