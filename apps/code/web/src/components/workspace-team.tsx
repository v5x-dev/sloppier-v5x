import { useEffect, useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { Link } from "@tanstack/react-router"
import { api } from "@workspace/backend/api"
import type { Doc, Id } from "@workspace/backend/dataModel"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"
import { errorMessage } from "@/lib/errors"

type Role = "admin" | "member"

function report(error: unknown) {
  toast.add({
    type: "error",
    title: "Could not update the workspace",
    description: errorMessage(error),
  })
}

export function NewWorkspace({
  onCreated,
  open,
  onOpenChange: setOpen,
}: {
  onCreated: (id: Id<"workspaces">) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useMutation(api.workspaces.create)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            try {
              const id = await create({ name })
              onCreated(id)
              setName("")
              setOpen(false)
            } catch (error) {
              report(error)
            } finally {
              setPending(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              Create a shared home for your team's programs.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
          </Field>
          <Button disabled={pending || !name.trim()} type="submit">
            {pending && <Spinner />}Create workspace
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceTeam({
  workspace,
  open,
  onOpenChange: setOpen,
}: {
  workspace: Doc<"workspaces">
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{workspace.name} team</DialogTitle>
          <DialogDescription>
            Admins can invite people and manage access to every program in this
            workspace.
          </DialogDescription>
        </DialogHeader>
        {open && <TeamSettings workspaceId={workspace._id} />}
      </DialogContent>
    </Dialog>
  )
}

function TeamSettings({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const members = useQuery(api.workspaces.listMembers, { workspaceId })
  const invitations = useQuery(api.workspaces.listInvitations, { workspaceId })
  const invite = useMutation(api.workspaces.invite)
  const revoke = useMutation(api.workspaces.revokeInvitation)
  const updateRole = useMutation(api.workspaces.updateMemberRole)
  const remove = useMutation(api.workspaces.removeMember)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("member")
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<Id<"workspaceMembers"> | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [manualLink, setManualLink] = useState("")

  async function run(operation: () => Promise<unknown>) {
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            await invite({ workspaceId, email, role })
            setEmail("")
          })
        }}
      >
        <Field>
          <FieldLabel htmlFor="invite-email">Invite by email</FieldLabel>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
            placeholder="teammate@example.com"
          />
        </Field>
        <div className="flex items-end gap-3">
          <RolePicker
            id="invite-role"
            value={role}
            onChange={setRole}
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy && <Spinner />}Invite
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Invitations expire in 7 days. Your teammate must sign in with the
          invited email address.
        </p>
      </form>
      <section className="flex flex-col gap-3" aria-label="Workspace members">
        <h3 className="font-semibold">Members</h3>
        {members === undefined && <Spinner />}
        {members?.map((member) => (
          <div
            key={member._id}
            className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm break-all">
                {member.name ||
                  member.email ||
                  (member.isSelf ? "You" : "Team member")}
                {member.isOwner && " · Owner"}
              </p>
              {member.email && member.name && (
                <p className="text-xs break-all text-muted-foreground">
                  {member.email}
                </p>
              )}
            </div>
            {member.isOwner || member.isSelf ? (
              <span className="text-sm text-muted-foreground">Admin</span>
            ) : (
              <>
                <RolePicker
                  id={`role-${member._id}`}
                  value={member.role}
                  label={`Role for ${member.name || member.email || "Team member"}`}
                  disabled={busy}
                  onChange={(newRole) =>
                    void run(() =>
                      updateRole({ memberId: member._id, role: newRole })
                    )
                  }
                />
                {removing === member._id ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await remove({ memberId: member._id })
                          setRemoving(null)
                        })
                      }
                    >
                      Confirm removal
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoving(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRemoving(member._id)}
                  >
                    Remove
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-3" aria-label="Pending invitations">
        <h3 className="font-semibold">Pending invitations</h3>
        {invitations === undefined && <Spinner />}
        {invitations?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No pending invitations.
          </p>
        )}
        {invitations?.map((invitation) => (
          <div
            key={invitation._id}
            className="flex flex-wrap items-center justify-between gap-2 border-b pb-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm break-all">{invitation.email}</p>
              <p className="text-xs text-muted-foreground">
                {invitation.role === "admin" ? "Admin" : "Member"} ·{" "}
                {deliveryLabel(invitation.delivery)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const link = `${window.location.origin}/invites/${invitation._id}`
                try {
                  await navigator.clipboard.writeText(link)
                  setCopied(invitation._id)
                } catch {
                  setManualLink(link)
                }
              }}
            >
              {copied === invitation._id ? "Copied" : "Copy link"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(() => revoke({ invitationId: invitation._id }))
              }
            >
              Revoke
            </Button>
          </div>
        ))}
        {manualLink && (
          <Field>
            <FieldLabel htmlFor="invitation-link">
              Copy this invitation link
            </FieldLabel>
            <Input
              id="invitation-link"
              value={manualLink}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </Field>
        )}
      </section>
    </div>
  )
}

function RolePicker({
  id,
  value,
  onChange,
  disabled,
  label = "Role",
}: {
  id: string
  value: Role
  onChange: (role: Role) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Role)}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
    </Field>
  )
}

function deliveryLabel(delivery: Doc<"workspaceInvitations">["delivery"]) {
  switch (delivery) {
    case "pending":
      return "Sending email…"
    case "sent":
      return "Email sent"
    case "unavailable":
      return "Email delivery is not configured. Share the link."
    case "failed":
      return "Email could not be sent. Share the link."
  }
}

export function WorkspaceInvitations({
  invitationId,
  onAccepted,
  showEmpty = false,
}: {
  showEmpty?: boolean
  invitationId?: string
  onAccepted?: (workspaceId: Id<"workspaces">) => void
}) {
  const sync = useAction(api.workspaces.syncProfile)
  const accept = useAction(api.workspaces.acceptInvitation)
  const invitations = useQuery(api.workspaces.pendingInvitations)
  const [synced, setSynced] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError("")
    setSynced(false)
    void sync({})
      .then(() => {
        if (!cancelled) setSynced(true)
      })
      .catch((failure) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    return () => {
      cancelled = true
    }
  }, [sync, retry])
  const visible = invitations?.filter(
    (invite) => !invitationId || invite._id === invitationId
  )
  if (!invitationId && !showEmpty && synced && visible?.length === 0)
    return null
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-4"
      aria-label="Workspace invitations"
    >
      <h2 className="font-semibold">
        {joined ? "Workspace joined" : "Workspace invitations"}
      </h2>
      {error ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetry(retry + 1)}
          >
            Try again
          </Button>
        </div>
      ) : !synced || invitations === undefined ? (
        <Spinner />
      ) : (
        <>
          {!invitationId && visible?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No pending invitations.
            </p>
          )}
          {!joined && invitationId && visible?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This invitation has expired, was revoked, or belongs to another
              email address. Sign in with the invited account, or ask a
              workspace admin for a new invitation.
            </p>
          )}
          {visible?.map((invitation) => (
            <div
              key={invitation._id}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <p className="text-sm">Join {invitation.workspaceName}</p>
                <p className="text-xs text-muted-foreground">
                  Invited as{" "}
                  {invitation.role === "admin" ? "an admin" : "a member"} ·{" "}
                  {invitation.email}
                </p>
              </div>
              <Button
                disabled={pending !== null}
                onClick={async () => {
                  setPending(invitation._id)
                  try {
                    const workspaceId = await accept({
                      invitationId: invitation._id,
                    })
                    setJoined(true)
                    onAccepted?.(workspaceId)
                    toast.add({
                      type: "success",
                      title: `Joined ${invitation.workspaceName}`,
                    })
                  } catch (failure) {
                    report(failure)
                  } finally {
                    setPending(null)
                  }
                }}
              >
                {pending === invitation._id && <Spinner />}Accept invitation
              </Button>
            </div>
          ))}
        </>
      )}
      {invitationId && (
        <Button variant="outline" render={<Link to="/" />} nativeButton={false}>
          Back to programs
        </Button>
      )}
    </section>
  )
}
