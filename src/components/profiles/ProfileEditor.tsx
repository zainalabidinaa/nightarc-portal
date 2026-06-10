import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import type { Profile } from '../../types';

const COLORS = ['#6d28d9', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4'];

interface ProfileEditorProps {
  profile: Profile | null;
  onClose: () => void;
  onSaved: () => void;
  userId: string;
  nextIndex: number;
}

export function ProfileEditor({ profile, onClose, onSaved, userId, nextIndex }: ProfileEditorProps) {
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.avatar_color ?? COLORS[0]);
  const [pinEnabled, setPinEnabled] = useState(profile?.pin_enabled ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return; }
    setLoading(true);
    if (profile) {
      await supabase.from('profiles').update({ name: name.trim(), avatar_color: color, pin_enabled: pinEnabled }).eq('id', profile.id);
    } else {
      await supabase.from('profiles').insert({ user_id: userId, name: name.trim(), avatar_color: color, pin_enabled: pinEnabled, profile_index: nextIndex, uses_primary_addons: false, role: 'user' });
    }
    setLoading(false);
    onSaved();
  }

  async function handleDelete() {
    if (!profile) return;
    if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) return;
    await supabase.from('profiles').delete().eq('id', profile.id);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={profile ? 'Edit Profile' : 'New Profile'}>
      <div className="p-6 flex flex-col gap-5">
        <Input id="pname" label="Name" value={name} onChange={e => setName(e.target.value)} error={error} />
        <div>
          <p className="text-sm font-medium text-text mb-2">Color</p>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-accent' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={pinEnabled} onChange={e => setPinEnabled(e.target.checked)} className="w-4 h-4 accent-accent" />
          <span className="text-sm text-text">Require PIN to access</span>
        </label>
        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} loading={loading} className="flex-1">Save</Button>
          {profile && <Button variant="danger" onClick={handleDelete}>Delete</Button>}
        </div>
      </div>
    </Modal>
  );
}
