# Suite visual rules

Every v5x product shares these rules. Each product chooses its own palette in
`packages/tokens/src/<product>/web.css`, but none may drop the rules below.

## Contrast

- Text meets WCAG AA: at least 4.5:1 for body text and 3:1 for large text.
- Components that identify a control meet 3:1 against the adjacent background
  (WCAG 1.4.11). This covers input outlines, checkboxes, and focus rings.
- Decorative borders and dividers do not need 3:1. Do not rely on them alone to
  show where a control is.
- Check new token pairs with the same OKLCH-to-WCAG calculation used in the
  Code UI review before shipping them.

## Focus

- Every interactive element has a visible focus ring from the `--ring` token.
  The ring meets 3:1 against its background in each theme the product ships.

## Targets

- Interactive targets are at least 24 by 24 CSS pixels (WCAG 2.2, 2.5.8). A
  smaller glyph can keep its size if its hit area is extended.

## Icon-only controls

- An icon-only control has an accessible name and a tooltip that shows the same
  label. Visible text is reserved for places where the words carry meaning the
  icon cannot.
- Status that changes while a user works (saving, syncing, offline) is shown as
  an icon with a label, and announced through a live region.

## Type

- Merriweather for all UI, including controls, shortcut hints, and documentation
  prose. JetBrains Mono only for code. See the root AGENTS.md.

## Vocabulary

- Use the glossary's terms in user-facing copy: Program, Workspace, Brain,
  Builder, source commit. Do not expose internal service names such as
  "Code Storage" or "repository" in interface text.
