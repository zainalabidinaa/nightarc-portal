import type { Profile } from '../../types';

const AVATAR_COLORS = ['#6d28d9', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

interface ProfileCardProps {
  profile: Profile;
  onSelect: () => void;
  onEdit: () => void;
  editMode: boolean;
}

export function ProfileCard({ profile, onSelect, onEdit, editMode }: ProfileCardProps) {
  const bg = profile.avatar_color ?? AVATAR_COLORS[profile.profile_index % AVATAR_COLORS.length];
  const initials = profile.name.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-2 group cursor-pointer" onClick={editMode ? onEdit : onSelect}>
      <div
        className="w-24 h-24 rounded-2xl flex items-center justify-center text-2xl font-bold text-white transition-all group-hover:ring-4 group-hover:ring-accent/40 relative"
        style={{ backgroundColor: bg }}
      >
        {initials}
        {editMode && (
          <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center">
            <span className="text-white text-lg">&#9998;</span>
          </div>
        )}
      </div>
      <p className="text-sm font-medium text-text">{profile.name}</p>
    </div>
  );
}
