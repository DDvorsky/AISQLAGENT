import { useState, useEffect, useRef } from 'react';
import { ServerConfigCard } from './components/ServerConfigCard';
import { SqlConfigCard } from './components/SqlConfigCard';
import { StatusCard } from './components/StatusCard';
import { AuthCard } from './components/AuthCard';

interface AppStatus {
  configured: boolean;
  serverUrl: string | null;
  clientId: string | null;
  sqlConnected: boolean;
  wsConnected: boolean;
  authenticated: boolean;
}

interface ServerConfig {
  serverId: string;
  clientId: string;
  serverUrl: string;
  keycloakUrl: string;
  apiUrl: string;
  projectPath: string;
}

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'status' | 'sql' | 'auth'>('status');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadInitialData();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadInitialData = async () => {
    try {
      const [statusRes, configRes, authRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/config'),
        fetch('/api/auth/status'),
      ]);

      const statusData = await statusRes.json();
      const configData = await configRes.json();
      const authData = await authRes.json();

      setStatus(statusData);
      setServerConfig(configData);
      setIsAuthenticated(authData.authenticated);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async () => {
    try {
      const [statusRes, authRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/auth/status'),
      ]);
      const statusData = await statusRes.json();
      const authData = await authRes.json();
      setStatus(statusData);
      setIsAuthenticated(authData.authenticated);
    } catch (error) {
      console.error('Failed to refresh status:', error);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus(null);

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const response = await fetch('/api/config/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });

      const result = await response.json();

      if (result.success) {
        setUploadStatus({ success: true, message: result.message });
      } else {
        setUploadStatus({ success: false, message: result.error });
      }
    } catch (error) {
      setUploadStatus({
        success: false,
        message: error instanceof SyntaxError ? 'Invalid JSON file' : 'Upload failed',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Check if init.json is loaded
  if (!serverConfig?.serverUrl) {
    return (
      <div className="container">
        <div className="header">
          <h1>AISQLAGENT</h1>
          <p>Remote Probe for AISQLWatch</p>
        </div>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Configuration Required</h2>
          </div>

          <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
            Upload the <code>init.json</code> file downloaded from AISQLWatch to configure this agent.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            id="init-json-upload"
          />

          <label
            htmlFor="init-json-upload"
            className="btn btn-primary"
            style={{
              display: 'inline-block',
              cursor: uploading ? 'wait' : 'pointer',
              opacity: uploading ? 0.7 : 1,
            }}
          >
            {uploading ? 'Uploading...' : 'Upload init.json'}
          </label>

          {uploadStatus && (
            <div
              className={`alert ${uploadStatus.success ? 'alert-success' : 'alert-error'}`}
              style={{ marginTop: '1rem' }}
            >
              {uploadStatus.message}
              {uploadStatus.success && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                  Restart the Docker container to apply changes:
                  <br />
                  <code style={{ display: 'block', marginTop: '0.5rem' }}>
                    docker restart aisqlagent
                  </code>
                </p>
              )}
            </div>
          )}

          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
            <strong style={{ fontSize: '0.875rem' }}>Alternative: Mount via Docker</strong>
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              You can also mount the init.json file when starting the container:
            </p>
            <code style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.75rem', wordBreak: 'break-all' }}>
              docker run -v /path/to/init.json:/app/config/init.json aisqlagent
            </code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1>AISQLAGENT</h1>
        <p>Remote Probe for AISQLWatch</p>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          Status
        </button>
        <button
          className={`tab ${activeTab === 'sql' ? 'active' : ''}`}
          onClick={() => setActiveTab('sql')}
        >
          SQL Server
        </button>
        <button
          className={`tab ${activeTab === 'auth' ? 'active' : ''}`}
          onClick={() => setActiveTab('auth')}
        >
          Authentication
        </button>
      </div>

      {activeTab === 'status' && (
        <>
          <StatusCard
            status={status}
            isAuthenticated={isAuthenticated}
          />
          <ServerConfigCard config={serverConfig} />
        </>
      )}

      {activeTab === 'sql' && (
        <SqlConfigCard
          onConnectionChange={refreshStatus}
          isConnected={status?.sqlConnected || false}
        />
      )}

      {activeTab === 'auth' && (
        <AuthCard
          isAuthenticated={isAuthenticated}
          onAuthChange={() => {
            refreshStatus();
            loadInitialData();
          }}
        />
      )}
    </div>
  );
}

export default App;
