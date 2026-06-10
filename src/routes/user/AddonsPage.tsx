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

export default function AddonsPage() {
  const { activeProfile, role } = useAuth();
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dragIndex = useRef<number | null>(null);

  const isManaged = role === 'premium';
  const canEdit = role === 'admin' || role === 'premium_plus';

  useEffect(() => {
    if (!activeProfile) return;
    async function load() {
      setLoading(true);
      let profileId = activeProfile!.id;
      if (activeProfile!.uses_primary_addons) {
        const { data } = await supabase.from('profiles').select('id').eq('role', 'admin').limit(1).single();
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

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-text">Add-ons</h1>
          {isManaged && <Badge variant="purple">Managed by Luna</Badge>}
          {role === 'friends_family' && <Badge>Inherited from admin</Badge>}
        </div>

        {canEdit && (
          <Card className="p-4 mb-6 flex gap-3">
            <Input id="addon-url" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://addon-url/manifest.json" error={error} className="flex-1" />
            <Button onClick={handleAdd} loading={saving} size="md">Add</Button>
          </Card>
        )}

        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : addons.length === 0 ? (
          <p className="text-muted text-sm">No add-ons installed.</p>
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
