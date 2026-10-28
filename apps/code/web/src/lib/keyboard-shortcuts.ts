// The program shortcuts accept Ctrl or Cmd interchangeably, so hints show the
// modifier the reader's platform uses. Server renders get the Ctrl form; the
// tooltip that shows it only mounts on hover, so the two never disagree in DOM.
const apple =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

export function shortcutKeys(...keys: string[]) {
  return [apple ? "⌘" : "Ctrl", ...keys]
}
