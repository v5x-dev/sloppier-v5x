// The public repositories the pipeline reads, each pinned to one commit. Files are
// read with `git show <commit>:<path>` from a blobless clone, so only the STEP files
// the manifest names are downloaded. Nothing here reads a scratch folder or a copy of
// the models left behind by an earlier run.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const SOURCES = {
  "vex-cad-download": {
    // 397 STEP files, described by the repo as unchanged from VEX's CAD downloads.
    url: "https://github.com/TlorschCode/VEX-V5-Parts-Solidworks-Download",
    commit: "c49519327b827f77db3d26052e9486c2db8b4463",
    credit: "VEX V5 CAD downloads, mirrored by TlorschCode/VEX-V5-Parts-Solidworks-Download",
  },
  "solidpython4vex": {
    // Shop URLs and SKU metadata. MIT licensed.
    url: "https://github.com/UTCSheffield/SolidPython4VEX",
    commit: "6d511d5f0c50855a3b66593ed774cf5493f3d661",
    credit: "UTCSheffield/SolidPython4VEX (MIT), src/solidpython4vex/parts/catalog.json",
  },
};

/** Clones each source once, without blobs, at the commit the manifest pins. */
export function ensureSource(cacheDir, key) {
  const source = SOURCES[key];
  if (!source) throw new Error(`Unknown source "${key}"`);
  const dir = join(cacheDir, "sources", key);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    git(dir, ["init", "-q"]);
    git(dir, ["remote", "add", "origin", source.url]);
  }
  // Fetch only when the pinned commit is missing; a fetch with a filter keeps blobs out.
  if (!hasCommit(dir, source.commit))
    git(dir, ["fetch", "--filter=blob:none", "--depth=1", "origin", source.commit]);
  return { dir, commit: source.commit, url: source.url, credit: source.credit };
}

/** The bytes of one file at the pinned commit. */
export function readAt(source, path) {
  return execFileSync("git", ["-C", source.dir, "show", `${source.commit}:${path}`], {
    maxBuffer: 1 << 30,
  });
}

function hasCommit(dir, commit) {
  try {
    git(dir, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
}
