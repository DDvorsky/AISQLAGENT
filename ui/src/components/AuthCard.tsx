import { useState } from 'react';

interface AuthCardProps {
  isAuthenticated: boolean;
  onAuthChange: () => void;
}

export function AuthCard({ isAuthenticated, onAuthChange }: AuthCardProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const result = await res.json();

      if (result.success) {
        setSuccess(mode === 'login' ? 'Login successful!' : 'Registration successful! You are now logged in.');
        setUsername('');
        setPassword('');
        setConfirmPassword('');
        onAuthChange();
      } else {
        setError(result.error || 'Operation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      onAuthChange();
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated) {
    return (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Authentication</h2>
          <span className="status-badge status-connected">Authenticated</span>
        </div>

        <div className="alert alert-success">
          You are currently logged in to this agent.
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Your credentials are validated against the AISQLWatch server. This ensures
          only authorized users can configure and use this agent.
        </p>

        <button
          className="btn btn-secondary"
          onClick={handleLogout}
          disabled={loading}
        >
          {loading ? 'Logging out...' : 'Logout'}
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Authentication</h2>
        <span className="status-badge status-disconnected">Not authenticated</span>
      </div>

      <div className="tabs" style={{ marginBottom: '1rem', borderBottom: 'none', paddingBottom: 0 }}>
        <button
          className={`tab ${mode === 'login' ? 'active' : ''}`}
          onClick={() => { setMode('login'); setError(null); setSuccess(null); }}
        >
          Login
        </button>
        <button
          className={`tab ${mode === 'register' ? 'active' : ''}`}
          onClick={() => { setMode('register'); setError(null); setSuccess(null); }}
        >
          Register
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Username</label>
          <input
            type="text"
            className="form-input"
            placeholder="Enter username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Password</label>
          <input
            type="password"
            className="form-input"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>

        {mode === 'register' && (
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '1rem' }}>
          {mode === 'login'
            ? 'Enter your credentials to access this agent. Credentials are validated against the AISQLWatch server.'
            : 'Create a new account for this agent. Your credentials will be securely stored on the AISQLWatch server.'}
        </p>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !username || !password}
          style={{ width: '100%' }}
        >
          {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Register'}
        </button>
      </form>
    </div>
  );
}
