// VS Code Seti icon, Copyright (c) 2014 Jesse Weed, MIT license.
// Full license: public/icons/SETI-LICENSE.txt.
import type { FileTreeIconConfig } from "@pierre/trees"

const makefile = { name: "v5x-makefile", viewBox: "4 3.4 24 24" }
export const makefileIcons: FileTreeIconConfig = {
  set: "complete",
  colored: true,
  spriteSheet: `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden"><symbol id="v5x-makefile" viewBox="4 3.4 24 24"><path fill="#e37933" d="M10.2 7L7 7.8v16h4.2v-9.9l3.6 3.9h2.4l3.6-3.9v9.9H25v-16L21.8 7 16 13.3 10.2 7z"/></symbol></svg>`,
  byFileName: {
    Makefile: makefile,
    makefile,
    GNUmakefile: makefile,
    gnumakefile: makefile,
    BSDmakefile: makefile,
    bsdmakefile: makefile,
  },
  byFileExtension: { mk: makefile, mak: makefile, make: makefile },
}
