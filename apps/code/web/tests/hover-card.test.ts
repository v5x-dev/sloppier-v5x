import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  HOVER_DELAY_MS,
  HOVER_LINGER_MS,
  HoverCardController,
  type HoverWord,
} from "../src/lib/hover-card"

type Target = HoverWord & { anchor: string }
type Card = { label: string }

const word = (start: number, text = "doc"): Target => ({
  start,
  end: start + 3,
  text,
  offset: start + 1,
  anchor: `anchor-${start}`,
})

function setup() {
  const shown: Card[] = []
  let hides = 0
  const requests: {
    target: Target
    signal: AbortSignal
    resolve: (card: Card | null) => void
  }[] = []
  const controller = new HoverCardController<Target, Card>({
    load: (target, signal) =>
      new Promise<Card | null>((resolve) => {
        requests.push({ target, signal, resolve })
      }),
    show: (card) => shown.push(card),
    hide: () => {
      hides++
    },
  })
  return { controller, shown, requests, hides: () => hides }
}

describe("hover card controller", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("asks once after the delay, shows the card, and keeps it while the pointer stays on the word", async () => {
    const { controller, shown, requests } = setup()
    controller.point(word(10))
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1)
    expect(requests).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(requests).toHaveLength(1)
    requests[0].resolve({ label: "motor" })
    await Promise.resolve()
    expect(shown).toEqual([{ label: "motor" }])
    // Moving within the same word neither asks again nor hides the card.
    const same = word(10)
    expect(controller.isOn(same)).toBe(true)
    controller.stay()
    vi.advanceTimersByTime(HOVER_LINGER_MS * 2)
    controller.point(same)
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2)
    expect(requests).toHaveLength(1)
  })

  it("lingers after the pointer leaves the word, and a card entered in time stays up", async () => {
    const { controller, shown, requests, hides } = setup()
    controller.point(word(10))
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    requests[0].resolve({ label: "motor" })
    await Promise.resolve()
    controller.leaveEditor(false)
    vi.advanceTimersByTime(HOVER_LINGER_MS - 1)
    expect(hides()).toBe(0)
    controller.enterCard()
    vi.advanceTimersByTime(HOVER_LINGER_MS * 5)
    expect(hides()).toBe(0)
    controller.leaveCard()
    vi.advanceTimersByTime(HOVER_LINGER_MS)
    expect(hides()).toBe(1)
    expect(shown).toHaveLength(1)
  })

  it("aborts the request for a word the pointer has left, and ignores its late reply", async () => {
    const { controller, shown, requests } = setup()
    controller.point(word(10))
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    expect(requests).toHaveLength(1)
    controller.point(word(40))
    expect(requests[0].signal.aborted).toBe(true)
    requests[0].resolve({ label: "stale" })
    await Promise.resolve()
    expect(shown).toEqual([])
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    expect(requests).toHaveLength(2)
    expect(requests[1].target.start).toBe(40)
  })

  it("asks again for a word that showed nothing only after the pointer returns to it", async () => {
    const { controller, requests } = setup()
    controller.point(word(10))
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    requests[0].resolve(null)
    await Promise.resolve()
    controller.point(word(10))
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2)
    expect(requests).toHaveLength(1)
    controller.point(null)
    controller.point(word(10))
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    expect(requests).toHaveLength(2)
  })

  it("dismiss closes the card and cancels a pending request at once", async () => {
    const { controller, requests, hides } = setup()
    controller.point(word(10))
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    controller.dismiss()
    expect(requests[0].signal.aborted).toBe(true)
    expect(hides()).toBe(1)
    vi.advanceTimersByTime(HOVER_DELAY_MS * 4)
    expect(requests).toHaveLength(1)
  })
})
