"use node"

import { api } from "../../_generated/api"
import { action } from "../../_generated/server"
import { ConvexError, v } from "convex/values"
import { replayLiveDocument } from "../liveReplay"
import {
  literalPattern,
  matchesSearchPath,
  searchPathGlob,
  SEARCH_SOURCE_EXCLUDES,
  overlaySearch,
  searchText,
  SEARCH_LIMIT,
  type SearchFile,
} from "../programSearch"
import { requireAuthorizedProgram, storage } from "./repository"

export function searchActions() {
  const searchProgram = action({
    args: {
      programId: v.id("programs"),
      query: v.string(),
      matchCase: v.boolean(),
      sourceOnly: v.optional(v.boolean()),
      pathFilter: v.optional(v.string()),
    },
    handler: async (
      ctx,
      { programId, query, matchCase, sourceOnly, pathFilter }
    ): Promise<{
      files: SearchFile[]
      truncated: boolean
      skipped: number
    }> => {
      const program = await requireAuthorizedProgram(ctx, programId)
      if (!query || query.length > 200 || /[\r\n]/.test(query))
        throw new ConvexError(
          "Search requires a single line of up to 200 characters."
        )
      if (
        pathFilter &&
        (pathFilter.length > 200 || /[\r\n\0]/.test(pathFilter))
      )
        throw new ConvexError(
          "Path filters must be a single line of up to 200 characters."
        )
      const filters = { sourceOnly, pathFilter }
      const repo = storage().repo({
        id: program.repositoryId,
        defaultBranch: "main",
      })
      const files: SearchFile[] = []
      let cursor: string | undefined
      let hasMore = false
      for (let page = 0; page < 20; page++) {
        const committed = await repo.grep({
          ref: "main",
          query: { pattern: literalPattern(query), caseSensitive: matchCase },
          fileFilters: {
            excludeGlobs: [
              ".v5x/**",
              ...(sourceOnly ? SEARCH_SOURCE_EXCLUDES : []),
            ],
            ...(pathFilter?.trim()
              ? { includeGlobs: [searchPathGlob(pathFilter)] }
              : {}),
          },
          context: { before: 0, after: 0 },
          limits: {
            maxLines: SEARCH_LIMIT + 1,
            maxMatchesPerFile: SEARCH_LIMIT + 1,
          },
          pagination: { limit: SEARCH_LIMIT + 1, cursor },
        })
        files.push(
          ...committed.matches
            .filter((file) => matchesSearchPath(file.path, filters))
            .map((file) => ({
              path: file.path,
              matches: file.lines.flatMap((line) =>
                searchText(line.text, query, matchCase, SEARCH_LIMIT + 1).map(
                  (match) => ({ ...match, line: line.lineNumber })
                )
              ),
            }))
        )
        hasMore = committed.hasMore
        if (
          !hasMore ||
          files.reduce((count, file) => count + file.matches.length, 0) >
            SEARCH_LIMIT
        )
          break
        if (!committed.nextCursor || committed.nextCursor === cursor) break
        cursor = committed.nextCursor
      }
      const docs = await ctx.runQuery(api.search.liveDocuments, { programId })
      const drafts = new Map<string, string>()
      let skipped = 0
      const replayBudget = { used: 0, limit: 16 * 1024 * 1024 }
      for (const [index, document] of docs
        .filter((document) => matchesSearchPath(document.path, filters))
        .entries()) {
        // Never show a committed match as current when its live text could not be read.
        drafts.set(document.path, "")
        if (index >= 100 || replayBudget.used >= replayBudget.limit) {
          skipped++
          continue
        }
        try {
          const replay = await replayLiveDocument(
            (afterSequence) =>
              ctx.runQuery(api.crdt.updatesSince, {
                programId,
                path: document.path,
                afterSequence,
              }),
            replayBudget,
            document.id
          )
          drafts.set(document.path, replay.contents)
        } catch {
          skipped++
        }
      }
      const result = overlaySearch(files, drafts, query, matchCase, filters)
      return {
        ...result,
        truncated: result.truncated || hasMore,
        skipped,
      }
    },
  })
  return { searchProgram }
}
