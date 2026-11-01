import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  lstatSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
const setup = resolve(import.meta.dirname, "../setup-worktree.sh")
test("worktree environment copies and existing links cannot change the main checkout", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "v5x-worktree-test-"))
  const main = resolve(dir, "main"),
    worktree = resolve(dir, "worktree")
  const git = (args, cwd = main) =>
    execFileSync("git", args, { cwd, stdio: "pipe" })
  try {
    execFileSync("git", ["init", main], { stdio: "pipe" })
    writeFileSync(resolve(main, "README.md"), "fixture")
    git(["add", "README.md"])
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    ])
    git(["worktree", "add", "--detach", worktree])
    writeFileSync(resolve(main, ".env.local"), "FIXTURE=original\n")
    execFileSync("bash", [setup, "--skip-install"], { cwd: worktree })
    assert.equal(
      lstatSync(resolve(worktree, ".env.local")).isSymbolicLink(),
      false
    )
    writeFileSync(resolve(worktree, ".env.local"), "FIXTURE=edited\n")
    assert.equal(
      readFileSync(resolve(main, ".env.local"), "utf8"),
      "FIXTURE=original\n"
    )
    rmSync(resolve(worktree, ".env.local"))
    symlinkSync(resolve(main, ".env.local"), resolve(worktree, ".env.local"))
    execFileSync("bash", [setup, "--skip-install"], { cwd: worktree })
    assert.equal(
      lstatSync(resolve(worktree, ".env.local")).isSymbolicLink(),
      false
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
