// Carries an imported Design file from the Designs page to the new Design's editor. The file
// is kept in this tab's session storage only until the editor has read it, so a page reload
// or a second tab never sees it twice.

/** The session storage key that holds a Design file waiting for its new Design. */
export function importKey(designId: string): string {
  return `v5x:design-import:${designId}`
}
