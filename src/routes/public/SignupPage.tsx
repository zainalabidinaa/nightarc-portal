import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import type { Plan } from '../../types';

type Tab = 'invite' | 'subscribe';

const PLAN_LABELS: Record<Plan, string> = {
  premium: 'Premium — $9.99/mo',
  premium_plus: 'Premium+ — $14.99/mo',
};

export default function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialTab: Tab = params.get('tab') === 'invite' ? 'invite' : params.get('plan') ? 'subscribe' : 'invite';
  const initialPlan = (params.get('plan') as Plan | null) ?? 'premium';

  const [tab, setTab] = useState<Tab>(initialTab);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<Plan>(initialPlan);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleInviteSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validate invite code
    const { data: valid } = await supabase.rpc('validate_invite_code', { p_code: code.trim().toUpperCase() });
    if (!valid) { setError('Invalid or already used invite code.'); setLoading(false); return; }

    // Create account
    const { data: authData, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError || !authData.user) { setError(signUpError?.message ?? 'Signup failed'); setLoading(false); return; }

    // Insert profile
    await supabase.from('profiles').insert({
      user_id: authData.user.id,
      name: email.split('@')[0],
      role: 'friends_family',
      uses_primary_addons: true,
      profile_index: 0,
    });

    // Mark invite code used
    await supabase.from('invite_codes').update({ used_by: authData.user.id, used_at: new Date().toISOString() }).eq('code', code.trim().toUpperCase());

    setLoading(false);
    navigate('/profiles');
  }

  async function handleStripeSignup() {
    setError('');
    setLoading(true);
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: selectedPlan }),
    });
    const { url, error: fnError } = await res.json();
    if (fnError || !url) { setError('Could not start checkout. Try again.'); setLoading(false); return; }
    window.location.href = url;
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold text-text mb-1">Create your account</h1>
        <p className="text-sm text-muted mb-6">Join Nightarc today</p>

        {/* Tabs */}
        <div className="flex gap-1 bg-border rounded-lg p-1 mb-6">
          {(['invite', 'subscribe'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === t ? 'bg-surface text-text shadow-sm' : 'text-muted'}`}
            >
              {t === 'invite' ? 'Invite Code' : 'Subscribe'}
            </button>
          ))}
        </div>

        {tab === 'invite' ? (
          <form onSubmit={handleInviteSignup} className="flex flex-col gap-4">
            <Input id="code" label="Invite Code" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX" required />
            <Input id="email" label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            <Input id="password" label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <Button type="submit" loading={loading} className="w-full mt-1">Create Account</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {(['premium', 'premium_plus'] as Plan[]).map(p => (
                <button
                  key={p}
                  onClick={() => setSelectedPlan(p)}
                  className={`px-4 py-3 rounded-lg border text-sm text-left transition-colors ${selectedPlan === p ? 'border-accent bg-accent-light text-accent' : 'border-border text-text hover:border-accent/40'}`}
                >
                  {PLAN_LABELS[p]}
                </button>
              ))}
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <Button loading={loading} className="w-full" onClick={handleStripeSignup}>
              Continue to Payment
            </Button>
          </div>
        )}

        <p className="text-xs text-muted text-center mt-6">
          Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}
