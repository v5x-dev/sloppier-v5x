import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type ActionCtx,
} from "./_generated/server"
import { ConvexError, v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { requireIdentity, requireWorkspaceMembership } from "./lib/auth"

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx)
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect()

    return Promise.all(
      memberships.map(async (membership) => ({
        workspace: await ctx.db.get(membership.workspaceId),
        role: membership.role,
      }))
    )
  },
})

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const name = args.name.trim()

    if (name.length === 0 || name.length > 80) {
      throw new ConvexError(
        "Workspace name must be between 1 and 80 characters."
      )
    }

    return insertWorkspace(ctx, identity.subject, name)
  },
})

export const setIcon = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    icon: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { workspaceId, icon }) => {
    const { membership } = await requireWorkspaceMembership(ctx, workspaceId)
    if (membership.role !== "admin") {
      throw new ConvexError("Only workspace admins can change the icon.")
    }
    if (
      icon !== null &&
      (icon.length > 175000 ||
        !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
          icon
        ))
    ) {
      throw new ConvexError(
        "Choose a PNG, JPEG, WebP, or GIF image under 128 KB."
      )
    }
    await ctx.db.patch(workspaceId, { icon: icon ?? undefined })
  },
})

// Gives a new user somewhere to put programs. Safe to call repeatedly:
// it does nothing once the user belongs to any workspace.
export const ensurePersonal = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx)
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first()
    if (membership) {
      return membership.workspaceId
    }

    return insertWorkspace(ctx, identity.subject, "Personal")
  },
})

export const listMembers = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { membership } = await requireWorkspaceMembership(ctx, workspaceId)
    if (membership.role !== "admin") {
      throw new ConvexError("Only workspace admins can list members.")
    }
    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
    const workspace = await ctx.db.get(workspaceId)
    return Promise.all(
      members.map(async (member) => {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_user", (q) => q.eq("userId", member.userId))
          .unique()
        return {
          ...member,
          email: profile?.email,
          name: profile?.name,
          isOwner: workspace?.ownerId === member.userId,
          isSelf: membership.userId === member.userId,
        }
      })
    )
  },
})

export const addMember = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireWorkspaceMembership(
      ctx,
      args.workspaceId
    )
    if (membership.role !== "admin") {
      throw new ConvexError("Only workspace admins can add members.")
    }
    const userId = args.userId.trim()
    if (userId.length === 0 || userId.length > 256) {
      throw new ConvexError("A valid WorkOS user ID is required.")
    }

    const existing = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", userId)
      )
      .unique()
    if (existing) {
      return existing._id
    }

    return ctx.db.insert("workspaceMembers", {
      workspaceId: args.workspaceId,
      userId,
      role: args.role ?? "member",
      joinedAt: Date.now(),
    })
  },
})

async function insertWorkspace(ctx: MutationCtx, userId: string, name: string) {
  const now = Date.now()
  const workspaceId = await ctx.db.insert("workspaces", {
    name,
    ownerId: userId,
    createdAt: now,
  })

  await ctx.db.insert("workspaceMembers", {
    workspaceId,
    userId,
    role: "admin",
    joinedAt: now,
  })

  return workspaceId
}

const roleValidator = v.union(v.literal("admin"), v.literal("member"))
const INVITATION_TTL = 7 * 24 * 60 * 60 * 1000

async function requireAdmin(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const access = await requireWorkspaceMembership(ctx, workspaceId)
  if (access.membership.role !== "admin")
    throw new ConvexError("Only workspace admins can manage the team.")
  return access
}

// Email addresses come from a signed, verified claim or WorkOS, never the browser.
async function verifiedProfile(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new ConvexError("Authentication required.")
  if (identity.email && identity.emailVerified === true) {
    return {
      userId: identity.subject,
      email: identity.email.toLowerCase().trim(),
      name: identity.name ?? identity.email,
    }
  }
  const key = process.env.WORKOS_API_KEY
  if (!key)
    throw new ConvexError(
      "We could not verify your account email. Ask the workspace owner to check invitation setup."
    )
  const response = await fetch(
    `https://api.workos.com/user_management/users/${encodeURIComponent(identity.subject)}`,
    {
      headers: { Authorization: `Bearer ${key}` },
    }
  )
  if (!response.ok)
    throw new ConvexError(
      "Could not verify your email with WorkOS. Please try again."
    )
  const user = (await response.json()) as {
    id: string
    email: string
    email_verified: boolean
    first_name?: string
    last_name?: string
  }
  if (user.id !== identity.subject || !user.email_verified || !user.email)
    throw new ConvexError(
      "Verify your account email before accepting workspace invitations."
    )
  return {
    userId: identity.subject,
    email: user.email.trim().toLowerCase(),
    name:
      [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email,
  }
}

export const saveProfile = internalMutation({
  args: { userId: v.string(), email: v.string(), name: v.string() },
  handler: async (ctx, profile) => {
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", profile.userId))
      .unique()
    if (existing) await ctx.db.patch(existing._id, profile)
    else await ctx.db.insert("userProfiles", profile)
  },
})

export const syncProfile = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const profile = await verifiedProfile(ctx)
    await ctx.runMutation(internal.workspaces.saveProfile, profile)
  },
})

export const invite = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    email: v.string(),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const { identity } = await requireAdmin(ctx, args.workspaceId)
    const email = args.email.trim().toLowerCase()
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ConvexError("Enter a valid email address.")
    const invitations = await ctx.db
      .query("workspaceInvitations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect()
    const existing = invitations.find(
      (invite) => invite.email === email && invite.expiresAt > Date.now()
    )
    if (existing)
      throw new ConvexError(
        "An invitation for this email is already pending. Copy its link or revoke it first."
      )
    if (
      invitations.filter((invite) => invite.expiresAt > Date.now()).length >= 50
    )
      throw new ConvexError(
        "A workspace can have up to 50 pending invitations."
      )
    // Remove expired invitations for this address before replacing them.
    for (const old of invitations.filter((invite) => invite.email === email))
      await ctx.db.delete(old._id)
    const invitationId = await ctx.db.insert("workspaceInvitations", {
      workspaceId: args.workspaceId,
      email,
      role: args.role,
      invitedBy: identity.subject,
      expiresAt: Date.now() + INVITATION_TTL,
      delivery: "pending",
    })
    await ctx.scheduler.runAfter(0, internal.workspaces.deliverInvitation, {
      invitationId,
    })
    return invitationId
  },
})

export const pendingInvitations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx)
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique()
    if (!profile) return []
    const invitations = await ctx.db
      .query("workspaceInvitations")
      .withIndex("by_email", (q) => q.eq("email", profile.email))
      .collect()
    return Promise.all(
      invitations
        .filter((invite) => invite.expiresAt > Date.now())
        .map(async (invite) => ({
          ...invite,
          workspaceName:
            (await ctx.db.get(invite.workspaceId))?.name ?? "Workspace",
        }))
    )
  },
})

export const listInvitations = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { membership } = await requireWorkspaceMembership(ctx, workspaceId)
    if (membership.role !== "admin")
      throw new ConvexError("Only workspace admins can list invitations.")
    return (
      await ctx.db
        .query("workspaceInvitations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).filter((invite) => invite.expiresAt > Date.now())
  },
})

export const acceptInvitation = action({
  args: { invitationId: v.id("workspaceInvitations") },
  handler: async (ctx, { invitationId }): Promise<Id<"workspaces">> => {
    const profile = await verifiedProfile(ctx)
    await ctx.runMutation(internal.workspaces.saveProfile, profile)
    return ctx.runMutation(internal.workspaces.acceptVerifiedInvitation, {
      invitationId,
      userId: profile.userId,
      email: profile.email,
    })
  },
})

export const acceptVerifiedInvitation = internalMutation({
  args: {
    invitationId: v.id("workspaceInvitations"),
    userId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, { invitationId, userId, email }) => {
    const invitation = await ctx.db.get(invitationId)
    if (!invitation || invitation.expiresAt <= Date.now())
      throw new ConvexError("This invitation has expired or was revoked.")
    if (invitation.email !== email)
      throw new ConvexError(
        "Sign in with the email address this invitation was sent to."
      )
    if (!(await ctx.db.get(invitation.workspaceId)))
      throw new ConvexError("This workspace no longer exists.")
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", invitation.workspaceId).eq("userId", userId)
      )
      .unique()
    // Reaccepting an invitation must not change an existing member's privileges.
    if (!member)
      await ctx.db.insert("workspaceMembers", {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
        joinedAt: Date.now(),
      })
    await ctx.db.delete(invitationId)
    return invitation.workspaceId
  },
})

export const revokeInvitation = mutation({
  args: { invitationId: v.id("workspaceInvitations") },
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId)
    if (!invitation) throw new ConvexError("Invitation not found.")
    await requireAdmin(ctx, invitation.workspaceId)
    await ctx.db.delete(invitationId)
  },
})

export const updateMemberRole = mutation({
  args: { memberId: v.id("workspaceMembers"), role: roleValidator },
  handler: async (ctx, { memberId, role }) => {
    const member = await ctx.db.get(memberId)
    if (!member) throw new ConvexError("Member not found.")
    const { identity } = await requireAdmin(ctx, member.workspaceId)
    if (member.userId === identity.subject)
      throw new ConvexError("Ask another admin to change your own access.")
    const workspace = await ctx.db.get(member.workspaceId)
    if (workspace?.ownerId === member.userId)
      throw new ConvexError("The workspace owner must remain an admin.")
    await ctx.db.patch(memberId, { role })
  },
})

export const removeMember = mutation({
  args: { memberId: v.id("workspaceMembers") },
  handler: async (ctx, { memberId }) => {
    const member = await ctx.db.get(memberId)
    if (!member) throw new ConvexError("Member not found.")
    const { identity } = await requireAdmin(ctx, member.workspaceId)
    if (member.userId === identity.subject)
      throw new ConvexError("Ask another admin to change your own access.")
    const workspace = await ctx.db.get(member.workspaceId)
    if (workspace?.ownerId === member.userId)
      throw new ConvexError("The workspace owner cannot be removed.")
    await ctx.db.delete(memberId)
  },
})

export const invitationForDelivery = internalQuery({
  args: { invitationId: v.id("workspaceInvitations") },
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId)
    if (!invitation || invitation.expiresAt <= Date.now()) return null
    return {
      ...invitation,
      workspaceName:
        (await ctx.db.get(invitation.workspaceId))?.name ?? "Workspace",
    }
  },
})

export const recordDelivery = internalMutation({
  args: {
    invitationId: v.id("workspaceInvitations"),
    delivery: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("unavailable")
    ),
  },
  handler: async (ctx, { invitationId, delivery }) => {
    if (await ctx.db.get(invitationId))
      await ctx.db.patch(invitationId, { delivery })
  },
})

export const deliverInvitation = internalAction({
  args: { invitationId: v.id("workspaceInvitations") },
  handler: async (ctx, { invitationId }): Promise<void> => {
    const invitation = await ctx.runQuery(
      internal.workspaces.invitationForDelivery,
      { invitationId }
    )
    if (!invitation) return
    const key = process.env.RESEND_API_KEY
    const from = process.env.WORKSPACE_INVITE_FROM
    const origin = process.env.APP_URL
    if (!key || !from || !origin) {
      await ctx.runMutation(internal.workspaces.recordDelivery, {
        invitationId,
        delivery: "unavailable",
      })
      return
    }
    try {
      const base = new URL(origin)
      if (base.protocol !== "https:" && base.hostname !== "localhost")
        throw new Error("APP_URL must use HTTPS.")
      const link = new URL(`/invites/${invitationId}`, base).href
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `workspace-invitation-${invitationId}`,
        },
        body: JSON.stringify({
          from,
          to: [invitation.email],
          subject: `Join ${invitation.workspaceName} on code (by v5x)`,
          text: `You've been invited to ${invitation.workspaceName} as ${invitation.role}.\n\nSign in with ${invitation.email} to accept:\n${link}\n\nThis invitation expires in 7 days. If you weren't expecting it, you can ignore this email.`,
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok)
        throw new Error("Email provider rejected the invitation.")
      await ctx.runMutation(internal.workspaces.recordDelivery, {
        invitationId,
        delivery: "sent",
      })
    } catch {
      await ctx.runMutation(internal.workspaces.recordDelivery, {
        invitationId,
        delivery: "failed",
      })
    }
  },
})
