import { useState } from 'react';
import type { FormEvent } from 'react';
import { LogIn } from 'lucide-react';
import { login } from '../api';

interface LoginPageProps {
  onSuccess: () => void;
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f1115',
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="glass-panel"
        style={{ width: 320, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', marginBottom: 6 }}>
          <LogIn size={18} color="#3b82f6" />
          <span style={{ fontSize: 16, fontWeight: 600 }}>Maestri Windows</span>
        </div>

        <input
          type="text"
          placeholder="Usuário"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoFocus
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            padding: '8px 10px',
            color: '#e2e8f0',
            fontFamily: 'Inter, sans-serif',
            fontSize: 14,
          }}
        />

        <input
          type="password"
          placeholder="Senha"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            padding: '8px 10px',
            color: '#e2e8f0',
            fontFamily: 'Inter, sans-serif',
            fontSize: 14,
          }}
        />

        {error && (
          <span style={{ color: '#ef4444', fontSize: 13 }}>{error}</span>
        )}

        <button
          type="submit"
          className="ui-btn"
          disabled={loading || !username || !password}
          style={{ justifyContent: 'center', marginTop: 4 }}
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
