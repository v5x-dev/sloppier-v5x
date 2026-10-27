// Run against a demo program containing intake.move(...), or provide another call.
// Usage: node apps/code/web/scripts/hover-check.mjs <demo URL> [receiver.method]
import { execFileSync } from "node:child_process"

const [url, call = "intake.move"] = process.argv.slice(2)
if (!url) throw new Error("Provide the demo URL")
const browser = (...args) => execFileSync(
  "agent-browser", ["--session", `editor-hover-check-${process.pid}`, ...args],
  { encoding: "utf8" }
)
const evaluate = (code) => JSON.parse(browser("eval", code))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
try {
  browser("open", url)
  browser("wait", "--fn", "[...document.querySelectorAll('*')].some(node => node.shadowRoot?.querySelector('[data-line]'))")
  const point = evaluate(`(() => {
    const call = ${JSON.stringify(call)};
    const method = call.split('.').at(-1);
    for (const host of document.querySelectorAll('*')) {
      for (const line of host.shadowRoot?.querySelectorAll('[data-line]') ?? []) {
        if (!line.textContent.includes(call)) continue;
        line.scrollIntoView({block:'center'});
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const at = node.textContent.indexOf(method);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at); range.setEnd(node, at + method.length);
          const rect = range.getBoundingClientRect();
          return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2, left:rect.left, top:rect.top, bottom:rect.bottom};
        }
      }
    }
    throw Error('Call not found: ' + call);
  })()`)
  browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)))
  browser("wait", "[data-language-hover]")
  browser("mouse", "move", String(Math.round(point.x + 1)), String(Math.round(point.y + 1)))
  assert(evaluate('!!document.querySelector("[data-language-hover]")'), "Card disappeared while moving within the same symbol")
  const card = evaluate('document.querySelector("[data-language-hover]").getBoundingClientRect().toJSON()')
  assert(card.bottom <= point.top || card.top >= point.bottom, "Card overlaps the symbol's line")
  assert(Math.abs(card.left - point.left) <= 1, "Card is not aligned with the symbol")
  browser("mouse", "move", String(Math.round(card.x + 20)), String(Math.round(card.y - 5)))
  browser("mouse", "move", String(Math.round(card.x + 20)), String(Math.round(card.y + 20)))
  assert(evaluate('new Promise(resolve => setTimeout(() => resolve(!!document.querySelector("[data-language-hover]")), 750))'), "Card disappeared while hovered")
  browser("mouse", "move", "0", "0")
  assert(evaluate('new Promise(resolve => setTimeout(() => resolve(!document.querySelector("[data-language-hover]")), 350))'), "Card stayed open after leaving both the symbol and card")
  console.log("PASS: hover survives movement within the symbol and into the card, then dismisses on leave")
} finally {
  browser("close")
}
