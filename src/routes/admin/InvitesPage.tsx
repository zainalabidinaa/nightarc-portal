import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import type { InviteCode } from '../../types';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function InvitesPage() {
  const { user } = useAuth();
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from('invite_codes').select('*').order('created_at', { ascending: false });
    setCodes(data ?? []);
    setLoading(false);
  }

  async function handleGenerate() {
    if (!user) return;
    setGenerating(true);
    const code = generateCode();
    const { error } = await supabase.from('invite_codes').insert({ code, created_by: user.id, is_active: true, max_uses: 1 });
    if (!error) { setLastGenerated(code); load(); }
    setGenerating(false);
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-text">Invite Codes</h1>
          <Button onClick={handleGenerate} loading={generating}>Generate Code</Button>
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
                  <th className="text-left px-4 py-3 font-medium text-muted">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {codes.map(c => (
                  <tr key={c.code} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono font-semibold text-text">{c.code}</td>
                    <td className="px-4 py-3">
                      {c.used_by ? (
                        <Badge variant="default">Used</Badge>
                      ) : c.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="danger">Inactive</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {!c.used_by && <Button size="sm" variant="ghost" onClick={() => copyCode(c.code)}>Copy</Button>}
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
