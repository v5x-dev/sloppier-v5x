import * as React from "react"
import {
  codeToTokens,
  LiveTokenizer,
  type Lang,
  type ThemedToken,
} from "@pierre/highlights"
import { birdsOfParadiseTheme } from "./birds-of-paradise-theme"

// Keep this list aligned with languages used by the code web app.
const languages = {
  bash: "bash",
  css: "css",
  diff: "diff",
  html: "html",
  javascript: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  python: "python",
  sql: "sql",
  tsx: "tsx",
  typescript: "typescript",
  yaml: "yaml",
} as const satisfies Record<string, Lang>

const aliases: Record<string, Lang> = {
  js: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
}

const themes = {
  light: birdsOfParadiseTheme,
  dark: birdsOfParadiseTheme,
} as const

function renderTokens(tokens: readonly ThemedToken[]) {
  return tokens.map((token, index) => (
    <span
      key={index}
      style={token.htmlStyle as React.CSSProperties}
      className="text-(--hls-light) dark:text-(--hls-dark)"
    >
      {token.content}
    </span>
  ))
}

function getLanguage(language: string) {
  const name = language.toLowerCase()

  if (name === "ansi") {
    return "text"
  }

  if (name in languages) {
    return name as keyof typeof languages
  }

  return aliases[name] ?? null
}

// Returns a highlighter for a supported language, or null for an unknown one.
export async function loadHighlighter(language: string) {
  const lang = getLanguage(language)

  if (!lang) {
    return null
  }

  return {
    // Returns one React node per line.
    highlight(code: string) {
      const tokens = codeToTokens(code, {
        lang,
        themes,
        defaultColor: false,
      }).tokens

      return tokens.map(renderTokens)
    },
    createTokenizer() {
      return new LiveTokenizer({
        lang,
        themes,
        defaultColor: false,
      })
    },
    renderTokens,
  }
}

// Returns one React node per line, or null for a language that is not listed.
export async function highlightCode(code: string, language: string) {
  const highlighter = await loadHighlighter(language)

  return highlighter ? highlighter.highlight(code) : null
}
