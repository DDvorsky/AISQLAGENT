import { useState } from 'react';

interface ServerConfigCardProps {
  config: {
    serverId: string;
    clientId: string;
    serverUrl: string;
    keycloakUrl: string;
    apiUrl: string;
    projectPath: string;
  } | null;
  onConfigChange?: () => void;
}

export function ServerConfigCard({ config, onConfigChange }: ServerConfigCardProps) {
  const [projectPath, setProjectPath] = useState(config?.projectPath || '');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [restarting, setRestarting] = useState(false);

  if (!config) return null;

  const hasChanges = projectPath !== (config.projectPath || '');

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);

    try {
      const res = await fetch('/api/config/project-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      const result = await res.json();

      if (result.success) {
        setSaveResult({ success: true, message: 'Project path saved. Restarting...' });
        setRestarting(true);
        try {
          await fetch('/api/restart', { method: 'POST' });
        } catch {
          // Expected - server disconnects
        }
        await waitForServer();
        window.location.reload();
      } else {
        setSaveResult({ success: false, message: result.error });
      }
    } catch (error) {
      setSaveResult({
        success: false,
        message: error instanceof Error ? error.message : 'Save failed',
      });
    } finally {
      setSaving(false);
    }
  };

  const waitForServer = async (maxAttempts = 30): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch('/api/status');
        if (res.ok) return true;
      } catch {
        // Server not ready
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
  };

  if (restarting) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
        <p>Restarting with new project path...</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Server Configuration</h2>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>from init.json</span>
      </div>

      <div className="info-grid">
        <span className="info-label">Server ID:</span>
        <span className="info-value">{config.serverId || '-'}</span>

        <span className="info-label">Client ID:</span>
        <span className="info-value">{config.clientId || '-'}</span>

        <span className="info-label">Server URL:</span>
        <span className="info-value">{config.serverUrl || '-'}</span>

        <span className="info-label">Auth URL:</span>
        <span className="info-value">{config.keycloakUrl || '-'}</span>

        <span className="info-label">API URL:</span>
        <span className="info-value">{config.apiUrl || '-'}</span>
      </div>

      <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Project Path</h3>

        <div className="form-group">
          <label className="form-label">Path to project files (UNC path for Docker)</label>
          <input
            type="text"
            className="form-input"
            placeholder="\\\\server\\share\\project or /mnt/project"
            value={projectPath}
            onChange={(e) => {
              setProjectPath(e.target.value);
              setSaveResult(null);
            }}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Leave empty to disable file synchronization. For Docker, use UNC paths or mounted volumes.
          </p>
        </div>

        {saveResult && (
          <div className={`alert ${saveResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: '1rem' }}>
            {saveResult.message}
          </div>
        )}

        {hasChanges && (
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ marginTop: '1rem' }}
          >
            {saving ? 'Saving...' : 'Save & Restart'}
          </button>
        )}
      </div>
    </div>
  );
}
