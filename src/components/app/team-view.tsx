"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, MailIcon, ShieldCheckIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { InvitationView, MemberView } from "@/server/modules/companies/members";
import { ASSIGNABLE_ROLE_KEYS, ROLE_DEFINITIONS, type AssignableRoleKey } from "@/server/rbac/permissions";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatDate, initials } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";

type Props = {
  companyId: string;
  companyName: string;
  currentUserId: string;
  canManage: boolean;
  members: MemberView[];
  invitations: InvitationView[];
};

export function TeamView({ companyId, companyName, currentUserId, canManage, members, invitations }: Props) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePending, setInvitePending] = useState(false);
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<AssignableRoleKey>("COLLABORATOR");
  const [toRemove, setToRemove] = useState<MemberView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setInvitePending(true);
    setInviteErrors({});
    setInviteError(null);
    try {
      await api(`/companies/${companyId}/invitations`, { method: "POST", body: { email: form.get("email"), role: selectedRole } });
      toast.success("Invitation envoyée.");
      setInviteOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR") setInviteErrors(error.fieldErrors);
      else setInviteError(errorMessage(error));
    } finally {
      setInvitePending(false);
    }
  }

  async function run(id: string, action: () => Promise<unknown>, success: string) {
    setBusyId(id);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Équipe et accès"
        description={`Personnes ayant accès à ${companyName} et rôle de chacune.`}
        actions={
          canManage ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlusIcon /> Inviter un membre
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Membres ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Membre</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead className="hidden md:table-cell">Sécurité</TableHead>
                <TableHead className="hidden md:table-cell">Depuis le</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const editable = canManage && member.roleKey !== "OWNER" && member.userId !== currentUserId;
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                          {initials(member.firstName, member.lastName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {member.firstName} {member.lastName}
                            {member.userId === currentUserId ? <span className="text-muted-foreground"> (vous)</span> : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <NativeSelect
                          aria-label={`Rôle de ${member.firstName} ${member.lastName}`}
                          className="h-9 w-48"
                          value={member.roleKey}
                          disabled={busyId === member.id}
                          onChange={(e) =>
                            run(
                              member.id,
                              () => api(`/companies/${companyId}/members/${member.id}`, { method: "PATCH", body: { role: e.target.value } }),
                              "Rôle mis à jour.",
                            )
                          }
                        >
                          {ASSIGNABLE_ROLE_KEYS.map((key) => (
                            <option key={key} value={key}>{ROLE_DEFINITIONS[key].name}</option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Badge variant={member.roleKey === "OWNER" ? "default" : "secondary"}>{member.roleName}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {member.mfaEnabled ? (
                        <Badge variant="success"><ShieldCheckIcon /> Double authentification</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Mot de passe seul</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(member.joinedAt.slice(0, 10))}</TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        {editable ? (
                          <Button variant="ghost" size="icon-sm" onClick={() => setToRemove(member)} aria-label={`Retirer ${member.firstName} ${member.lastName}`}>
                            <Trash2Icon className="text-destructive-foreground" />
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {invitations.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Invitations en attente ({invitations.length})</CardTitle>
            <CardDescription>Chaque invitation est valable 7 jours.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                    <MailIcon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {invitation.roleName} · expire le {formatDate(invitation.expiresAt.slice(0, 10))}
                    </p>
                  </div>
                  {canManage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === invitation.id}
                      onClick={() => run(invitation.id, () => api(`/companies/${companyId}/invitations/${invitation.id}`, { method: "DELETE" }), "Invitation annulée.")}
                    >
                      Annuler
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Rôles disponibles</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            {(["OWNER", ...ASSIGNABLE_ROLE_KEYS] as const).map((key) => (
              <div key={key}>
                <dt className="text-sm font-semibold">{ROLE_DEFINITIONS[key].name}</dt>
                <dd className="mt-0.5 text-sm text-muted-foreground">{ROLE_DEFINITIONS[key].description}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Invitation */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter un membre</DialogTitle>
            <DialogDescription>La personne recevra un e-mail pour rejoindre {companyName}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={invite} noValidate className="grid gap-5">
            {inviteError ? (
              <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">{inviteError}</p>
            ) : null}
            <Field id="invite-email" label="Adresse e-mail" error={inviteErrors.email} required>
              <Input name="email" type="email" autoComplete="off" required />
            </Field>
            <Field id="invite-role" label="Rôle" error={inviteErrors.role} hint={ROLE_DEFINITIONS[selectedRole].description} required>
              <NativeSelect value={selectedRole} onChange={(e) => setSelectedRole(e.target.value as AssignableRoleKey)}>
                {ASSIGNABLE_ROLE_KEYS.map((key) => (
                  <option key={key} value={key}>{ROLE_DEFINITIONS[key].name}</option>
                ))}
              </NativeSelect>
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Annuler</Button>
              </DialogClose>
              <Button type="submit" disabled={invitePending}>
                {invitePending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                Envoyer l'invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Retrait d'un membre */}
      <Dialog open={toRemove !== null} onOpenChange={(open) => !open && setToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retirer ce membre ?</DialogTitle>
            <DialogDescription>
              {toRemove ? `${toRemove.firstName} ${toRemove.lastName} n'aura plus accès à ${companyName}. Son historique d'actions reste conservé dans le journal d'audit.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Annuler</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={busyId !== null}
              onClick={async () => {
                if (!toRemove) return;
                await run(toRemove.id, () => api(`/companies/${companyId}/members/${toRemove.id}`, { method: "DELETE" }), "Membre retiré.");
                setToRemove(null);
              }}
            >
              Retirer l'accès
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
