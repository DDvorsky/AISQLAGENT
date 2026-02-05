import { useState, useEffect } from 'react';
import { fetchWithAuth } from '../App';

interface SqlConfigCardProps {
  onConnectionChange: () => void;
  isConnected: boolean;
}

interface SqlConfig {
  server: string;
  port: string;
  user: string;
  password: string;
  database: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export function SqlConfigCard({ onConnectionChange, isConnected }: SqlConfigCardProps) {
  const [config, setConfig] = useState<SqlConfig>({
    server: '',
    port: '1433',
    user: '',
    password: '',
    database: '',
    encrypt: true,
    trustServerCertificate: true,
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saveResult, setSaveResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    loadSavedConfig();
  }, []);

  const loadSavedConfig = async () => {
    try {
      const res = await fetchWithAuth('/api/sql/config');
      if (res.ok) {
        const data = await res.json();
        if (data.server) {
          setConfig({
            server: data.server || '',
            port: data.port?.toString() || '1433',
            user: data.user || '',
            password: '', // Don't load password for security
            database: data.database || '',
            encrypt: data.encrypt ?? true,
            trustServerCertificate: data.trustServerCertificate ?? true,
          });
        }
      }
    } catch (error) {
      console.error('Failed to load SQL config:', error);
    }
  };

  const handleChange = (field: keyof SqlConfig, value: string | boolean) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
    setSaveResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      // First save the config
      await fetchWithAuth('/api/sql/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      // Then test
      const res = await fetchWithAuth('/api/sql/test', { method: 'POST' });
      const result = await res.json();
      setTestResult(result);
      onConnectionChange();
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);

    try {
      const res = await fetchWithAuth('/api/sql/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const result = await res.json();

      if (result.success) {
        setSaveResult({ success: true });
        onConnectionChange();
      } else {
        setSaveResult({ success: false, error: result.error });
      }
    } catch (error) {
      setSaveResult({
        success: false,
        error: error instanceof Error ? error.message : 'Save failed',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">SQL Server Configuration</h2>
        <span className={`status-badge status-${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {testResult && (
        <div className={`alert ${testResult.success ? 'alert-success' : 'alert-error'}`}>
          {testResult.success ? 'Connection successful!' : `Connection failed: ${testResult.error}`}
        </div>
      )}

      {saveResult && (
        <div className={`alert ${saveResult.success ? 'alert-success' : 'alert-error'}`}>
          {saveResult.success ? 'Configuration saved!' : `Save failed: ${saveResult.error}`}
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Server Host</label>
          <input
            type="text"
            className="form-input"
            placeholder="localhost or host.docker.internal"
            value={config.server}
            onChange={(e) => handleChange('server', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Port</label>
          <input
            type="text"
            className="form-input"
            placeholder="1433"
            value={config.port}
            onChange={(e) => handleChange('port', e.target.value)}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Username</label>
          <input
            type="text"
            className="form-input"
            placeholder="sa"
            value={config.user}
            onChange={(e) => handleChange('user', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Password</label>
          <input
            type="password"
            className="form-input"
            placeholder="••••••••"
            value={config.password}
            onChange={(e) => handleChange('password', e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Database (optional)</label>
        <input
          type="text"
          className="form-input"
          placeholder="master"
          value={config.database}
          onChange={(e) => handleChange('database', e.target.value)}
        />
      </div>

      <div className="form-row" style={{ marginTop: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.encrypt}
            onChange={(e) => handleChange('encrypt', e.target.checked)}
          />
          <span style={{ fontSize: '0.875rem' }}>Encrypt connection</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.trustServerCertificate}
            onChange={(e) => handleChange('trustServerCertificate', e.target.checked)}
          />
          <span style={{ fontSize: '0.875rem' }}>Trust server certificate</span>
        </label>
      </div>

      <div className="btn-group">
        <button
          className="btn btn-secondary"
          onClick={handleTest}
          disabled={testing || !config.server || !config.user}
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !config.server || !config.user}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}
