"use client";
import { useEffect, useState } from "react";
import { UserPlus, Users, Trash2 } from "lucide-react";

interface AllowedUser {
  id: number;
  email: string;
  name: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
interface Resp { ok: boolean; users: AllowedUser[]; currentEmail: string | null }

export default function AllowedUsersPanel() {
  const [users, setUsers] = useState<AllowedUser[]>([]);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/settings/allowed-users");
      const j: Resp = await r.json();
      if (!r.ok) throw new Error((j as unknown as { error?: string }).error ?? `HTTP ${r.status}`);
      setUsers(j.users);
      setCurrentEmail(j.currentEmail);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to load users"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true); setErr(null);
    try {
      const r = await fetch("/api/settings/allowed-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), name: newName.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setNewEmail(""); setNewName("");
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to add user"); }
    finally { setAdding(false); }
  }

  async function toggleActive(u: AllowedUser) {
    if (!confirm(u.active ? `Deactivate ${u.email}?` : `Reactivate ${u.email}?`)) return;
    setErr(null);
    try {
      const r = await fetch(`/api/settings/allowed-users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !u.active }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to update"); }
  }

  async function removeUser(u: AllowedUser) {
    if (!confirm(`Delete ${u.email} from the allowlist? This cannot be undone.`)) return;
    setErr(null);
    try {
      const r = await fetch(`/api/settings/allowed-users/${u.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to delete"); }
  }

  return (
    <div id="allowed-users" className="panel settings-panel">
      <div className="settings-head"><Users size={14} /> Allowed users &nbsp;<span className="muted small">{users.length} total · {users.filter((u) => u.active).length} active</span></div>
      <div className="settings-note">Google Sign-In is gated by this list. Add teammates by their <b>@rw.team</b> Google email; they can log in immediately — no restart needed.</div>

      <form className="allowed-add-form" onSubmit={addUser}>
        <input type="email" placeholder="teammate@rw.team" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="input" />
        <input type="text" placeholder="Name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} className="input" />
        <button type="submit" className="btn-primary" disabled={adding || !newEmail.trim()}>
          <UserPlus size={13} /> {adding ? "Adding…" : "Add user"}
        </button>
      </form>

      {err && <div className="anomaly-banner anomaly-banner-error" style={{ marginBottom: 8 }}>{err}</div>}

      <div className="allowed-users-table-wrap">
        {loading && <div className="muted small">Loading…</div>}
        {!loading && (
          <table className="allowed-users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Status</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.email.toLowerCase() === (currentEmail ?? "").toLowerCase();
                return (
                  <tr key={u.id} className={u.active ? "" : "inactive"}>
                    <td className="mono">{u.email} {isMe && <span className="chip chip-me">you</span>}</td>
                    <td>{u.name ?? <span className="muted">—</span>}</td>
                    <td>
                      <button className={`allowed-status-toggle ${u.active ? "on" : "off"}`} onClick={() => toggleActive(u)} disabled={isMe} title={isMe ? "You can't deactivate yourself" : (u.active ? "Click to deactivate" : "Click to reactivate")}>
                        {u.active ? "✓ Active" : "✗ Inactive"}
                      </button>
                    </td>
                    <td className="muted small">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button className="btn-ghost btn-danger" onClick={() => removeUser(u)} disabled={isMe} title={isMe ? "You can't delete yourself" : "Delete"}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 20 }}>No allowed users. Add your own email first before anyone else can sign in.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
