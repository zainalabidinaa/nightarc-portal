import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { authHeaders } from '../../lib/auth-headers';
import { useAuth } from '../../context/AuthContext';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import type { InviteCode } from '../../types';

// `redeemed_streams` is the redeemer's LIVE profile state, not the code's
// static `includes_streams` flag — the admin can grant/revoke streams directly
// on the Users page after redemption, and codes issued before that column
// existed default to false forever even for users who now have streams.
// Undefined means "not yet redeemed"; the table falls back to the code's flag.
type InviteRow = InviteCode & { redeemed_by_label?: string | null; redeemed_streams?: boolean };

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function durationDisplay(days: number | null): string {
  if (days === null) return 'Never';
  return `${days} days`;
}

export default function InvitesPage() {
  const { user, session } = useAuth();
  const [codes, setCodes] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [newCodeExpiresAt, setNewCodeExpiresAt] = useState('');
  const [newCodeDuration, setNewCodeDuration] = useState('30');
  const [newCodeCustomDays, setNewCodeCustomDays] = useState('');
  const [showCustomDuration, setShowCustomDuration] = useState(false);
  // Whether the code grants stream addons. Off by default: a code should only
  // carry a stream source when you deliberately say so.
  const [newCodeIncludesStreams, setNewCodeIncludesStreams] = useState(false);

  useEffect(() => {
    if (!session) return;
    load();
  }, [session]);

  async function load() {
    const { data: inviteCodes } = await supabase.from('invite_codes').select('*').order('created_at', { ascending: false });
    const codes = (inviteCodes ?? []) as InviteRow[];
    const usedIds = Array.from(new Set(codes.map(c => c.used_by).filter(Boolean))) as string[];

    if (usedIds.length > 0 && session) {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/admin-users?ids=${usedIds.join(',')}`,
          { headers: await authHeaders() },
        );
        if (res.ok) {
          const data = await res.json();
          type Row = { id: string; email: string; stream_addons_enabled: boolean };
          const userMap = new Map<string, Row>((data.users ?? []).map((u: Row) => [u.id, u]));
          setCodes(codes.map(c => ({
            ...c,
            redeemed_by_label: c.used_email || (c.used_by ? userMap.get(c.used_by)?.email || c.used_by : null),
            redeemed_streams: c.used_by ? userMap.get(c.used_by)?.stream_addons_enabled : undefined,
          })));
        } else {
          console.warn('admin-users?ids= failed:', res.status);
          setCodes(codes.map(c => ({
            ...c,
            redeemed_by_label: c.used_email || c.used_by,
          })));
        }
      } catch (e) {
        console.warn('admin-users?ids= network error:', e);
        setCodes(codes.map(c => ({
          ...c,
          redeemed_by_label: c.used_email || c.used_by,
        })));
      }
    } else {
      setCodes(codes);
    }
    setLoading(false);
  }

  async function handleGenerate() {
    if (!user) return;
    setGenerating(true);
    const code = generateCode();
    const expiresIso = dateTimeInputToISO(newCodeExpiresAt);
    const durationDays = newCodeDuration === 'never' ? null
      : newCodeDuration === 'custom' ? (parseInt(newCodeCustomDays) || 30)
      : parseInt(newCodeDuration);

    console.log('creating invite code:', { code, durationDays, newCodeDuration });

    const { error } = await supabase.rpc('create_invite_code', {
      p_code: code,
      p_created_by: user.id,
      p_expires_at: expiresIso,
      p_role_duration_days: durationDays,
      // Redeeming this code stamps profiles.stream_addons_enabled, which makes
      // install_curated_setup() provision stream addons too. See
      // 20260811_invite_code_stream_addons.sql.
      p_includes_streams: newCodeIncludesStreams,
    });
    if (!error) { setLastGenerated(code); load(); }
    setGenerating(false);
  }

  async function handleDeleteAll() {
    if (!window.confirm('Delete ALL invite codes? This cannot be undone.')) return;
    setDeleting(true);
    for (const c of codes) {
      await supabase.rpc('delete_invite_code', { p_code: c.code });
    }
    setDeleting(false);
    setCodes([]);
  }

  async function handleDeleteOne(code: string) {
    setDeletingCode(code);
    await supabase.rpc('delete_invite_code', { p_code: code });
    setDeletingCode(null);
    setCodes(prev => prev.filter(c => c.code !== code));
  }

  async function updateExpiration(code: string, value: string) {
    const expiresAt = dateTimeInputToISO(value);
    const { error } = await supabase.rpc('update_invite_expiration', { p_code: code, p_expires_at: expiresAt });
    if (!error) setCodes(prev => prev.map(c => c.code === code ? { ...c, expires_at: expiresAt } : c));
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
  }

  function dateTimeInputToISO(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function isoToDateTimeInput(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  function isExpired(code: InviteCode): boolean {
    return !!code.expires_at && new Date(code.expires_at) <= new Date();
  }

  function statusFor(code: InviteCode): { label: string; variant: 'default' | 'success' | 'danger' | 'warning' } {
    if (code.used_by) return { label: 'Used', variant: 'default' };
    if (!code.is_active) return { label: 'Inactive', variant: 'danger' };
    if (isExpired(code)) return { label: 'Expired', variant: 'warning' };
    return { label: 'Active', variant: 'success' };
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-text">Invite Codes</h1>
          <div className="flex items-center gap-2">
            <select
              value={newCodeDuration === 'custom' && showCustomDuration ? 'custom' : newCodeDuration}
              onChange={e => {
                setNewCodeDuration(e.target.value);
                setShowCustomDuration(e.target.value === 'custom');
              }}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
            >
              <option value="7">Role: 7 days</option>
              <option value="30">Role: 30 days</option>
              <option value="90">Role: 90 days</option>
              <option value="custom">Role: Custom…</option>
              <option value="never">Role: Never</option>
            </select>
            {newCodeDuration === 'custom' && showCustomDuration && (
              <input
                type="number"
                placeholder="Days"
                value={newCodeCustomDays}
                onChange={e => setNewCodeCustomDays(e.target.value)}
                className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
              />
            )}
            <input
              type="datetime-local"
              value={newCodeExpiresAt}
              onChange={e => setNewCodeExpiresAt(e.target.value)}
              placeholder="Code expires (optional)"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <Button size="sm" variant="ghost" onClick={() => setNewCodeExpiresAt('')}>Never</Button>
            <label
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text cursor-pointer select-none"
              title="Grants the redeemer your stream addons on top of the usual catalogs and metadata"
            >
              <input
                type="checkbox"
                checked={newCodeIncludesStreams}
                onChange={e => setNewCodeIncludesStreams(e.target.checked)}
                className="accent-accent"
              />
              Stream addons
            </label>
            <Button onClick={handleGenerate} loading={generating}>Generate Code</Button>
            <Button variant="danger" onClick={handleDeleteAll} loading={deleting} disabled={codes.length === 0}>Delete All</Button>
          </div>
        </div>

        {lastGenerated && (
          <Card className="p-4 mb-6 flex items-center gap-3 border-accent">
            <div className="flex-1">
              <p className="text-xs text-muted mb-1">New invite code</p>
              <p className="text-xl font-mono font-bold text-accent tracking-widest">{lastGenerated}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => copyCode(lastGenerated)}>Copy</Button>
          </Card>
        )}

        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg">
                  <th className="text-left px-4 py-3 font-medium text-muted">Code</th>
                  <th className="text-left px-4 py-3 font-medium text-muted">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted">Used by</th>
                  <th className="text-left px-4 py-3 font-medium text-muted">Role duration</th>
                  <th className="text-left px-4 py-3 font-medium text-muted">Addons</th>
                  <th className="text-left px-4 py-3 font-medium text-muted">Code expires</th>
                  <th className="text-left px-4 py-3 font-medium text-muted">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {codes.map(c => (
                  <tr key={c.code} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono font-semibold text-text">{c.code}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusFor(c).variant}>{statusFor(c).label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {c.used_by ? (
                        <div>
                          <p className="text-text">{(c as InviteCode & { redeemed_by_label?: string | null }).redeemed_by_label || c.used_email || c.used_by}</p>
                          {c.used_at && <p className="text-xs text-muted">{new Date(c.used_at).toLocaleString()}</p>}
                        </div>
                      ) : (
                        <span className="text-muted/60">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{durationDisplay(c.role_duration_days)}</td>
                    <td className="px-4 py-3">
                      {/* Redeemed codes show the user's CURRENT entitlement (can
                          diverge from what the code originally granted — see the
                          Users page toggle); unredeemed codes preview what
                          redeeming would grant. */}
                      {(c.redeemed_streams ?? c.includes_streams)
                        ? <Badge variant="success">Streams</Badge>
                        : <span className="text-muted/60">Catalogs only</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="datetime-local"
                          value={isoToDateTimeInput(c.expires_at)}
                          onChange={e => updateExpiration(c.code, e.target.value)}
                          className="w-44 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
                        />
                        <button onClick={() => updateExpiration(c.code, '')} className="text-xs text-muted hover:text-text">Never</button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {!c.used_by && <Button size="sm" variant="ghost" onClick={() => copyCode(c.code)}>Copy</Button>}
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteOne(c.code)} loading={deletingCode === c.code}>
                          <span className="text-red-400">Delete</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
