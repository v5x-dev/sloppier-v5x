/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({
    subject: "owner",
    email: "owner@example.com",
    emailVerified: true,
  })
  const member = t.withIdentity({
    subject: "member",
    email: "member@example.com",
    emailVerified: true,
  })
  const recipient = t.withIdentity({
    subject: "recipient",
    email: "teammate@example.com",
    emailVerified: true,
  })
  const workspaceId = await owner.mutation(api.workspaces.create, {
    name: "Robotics team",
  })
  const memberId = await owner.mutation(api.workspaces.addMember, {
    workspaceId,
    userId: "member",
  })
  async function invite(
    email = "teammate@example.com",
    role: "admin" | "member" = "member"
  ) {
    const invitationId = await owner.mutation(api.workspaces.invite, {
      workspaceId,
      email,
      role,
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    return invitationId
  }
  return { t, owner, member, recipient, workspaceId, memberId, invite }
}

describe("workspace invitations and access", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv("RESEND_API_KEY", "")
    vi.stubEnv("WORKOS_API_KEY", "")
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("creates and switches between owned workspaces with admin membership", async () => {
    const { owner } = await setup()
    await owner.mutation(api.workspaces.create, { name: "  Second team  " })
    const workspaces = await owner.query(api.workspaces.listMine)
    expect(
      workspaces.map((entry) => [entry.workspace?.name, entry.role])
    ).toEqual([
      ["Robotics team", "admin"],
      ["Second team", "admin"],
    ])
    await expect(
      owner.mutation(api.workspaces.create, { name: " " })
    ).rejects.toThrow("between 1 and 80")
  })

  it("normalizes emails, shows invitations to verified recipients, and accepts once", async () => {
    const { t, owner, recipient, workspaceId, invite } = await setup()
    const invitationId = await invite("  Teammate@Example.com  ")
    await recipient.action(api.workspaces.syncProfile)
    const pending = await recipient.query(api.workspaces.pendingInvitations)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      email: "teammate@example.com",
      workspaceName: "Robotics team",
      delivery: "unavailable",
    })
    expect(
      await recipient.action(api.workspaces.acceptInvitation, { invitationId })
    ).toBe(workspaceId)
    expect(await recipient.query(api.workspaces.pendingInvitations)).toEqual([])
    expect(await t.run((ctx) => ctx.db.get(invitationId))).toBeNull()
    expect(
      (await owner.query(api.workspaces.listMembers, { workspaceId })).find(
        (member) => member.userId === "recipient"
      )?.role
    ).toBe("member")
    await expect(
      recipient.action(api.workspaces.acceptInvitation, { invitationId })
    ).rejects.toThrow("expired or was revoked")
  })

  it("rejects unauthorized invitation creation, member changes, and member lists", async () => {
    const { t, member, workspaceId, memberId } = await setup()
    await expect(
      t.mutation(api.workspaces.invite, {
        workspaceId,
        email: "a@example.com",
        role: "admin",
      })
    ).rejects.toThrow("Authentication required")
    await expect(
      member.mutation(api.workspaces.invite, {
        workspaceId,
        email: "a@example.com",
        role: "admin",
      })
    ).rejects.toThrow("Only workspace admins")
    await expect(
      member.mutation(api.workspaces.updateMemberRole, {
        memberId,
        role: "admin",
      })
    ).rejects.toThrow("Only workspace admins")
    await expect(
      member.mutation(api.workspaces.removeMember, { memberId })
    ).rejects.toThrow("Only workspace admins")
    await expect(
      member.query(api.workspaces.listMembers, { workspaceId })
    ).rejects.toThrow("Only workspace admins")
    await expect(
      member.query(api.workspaces.listInvitations, { workspaceId })
    ).rejects.toThrow("Only workspace admins")
  })

  it("rejects wrong email and unverified identities without consuming invitations", async () => {
    const { t, member, recipient, invite } = await setup()
    const invitationId = await invite()
    await expect(
      member.action(api.workspaces.acceptInvitation, { invitationId })
    ).rejects.toThrow("email address this invitation was sent to")
    const unverified = t.withIdentity({
      subject: "fake",
      email: "teammate@example.com",
      emailVerified: false,
    })
    await expect(
      unverified.action(api.workspaces.acceptInvitation, { invitationId })
    ).rejects.toThrow("invitation setup")
    expect(await t.run((ctx) => ctx.db.get(invitationId))).not.toBeNull()
    await recipient.action(api.workspaces.acceptInvitation, { invitationId })
  })

  it("requires fresh WorkOS email verification when JWT has no verified email", async () => {
    const { t, invite, workspaceId } = await setup()
    const invitationId = await invite()
    vi.stubEnv("WORKOS_API_KEY", "server-test-key")
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "new-user",
          email: "teammate@example.com",
          email_verified: false,
        })
      )
    )
    vi.stubGlobal("fetch", fetch)
    const user = t.withIdentity({ subject: "new-user" })
    await expect(
      user.action(api.workspaces.acceptInvitation, { invitationId })
    ).rejects.toThrow("Verify your account email")
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "new-user",
          email: "teammate@example.com",
          email_verified: true,
          first_name: "New",
          last_name: "Teammate",
        })
      )
    )
    expect(
      await user.action(api.workspaces.acceptInvitation, { invitationId })
    ).toBe(workspaceId)
    expect(fetch).toHaveBeenCalledWith(
      "https://api.workos.com/user_management/users/new-user",
      expect.objectContaining({
        headers: { Authorization: "Bearer server-test-key" },
      })
    )
  })

  it("rejects expired and revoked invitations", async () => {
    const { owner, recipient, invite } = await setup()
    const expired = await invite()
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000)
    await expect(
      recipient.action(api.workspaces.acceptInvitation, {
        invitationId: expired,
      })
    ).rejects.toThrow("expired or was revoked")
    const revoked = await invite()
    await owner.mutation(api.workspaces.revokeInvitation, {
      invitationId: revoked,
    })
    await expect(
      recipient.action(api.workspaces.acceptInvitation, {
        invitationId: revoked,
      })
    ).rejects.toThrow("expired or was revoked")
  })

  it("prevents cross-workspace revocation and access changes", async () => {
    const { t, owner, memberId, invite } = await setup()
    const invitationId = await invite()
    const outsider = t.withIdentity({
      subject: "outsider",
      email: "outsider@example.com",
      emailVerified: true,
    })
    await outsider.mutation(api.workspaces.create, { name: "Other team" })
    await expect(
      outsider.mutation(api.workspaces.revokeInvitation, { invitationId })
    ).rejects.toThrow("do not have access")
    await expect(
      outsider.mutation(api.workspaces.removeMember, { memberId })
    ).rejects.toThrow("do not have access")
    await expect(
      outsider.mutation(api.workspaces.updateMemberRole, {
        memberId,
        role: "admin",
      })
    ).rejects.toThrow("do not have access")
    await owner.mutation(api.workspaces.revokeInvitation, { invitationId })
  })

  it("keeps owner privileges, prevents changing your own access, and revokes removed members", async () => {
    const { t, owner, member, workspaceId, memberId } = await setup()
    await owner.mutation(api.workspaces.updateMemberRole, {
      memberId,
      role: "admin",
    })
    const ownerId = (
      await member.query(api.workspaces.listMembers, { workspaceId })
    ).find((member) => member.isOwner)!._id
    await expect(
      member.mutation(api.workspaces.updateMemberRole, {
        memberId: ownerId,
        role: "member",
      })
    ).rejects.toThrow("owner must remain")
    await expect(
      member.mutation(api.workspaces.removeMember, { memberId: ownerId })
    ).rejects.toThrow("owner cannot be removed")
    await expect(
      member.mutation(api.workspaces.updateMemberRole, {
        memberId,
        role: "member",
      })
    ).rejects.toThrow("own access")
    await owner.mutation(api.workspaces.updateMemberRole, {
      memberId,
      role: "member",
    })
    await owner.mutation(api.workspaces.removeMember, { memberId })
    expect(await member.query(api.workspaces.listMine)).toEqual([])
    await expect(
      member.query(api.projects.listByWorkspace, { workspaceId })
    ).rejects.toThrow("do not have access")
    expect(await t.run((ctx) => ctx.db.get(memberId))).toBeNull()
  })

  it("does not let an invitation escalate an existing member's role", async () => {
    const { owner, member, workspaceId, invite } = await setup()
    const invitationId = await invite("member@example.com", "admin")
    await member.action(api.workspaces.acceptInvitation, { invitationId })
    expect(
      (await owner.query(api.workspaces.listMembers, { workspaceId })).find(
        (member) => member.userId === "member"
      )?.role
    ).toBe("member")
  })

  it("validates emails and blocks duplicate active invitations", async () => {
    const { owner, workspaceId, invite } = await setup()
    await expect(
      owner.mutation(api.workspaces.invite, {
        workspaceId,
        email: "bad",
        role: "member",
      })
    ).rejects.toThrow("valid email")
    await invite()
    await expect(invite("TEAMMATE@example.com")).rejects.toThrow(
      "already pending"
    )
  })

  it("delivers an email with the correct acceptance link, and exposes provider failure", async () => {
    const { t, owner, workspaceId, invite } = await setup()
    vi.stubEnv("RESEND_API_KEY", "test-resend-key")
    vi.stubEnv("WORKSPACE_INVITE_FROM", "Team <team@example.com>")
    vi.stubEnv("APP_URL", "https://code.example.com")
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetch)
    const invitationId = await invite()
    expect(
      (await owner.query(api.workspaces.listInvitations, { workspaceId }))[0]
        ?.delivery
    ).toBe("sent")
    const request = fetch.mock.calls[0]![1]
    const body = JSON.parse(request.body)
    expect(body.to).toEqual(["teammate@example.com"])
    expect(body.text).toContain(
      `https://code.example.com/invites/${invitationId}`
    )
    expect(body.text).toContain("Sign in with teammate@example.com")
    fetch.mockResolvedValue(new Response("{}", { status: 500 }))
    const failedId = await invite("other@example.com")
    expect(await t.run((ctx) => ctx.db.get(failedId))).toMatchObject({
      delivery: "failed",
    })
    // A queued delivery cannot send an already-revoked invitation.
    await owner.mutation(api.workspaces.revokeInvitation, { invitationId })
    fetch.mockClear()
    await t.action(internal.workspaces.deliverInvitation, { invitationId })
    expect(fetch).not.toHaveBeenCalled()
  })
})
