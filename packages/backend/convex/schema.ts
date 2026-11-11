import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  programSessions: defineTable({
    programId: v.id("programs"),
    sessionId: v.string(),
    userId: v.string(),
    expiresAt: v.number(),
  }).index("by_program_session", ["programId", "sessionId"]),
  buildMachines: defineTable({
    programId: v.id("programs"),
    machineId: v.optional(v.string()),
    status: v.string(),
    logs: v.string(),
    building: v.boolean(),
    artifactId: v.optional(v.id("_storage")),
    expiresAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    completedKey: v.optional(v.string()),
  }).index("by_program", ["programId"]),
  workspaces: defineTable({
    name: v.string(),
    icon: v.optional(v.string()),
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

  userProfiles: defineTable({
    userId: v.string(),
    email: v.string(),
    name: v.string(),
  }).index("by_user", ["userId"]),

  workspaceInvitations: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedBy: v.string(),
    expiresAt: v.number(),
    delivery: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("unavailable"),
      v.literal("failed")
    ),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_email", ["email"]),

  programImports: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    name: v.string(),
    template: v.union(
      v.literal("vexcode"),
      v.literal("jar"),
      v.literal("pros"),
      v.literal("ez-template"),
      v.literal("rw")
    ),
    expectedFiles: v.number(),
    paths: v.array(v.string()),
    totalBytes: v.number(),
    batches: v.number(),
    expiresAt: v.number(),
    programId: v.optional(v.id("programs")),
  }),
  programImportBatches: defineTable({
    importId: v.id("programImports"),
    sequence: v.number(),
    files: v.array(v.object({ path: v.string(), contents: v.bytes() })),
  }).index("by_import_sequence", ["importId", "sequence"]),

  programs: defineTable({
    archivedAt: v.optional(v.number()),
    /** Set when permanent deletion starts. Hidden from listings until the row is removed. */
    deletionStartedAt: v.optional(v.number()),
    importId: v.optional(v.id("programImports")),
    duplicateSource: v.optional(
      v.object({ repositoryId: v.string(), sha: v.string() })
    ),
    workspaceId: v.id("workspaces"),
    name: v.string(),
    template: v.union(
      v.literal("vexcode"),
      v.literal("jar"),
      v.literal("pros"),
      v.literal("ez-template"),
      v.literal("rw")
    ),
    repositoryId: v.string(),
    repositoryStatus: v.union(
      v.literal("provisioning"),
      v.literal("ready"),
      v.literal("failed")
    ),
    repositoryProvisioningJob: v.optional(v.id("_scheduled_functions")),
    repositoryHeadSha: v.optional(v.string()),
    /** Set when a commit moves the head. Dashboards fall back to createdAt. */
    lastActivityAt: v.optional(v.number()),
    repositoryError: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  programDiagnostics: defineTable({
    programId: v.id("programs"),
    revision: v.string(),
    startedAt: v.number(),
    diagnostics: v.array(
      v.object({
        path: v.string(),
        line: v.number(),
        column: v.optional(v.number()),
        severity: v.union(
          v.literal("error"),
          v.literal("warning"),
          v.literal("note")
        ),
        message: v.string(),
      })
    ),
  }).index("by_program", ["programId"]),

  programUploads: defineTable({
    programId: v.id("programs"),
    revision: v.string(),
    slot: v.number(),
    userId: v.string(),
    userName: v.string(),
    uploadedAt: v.number(),
  }).index("by_program", ["programId"]),

  programCheckpoints: defineTable({
    programId: v.id("programs"),
    sha: v.string(),
    name: v.string(),
    message: v.string(),
    author: v.string(),
    date: v.string(),
  }).index("by_program", ["programId"]),

  files: defineTable({
    programId: v.id("programs"),
    path: v.string(),
    origin: v.union(v.literal("template"), v.literal("user")),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_program", ["programId"])
    .index("by_program_path", ["programId", "path"]),

  crdtDocuments: defineTable({
    programId: v.id("programs"),
    path: v.string(),
    lastSequence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_program_path", ["programId", "path"]),

  crdtUpdates: defineTable({
    programId: v.optional(v.id("programs")),
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
    .index("by_document_update", ["documentId", "updateId"])
    .index("by_program_storage", ["programId", "storageStatus"]),

  crdtBackupJobs: defineTable({
    programId: v.id("programs"),
    generation: v.number(),
    attempts: v.number(),
  }).index("by_program", ["programId"]),

  presenceSessions: defineTable({
    programId: v.id("programs"),
    path: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    roomToken: v.string(),
    sessionToken: v.string(),
    awareness: v.optional(v.bytes()),
    createdAt: v.number(),
  })
    .index("by_file_user_session", ["programId", "path", "userId", "sessionId"])
    .index("by_file_user_room_token", [
      "programId",
      "path",
      "userId",
      "roomToken",
    ])
    .index("by_session_token", ["sessionToken"])
    .index("by_file_seen", ["programId", "path", "createdAt"]),

  // bin: parts inventory. The catalog is global and read-only; everything
  // below it belongs to one workspace.
  binCatalogParts: defineTable({
    sku: v.string(),
    name: v.string(),
    partType: v.string(),
    alternateSkus: v.array(v.string()),
    retrievedAt: v.string(),
  }).index("by_sku", ["sku"]),

  binParts: defineTable({
    workspaceId: v.id("workspaces"),
    catalogPartId: v.optional(v.id("binCatalogParts")),
    name: v.string(),
    sku: v.optional(v.string()),
    partType: v.string(),
    minQuantity: v.optional(v.number()),
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_catalog_part", ["workspaceId", "catalogPartId"]),

  binLocations: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  // On-hand quantity of one part at one location. A part with options (the
  // C-Channel) keeps a line per option set, in `variant`.
  binStock: defineTable({
    workspaceId: v.id("workspaces"),
    partId: v.id("binParts"),
    locationId: v.id("binLocations"),
    variant: v.optional(v.string()),
    quantity: v.number(),
  })
    .index("by_part_location_variant", ["partId", "locationId", "variant"])
    .index("by_workspace", ["workspaceId"]),

  // A member taking parts out of a location until they return them.
  binLoans: defineTable({
    workspaceId: v.id("workspaces"),
    partId: v.id("binParts"),
    locationId: v.id("binLocations"),
    variant: v.optional(v.string()),
    quantity: v.number(),
    borrowerId: v.string(),
    borrowedAt: v.number(),
    returnedAt: v.optional(v.number()),
    returnedBy: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_part", ["partId"]),

  binMovements: defineTable({
    workspaceId: v.id("workspaces"),
    partId: v.id("binParts"),
    locationId: v.id("binLocations"),
    variant: v.optional(v.string()),
    kind: v.union(
      v.literal("adjust"),
      v.literal("borrow"),
      v.literal("return")
    ),
    delta: v.number(),
    actorId: v.string(),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_part", ["partId"])
    .index("by_workspace", ["workspaceId"]),
})
