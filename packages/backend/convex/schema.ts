import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  workspaces: defineTable({
    name: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  projects: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    template: v.union(
      v.literal("vexcode"),
      v.literal("jar"),
      v.literal("pros"),
      v.literal("ez-template")
    ),
    repositoryId: v.string(),
    repositoryStatus: v.union(
      v.literal("provisioning"),
      v.literal("ready"),
      v.literal("failed")
    ),
    repositoryHeadSha: v.optional(v.string()),
    repositoryError: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  files: defineTable({
    projectId: v.id("projects"),
    path: v.string(),
    origin: v.union(v.literal("template"), v.literal("user")),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_path", ["projectId", "path"]),

  crdtDocuments: defineTable({
    projectId: v.id("projects"),
    path: v.string(),
    lastSequence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project_path", ["projectId", "path"]),

  crdtUpdates: defineTable({
    documentId: v.id("crdtDocuments"),
    sequence: v.number(),
    updateId: v.string(),
    actorId: v.string(),
    bytes: v.bytes(),
    storageStatus: v.union(
      v.literal("pending"),
      v.literal("persisted"),
      v.literal("failed")
    ),
    storageCommitSha: v.optional(v.string()),
    storageError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_document_sequence", ["documentId", "sequence"])
    .index("by_document_update", ["documentId", "updateId"]),

  presenceSessions: defineTable({
    projectId: v.id("projects"),
    path: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    roomToken: v.string(),
    sessionToken: v.string(),
    awareness: v.optional(v.bytes()),
    createdAt: v.number(),
  })
    .index("by_file_user_session", ["projectId", "path", "userId", "sessionId"])
    .index("by_file_user_room_token", [
      "projectId",
      "path",
      "userId",
      "roomToken",
    ])
    .index("by_session_token", ["sessionToken"])
    .index("by_file_seen", ["projectId", "path", "createdAt"]),
})
