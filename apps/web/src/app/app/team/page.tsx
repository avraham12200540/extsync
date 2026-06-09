"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui";

interface Member { id: string; userId: string; email: string; displayName: string; role: string; }
interface Team { id: string; name: string; slug: string; members: Member[]; }

export default function TeamPage() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["teams"], queryFn: () => api.get<Team[]>("/teams") });

  const createTeam = useMutation({
    mutationFn: () => api.post<Team>("/teams", { name: newName }),
    onSuccess: () => { setNewName(""); qc.invalidateQueries({ queryKey: ["teams"] }); },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-ink">צוותים</h1>
      <Card className="mb-6">
        <Field label="צוות חדש"><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם הצוות" /></Field>
        <Button onClick={() => createTeam.mutate()} disabled={!newName || createTeam.isPending}>יצירת צוות</Button>
      </Card>

      {isLoading ? <Spinner /> : (data ?? []).length === 0 ? (
        <Card className="text-center text-ink-muted">אינך חבר בצוות עדיין.</Card>
      ) : (
        <div className="space-y-4">
          {(data ?? []).map((team) => <TeamCard key={team.id} team={team} />)}
        </div>
      )}
    </div>
  );
}

function TeamCard({ team }: { team: Team }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("developer");
  const addMember = useMutation({
    mutationFn: () => api.post(`/teams/${team.id}/members`, { email, role }),
    onSuccess: () => { setEmail(""); qc.invalidateQueries({ queryKey: ["teams"] }); },
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) => api.del(`/teams/${team.id}/members/${memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });

  return (
    <Card>
      <h3 className="mb-3 font-semibold text-ink">{team.name}</h3>
      <div className="mb-4 space-y-1">
        {team.members.map((m) => (
          <div key={m.id} className="flex items-center justify-between text-sm">
            <span className="text-ink">{m.displayName || m.email} <span className="text-ink-muted">({m.email})</span></span>
            <div className="flex items-center gap-2">
              <Badge>{m.role}</Badge>
              <Button size="sm" variant="ghost" onClick={() => removeMember.mutate(m.id)}>הסר</Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1"><Field label="הוספת חבר (אימייל)"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field></div>
        <select value={role} onChange={(e) => setRole(e.target.value)}
                className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
          <option value="viewer">Viewer</option>
          <option value="developer">Developer</option>
          <option value="release_manager">Release Manager</option>
          <option value="admin">Admin</option>
        </select>
        <Button className="mb-4" onClick={() => addMember.mutate()} disabled={!email}>הוסף</Button>
      </div>
    </Card>
  );
}
