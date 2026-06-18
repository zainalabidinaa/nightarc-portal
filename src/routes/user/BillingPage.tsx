import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { AppShell } from '../../components/layout/AppShell';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import type { UserRole } from '../../types';

const PLAN_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  friends_family: 'Friends & Family',
  premium: 'Premium',
  premium_plus: 'Premium+',
  free: 'Free',
};

export default function BillingPage() {
  const { role, session, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const isBilledPlan = role === 'premium' || role === 'premium_plus';

  async function openCustomerPortal() {
    if (!session) return;
    setLoading(true);
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'portal' }),
    });
    const { url } = await res.json();
    if (url) window.location.href = url;
    setLoading(false);
  }

  async function handleRedeemInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setInviteSuccess('');
    if (!user || !inviteCode.trim()) return;

    setInviteLoading(true);
    const code = inviteCode.trim().toUpperCase();

    // Validate
    const { data: valid } = await supabase.rpc('validate_invite_code', { p_code: code });
    if (!valid) {
      setInviteError('Invalid, expired, or already used invite code.');
      setInviteLoading(false);
      return;
    }

    // Update profile role
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ role: 'friends_family' })
      .eq('user_id', user.id);

    if (profileErr) {
      setInviteError(profileErr.message);
      setInviteLoading(false);
      return;
    }

    // Mark invite code used
    const { error: codeErr } = await supabase
      .from('invite_codes')
      .update({
        used_by: user.id,
        used_email: user.email,
        used_at: new Date().toISOString(),
      })
      .eq('code', code);

    if (codeErr) {
      setInviteError(codeErr.message);
      setInviteLoading(false);
      return;
    }

    setInviteSuccess('Invite code redeemed. Reloading…');
    setInviteCode('');
    setInviteLoading(false);
    setTimeout(() => window.location.reload(), 1500);
  }

  return (
    <AppShell>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-text mb-6">Billing</h1>

        <Card className="p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text">Current Plan</p>
            <Badge variant="purple">{role ? PLAN_LABELS[role] : '—'}</Badge>
          </div>

          {role === 'friends_family' && (
            <p className="text-sm text-muted">Your access was granted by invitation. No billing required.</p>
          )}

          {role === 'admin' && (
            <p className="text-sm text-muted">You manage this Moonlit instance. No subscription required.</p>
          )}

          {role === 'free' && (
            <>
              <p className="text-sm text-muted">Your account is set to free. Access is limited.</p>
              <div className="border-t border-border pt-4">
                <p className="text-xs text-muted mb-3">Enter a new invite code to regain access.</p>
                <form onSubmit={handleRedeemInvite} className="flex flex-col gap-3">
                  <Input
                    id="invite-code"
                    label="Invite Code"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    placeholder="XXXX-XXXX"
                    error={inviteError}
                    disabled={inviteLoading}
                  />
                  {inviteSuccess && <p className="text-xs text-green-400">{inviteSuccess}</p>}
                  <Button type="submit" loading={inviteLoading} disabled={!inviteCode.trim()}>
                    Redeem Invite Code
                  </Button>
                </form>
              </div>
            </>
          )}

          {isBilledPlan && (
            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted mb-3">Manage your subscription, update payment method, or cancel through the billing portal.</p>
              <Button onClick={openCustomerPortal} loading={loading} variant="secondary">
                Manage Billing
              </Button>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
