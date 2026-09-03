import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { AppShell } from '../../components/layout/AppShell';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { DragHandle } from '../../components/ui/DragHandle';
import { Badge } from '../../components/ui/Badge';
import type { InstalledAddon } from '../../types';

// Bundled on every device regardless of what's in `installed_addons` — see
// AddonRepository.swift's `managedURLs` comment: these are merged in-memory
// client-side and deliberately never written to the DB, so this page must
// list them separately or they're invisible to the user entirely.
const BUILTIN_ADDON_NAMES: Record<string, string> = {
  'aiometadata.fortheweak.cloud': 'AIOMetadata',
  'opensubtitlesv3-pro.dexter21767.com': 'OpenSubtitles Pro',
};

export default function AddonsPage() {
  const { activeProfile, role, refreshProfiles } = useAuth();
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const [lastInstallCount, setLastInstallCount] = useState<number | null>(null);
  const [curatedSyncedAt, setCuratedSyncedAt] = useState<string | null>(
    activeProfile?.curated_setup_synced_at ?? null,
  );
  const dragIndex = useRef<number | null>(null);

  const isManaged = role === 'premium';
  const canEdit = role === 'admin' || role === 'premium_plus';
  const curatedSetupInstalled = activeProfile?.curated_setup_installed === true || curatedSyncedAt != null;

  useEffect(() => {
    if (!activeProfile) return;
    async function load() {
      setLoading(true);
      let profileId = activeProfile!.id;
      // uses_primary_addons defaults to true and is never cleared for admin
      // profiles (install_curated_setup() returns early for role='admin'
      // before it would flip the flag), so an admin must always see their
      // own installed_addons — never redirect to "the" admin profile, which
      // is ambiguous whenever an account has more than one admin-role
      // profile (e.g. multiple household profiles under one account).
      if (activeProfile!.role !== 'admin' && activeProfile!.uses_primary_addons) {
        const { data } = await supabase
          .from('profiles').select('id').eq('role', 'admin').order('created_at').limit(1).single();
        if (data) profileId = data.id;
      }
      const { data } = await supabase.from('installed_addons').select('*').eq('profile_id', profileId).order('sort_order');
      setAddons(data ?? []);
      setLoading(false);
    }
    load();
  }, [activeProfile]);

  async function handleAdd() {
    if (!newUrl.trim() || !activeProfile) return;
    if (!newUrl.startsWith('https://')) { setError('URL must start with https://'); return; }
    setSaving(true);
    const { error: e } = await supabase.from('installed_addons').insert({
      profile_id: activeProfile.id,
      addon_url: newUrl.trim(),
      sort_order: addons.length,
    });
    if (e) { setError(e.message); setSaving(false); return; }
    setNewUrl('');
    setError('');
    const { data } = await supabase.from('installed_addons').select('*').eq('profile_id', activeProfile.id).order('sort_order');
    setAddons(data ?? []);
    setSaving(false);
  }

  async function handleToggle(addon: InstalledAddon) {
    await supabase.from('installed_addons').update({ enabled: !addon.enabled }).eq('id', addon.id);
    setAddons(prev => prev.map(a => a.id === addon.id ? { ...a, enabled: !a.enabled } : a));
  }

  // Marks one of the admin's own addons as a stream source, which excludes it
  // from provisioning for users whose invite code didn't include streams.
  // Takes effect on the next sync pass (or immediately for new signups).
  async function handleToggleStreamSource(addon: InstalledAddon) {
    const next = !addon.provides_stream;
    const { error: e } = await supabase
      .from('installed_addons').update({ provides_stream: next }).eq('id', addon.id);
    if (e) { setError(e.message); return; }
    setAddons(prev => prev.map(a => a.id === addon.id ? { ...a, provides_stream: next } : a));
  }

  async function handleRemove(id: string) {
    await supabase.from('installed_addons').delete().eq('id', id);
    setAddons(prev => prev.filter(a => a.id !== id));
  }

  function handleDragStart(i: number) { dragIndex.current = i; }
  async function handleDrop(i: number) {
    if (dragIndex.current === null || dragIndex.current === i) return;
    const reordered = [...addons];
    const [moved] = reordered.splice(dragIndex.current, 1);
    reordered.splice(i, 0, moved);
    setAddons(reordered);
    dragIndex.current = null;
    await Promise.all(reordered.map((a, idx) => supabase.from('installed_addons').update({ sort_order: idx }).eq('id', a.id)));
  }

  // Manual re-sync. Profiles are provisioned automatically now — a trigger calls
  // install_curated_setup() on profile insert and the every-2-days cron pass
  // re-mirrors everyone — so this button is "apply the admin's current list right
  // now", not the one-time opt-in it used to be.
  //
  // The RPC does the whole job server-side: adds missing curated addons, removes
  // curated ones the admin dropped, leaves the user's own additions alone, and
  // tags its rows source = 'curated' so mirroring keeps working. Inserting from
  // here instead would write source = 'user' rows that can never be un-provisioned.
  async function handleInstallCuratedSetup() {
    if (!activeProfile) return;
    setInstalling(true);
    setError('');

    const { data: changed, error: rpcErr } = await supabase.rpc('install_curated_setup', {
      p_profile_id: activeProfile.id,
    });
    if (rpcErr) { setError(rpcErr.message); setInstalling(false); return; }

    await refreshProfiles?.();

    const { data } = await supabase
      .from('installed_addons').select('*').eq('profile_id', activeProfile.id).order('sort_order');
    setAddons(data ?? []);
    setLastInstallCount(typeof changed === 'number' ? changed : 0);
    setCuratedSyncedAt(new Date().toISOString());
    setInstalling(false);
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-text">Add-ons</h1>
          {isManaged && <Badge variant="purple">Managed by Moonlit</Badge>}
          {role === 'friends_family' && <Badge>Inherited from admin</Badge>}
        </div>

        {(role === 'premium' || role === 'friends_family') && (
          <Card className="p-4 mb-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">One-tap setup</p>
                <p className="text-xs text-muted">Add Moonlit's recommended add-ons to your account in one tap. They'll sync to your apps.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={curatedSetupInstalled ? 'success' : 'default'}>
                  {installing ? 'Setting up…' : curatedSetupInstalled ? 'Installed' : 'Not set up'}
                </Badge>
                <Button
                  variant={curatedSetupInstalled ? 'ghost' : 'primary'}
                  onClick={handleInstallCuratedSetup}
                  loading={installing}
                  size="md"
                >
                  {installing ? 'Installing…' : curatedSetupInstalled ? 'Install again' : 'Install'}
                </Button>
              </div>
            </div>
            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
            {lastInstallCount !== null && (
              <p className="text-xs text-muted mt-3">
                {lastInstallCount > 0 ? `Added ${lastInstallCount} new add-on${lastInstallCount === 1 ? '' : 's'}.` : 'Already up to date.'}
              </p>
            )}
            {curatedSyncedAt && (
              <p className="text-xs text-muted mt-1">
                Last synced {new Date(curatedSyncedAt).toLocaleDateString()} · re-syncs automatically every 2 days
              </p>
            )}
          </Card>
        )}

        {canEdit && (
          <Card className="p-4 mb-6 flex gap-3">
            <Input id="addon-url" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://addon-url/manifest.json" error={error} className="flex-1" />
            <Button onClick={handleAdd} loading={saving} size="md">Add</Button>
          </Card>
        )}

        {/* Bundled defaults are always active but never stored in `installed_addons`
            (see BUILTIN_ADDON_NAMES above) — shown read-only so they aren't mistaken
            for "no add-ons installed". */}
        <div className="mb-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">Built-in</p>
        </div>
        <div className="flex flex-col gap-2 mb-6">
          {Object.values(BUILTIN_ADDON_NAMES).map(name => (
            <Card key={name} className="flex items-center gap-3 px-4 py-3 opacity-70">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text truncate">{name}</p>
              </div>
              <Badge variant="purple">Always on</Badge>
            </Card>
          ))}
        </div>

        {addons.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-medium text-muted uppercase tracking-wide">Your add-ons</p>
          </div>
        )}

        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : addons.length === 0 ? (
          <p className="text-muted text-sm">No add-ons of your own added yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {addons.map((addon, i) => (
              <Card
                key={addon.id}
                className="flex items-center gap-3 px-4 py-3"
                draggable={canEdit}
                onDragStart={() => handleDragStart(i)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => handleDrop(i)}
              >
                {canEdit && <DragHandle />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">{addon.addon_name ?? addon.addon_url}</p>
                  {addon.addon_name && <p className="text-xs text-muted truncate">{addon.addon_url}</p>}
                </div>
                {/* Admin only: classifying an addon as a stream source is what
                    lets invite codes withhold it. An unmarked stream addon goes
                    out to EVERY user regardless of their code. */}
                {role === 'admin' && (
                  <label
                    className="flex items-center gap-1.5 text-xs cursor-pointer select-none shrink-0"
                    title="This addon provides streams — only users whose invite code included stream addons will receive it"
                  >
                    <input
                      type="checkbox"
                      checked={addon.provides_stream}
                      onChange={() => handleToggleStreamSource(addon)}
                      className="accent-accent"
                    />
                    <span className={addon.provides_stream ? 'text-accent' : 'text-muted'}>Stream source</span>
                  </label>
                )}
                {canEdit && (
                  <>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={addon.enabled} onChange={() => handleToggle(addon)} />
                      <div className="w-9 h-5 bg-border rounded-full peer peer-checked:bg-accent transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                    <button onClick={() => handleRemove(addon.id)} className="text-muted hover:text-red-500 transition-colors text-lg leading-none">&times;</button>
                  </>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
