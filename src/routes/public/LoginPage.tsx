import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) { setError(authError.message); return; }
    navigate('/profiles');
  }

  async function handleMagicLink() {
    if (!email) { setError('Enter your email first'); return; }
    setLoading(true);
    await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    setMagicSent(true);
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold text-text mb-1">Welcome back</h1>
        <p className="text-sm text-muted mb-6">Sign in to your Luna account</p>

        {magicSent ? (
          <p className="text-sm text-green-600 bg-green-50 rounded-lg p-3">
            Check your email — we sent a magic link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input id="email" label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            <Input id="password" label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <Button type="submit" loading={loading} className="w-full mt-1">Sign in</Button>
            <button type="button" onClick={handleMagicLink} className="text-xs text-muted hover:text-accent transition-colors text-center">
              Sign in with magic link
            </button>
          </form>
        )}

        <p className="text-xs text-muted text-center mt-6">
          Don&apos;t have an account? <Link to="/signup" className="text-accent hover:underline">Sign up</Link>
        </p>
      </Card>
    </div>
  );
}
