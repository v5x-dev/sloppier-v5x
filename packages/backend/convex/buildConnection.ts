"use node"

import { v } from "convex/values"
import { api } from "./_generated/api"
import { action } from "./_generated/server"
import { cloud } from "./buildWorker"

export const connect = action({
  args: { programId: v.id("programs") },
  handler: async (
    ctx,
    args
  ): Promise<{ baseUrl: string; token: string; expiresAt: string }> => {
    // This query verifies membership before any credential can be minted.
    const state = await ctx.runQuery(api.builds.status, args)
    if (state?.status !== "ready" || !state.machineId)
      throw new Error("Build machine is not ready.")
    const credential = await cloud<{ token: string; expiresAt: string }>(
      `/machines/${encodeURIComponent(state.machineId)}/connect-token`,
      { port: 8080, includeDescendants: false, ttlSeconds: 900 }
    )
    return {
      baseUrl: `https://api.smolmachines.com/v1/machines/${encodeURIComponent(state.machineId)}/connect/8080`,
      token: credential.token,
      expiresAt: credential.expiresAt,
    }
  },
})
