// Run after completion-demo.mjs ez-template has started.
// Usage: node apps/code/web/scripts/path-preview-check.mjs <demo URL> [screenshot.png]
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
const [url, screenshot = "/tmp/auton-path-preview.png"] = process.argv.slice(2)
if (!url) throw new Error("Provide the EZ-Template demo URL")
const browser = (...args) =>
  execFileSync("agent-browser", ["--session", "auton-preview", ...args], {
    encoding: "utf8",
  })
console.log(browser("open", url))
browser("wait", '[aria-label="Preview autonomous paths"]')
// A fresh navigation starts closed.
browser("click", '[aria-label="Preview autonomous paths"]')
browser("wait", '[role="combobox"][aria-label="Field"]')
const check = browser(
  "eval",
  `(() => {
  const panel = document.querySelector('[aria-label="Autonomous path preview"]');
  if (!panel) throw Error('Panel missing after clicking path button');
  const rect = panel.getBoundingClientRect();
  if (!panel.contains(document.elementFromPoint(rect.x + 10, rect.y + 10))) throw Error('Path panel is covered or clipped');
  return 'PASS: path button opens a visible, interactive panel';
})()`
)
if (!check.includes("PASS:")) throw new Error(check)
console.log(check)
browser("wait", '[role="combobox"][aria-label="Route"]')
browser("click", '[role="combobox"][aria-label="Route"]')
browser(
  "find",
  "role",
  "option",
  "click",
  "--name",
  "odom_pure_pursuit_wait_until_example · src/autons.cpp",
  "--exact"
)
browser("click", '[role="combobox"][aria-label="Field"]')
browser(
  "find",
  "role",
  "option",
  "click",
  "--name",
  "Override · Skills",
  "--exact"
)
const result = browser(
  "eval",
  `new Promise((resolve, reject) => {
  const panel = document.querySelector('[aria-label="Autonomous path preview"]');
  const image = panel.querySelector('img');
  const check = () => {
    if (!image.naturalWidth) return reject(Error('Field image failed to load'));
    const line = panel.querySelector('polyline');
    if (!line || line.getAttribute('points').split(' ').length < 4) return reject(Error('Auton waypoints missing'));
    resolve('PASS: selected field loaded and auton waypoints rendered');
  };
  if (image.complete) check(); else { image.onload = check; image.onerror = () => reject(Error('Field image failed to load')); }
})`
)
if (!result.includes("PASS:")) throw new Error(result)
console.log(result)
console.log(browser("screenshot", resolve(screenshot)))
browser("click", '[aria-label="Close path preview"]')
const closed = browser(
  "eval",
  `document.querySelector('[aria-label="Autonomous path preview"]') === null ? 'PASS: close button hides panel' : 'FAIL'`
)
if (!closed.includes("PASS:")) throw new Error(closed)
console.log(closed)
