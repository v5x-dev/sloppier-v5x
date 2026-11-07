/** How long the pointer rests on a word before its documentation is requested. */
export const HOVER_DELAY_MS = 500
/** How long a card stays up after the pointer leaves, so the pointer can move onto it. */
export const HOVER_LINGER_MS = 200

/** A word under the pointer. `text` is the whole document it sits in, so an edit ends the hover. */
export type HoverWord = {
  start: number
  end: number
  text: string
  /** The pointer's offset within the word's document. */
  offset: number
}

/** Where the pointer is relative to hover documentation. */
export type PointerPhase<TWord> =
  | { kind: "none" }
  /** On a word, waiting out the delay before asking. */
  | { kind: "waiting"; word: TWord; timer: ReturnType<typeof setTimeout> }
  /** Asking for this word's documentation. */
  | { kind: "asking"; word: TWord; request: AbortController }
  /** Asked for this word; it is not asked again until the pointer moves off it. */
  | { kind: "settled"; word: TWord }

/** Whether a documentation card is on screen, and whether it is lingering to be dismissed. */
export type CardPhase =
  | { kind: "hidden" }
  | { kind: "shown" }
  | { kind: "lingering"; timer: ReturnType<typeof setTimeout> }

type Options<TWord extends HoverWord, TCard> = {
  /** Resolves the card for a word, or null when there is nothing to show. A cancelled request resolves to null. */
  load: (word: TWord, signal: AbortSignal) => Promise<TCard | null>
  show: (card: TCard) => void
  hide: () => void
}

/**
 * Hover documentation as two explicit phases: the pointer (what it rests on and what is being asked) and the card
 * (whether one is up). Each timer and request belongs to one phase, so leaving either phase cancels exactly what it
 * started.
 */
export class HoverCardController<TWord extends HoverWord, TCard> {
  private pointer: PointerPhase<TWord> = { kind: "none" }
  private card: CardPhase = { kind: "hidden" }

  constructor(private readonly options: Options<TWord, TCard>) {}

  /** Whether the pointer is already on `word`, so the caller can skip building a new target. */
  isOn(word: HoverWord) {
    return this.pointer.kind !== "none" && sameWord(this.pointer.word, word)
  }

  /** The pointer is still on the word it was on: keep the card up. */
  stay() {
    this.cancelLinger()
  }

  /** The pointer is on `word`, or on nothing (null). */
  point(word: TWord | null) {
    if (!word) {
      this.cancelPointer()
      this.linger()
      return
    }
    this.cancelLinger()
    if (this.pointer.kind !== "none" && sameWord(this.pointer.word, word))
      return
    this.cancelPointer()
    this.pointer = {
      kind: "waiting",
      word,
      timer: setTimeout(() => this.ask(word), HOVER_DELAY_MS),
    }
    this.linger()
  }

  /** The pointer left the editor. `onCard` means it moved onto a card, which keeps the card up. */
  leaveEditor(onCard: boolean) {
    this.cancelPointer()
    if (onCard) this.cancelLinger()
    else this.linger()
  }

  /** The pointer entered a card. */
  enterCard() {
    this.cancelLinger()
  }

  /** The pointer left a card. */
  leaveCard() {
    this.linger()
  }

  /** Escape, typing, scrolling or a click: everything closes at once. */
  dismiss() {
    this.cancelPointer()
    this.cancelLinger()
    this.card = { kind: "hidden" }
    this.options.hide()
  }

  /** Cancels every pending timer and request without touching the card. */
  dispose() {
    this.cancelPointer()
    this.cancelLinger()
    this.card = { kind: "hidden" }
  }

  private ask(word: TWord) {
    if (this.pointer.kind !== "waiting" || this.pointer.word !== word) return
    const request = new AbortController()
    this.pointer = { kind: "asking", word, request }
    this.options.load(word, request.signal).then(
      (card) => this.settle(request, word, card),
      () => this.settle(request, word, null)
    )
  }

  private settle(request: AbortController, word: TWord, card: TCard | null) {
    if (this.pointer.kind !== "asking" || this.pointer.request !== request)
      return
    this.pointer = { kind: "settled", word }
    if (!card) return
    this.cancelLinger()
    this.card = { kind: "shown" }
    this.options.show(card)
  }

  private linger() {
    if (this.card.kind === "hidden") return
    if (this.card.kind === "lingering") clearTimeout(this.card.timer)
    this.card = {
      kind: "lingering",
      timer: setTimeout(() => {
        this.card = { kind: "hidden" }
        this.options.hide()
      }, HOVER_LINGER_MS),
    }
  }

  private cancelLinger() {
    if (this.card.kind !== "lingering") return
    clearTimeout(this.card.timer)
    this.card = { kind: "shown" }
  }

  private cancelPointer() {
    if (this.pointer.kind === "waiting") clearTimeout(this.pointer.timer)
    if (this.pointer.kind === "asking") this.pointer.request.abort()
    this.pointer = { kind: "none" }
  }
}

function sameWord(a: HoverWord, b: HoverWord) {
  return a.start === b.start && a.end === b.end && a.text === b.text
}
