import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AppShell } from '../../components/layout/AppShell';
import { ProfileCard } from '../../components/profiles/ProfileCard';
import { ProfileEditor } from '../../components/profiles/ProfileEditor';

export default function ProfilesPage() {
  const { profiles, setActiveProfile, user } = useAuth();
  const navigate = useNavigate();
  const [editMode, setEditMode] = useState(false);
  const [editingProfile, setEditingProfile] = useState<typeof profiles[0] | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  function handleSelectProfile(p: typeof profiles[0]) {
    setActiveProfile(p);
    navigate('/addons');
  }

  function handleSaved() {
    setEditingProfile(null);
    setCreatingNew(false);
    window.location.reload();
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-text">Who&apos;s watching?</h1>
          <button onClick={() => setEditMode(e => !e)} className="text-sm text-muted hover:text-text transition-colors">
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>

        <div className="flex flex-wrap gap-6">
          {profiles.map(p => (
            <ProfileCard
              key={p.id}
              profile={p}
              editMode={editMode}
              onSelect={() => handleSelectProfile(p)}
              onEdit={() => setEditingProfile(p)}
            />
          ))}
          {profiles.length < 5 && !editMode && (
            <div
              onClick={() => setCreatingNew(true)}
              className="flex flex-col items-center gap-2 cursor-pointer group"
            >
              <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-border flex items-center justify-center text-3xl text-muted group-hover:border-accent group-hover:text-accent transition-all">
                +
              </div>
              <p className="text-sm text-muted">Add Profile</p>
            </div>
          )}
        </div>
      </div>

      {(editingProfile || creatingNew) && user && (
        <ProfileEditor
          profile={editingProfile}
          onClose={() => { setEditingProfile(null); setCreatingNew(false); }}
          onSaved={handleSaved}
          userId={user.id}
          nextIndex={profiles.length}
        />
      )}
    </AppShell>
  );
}
