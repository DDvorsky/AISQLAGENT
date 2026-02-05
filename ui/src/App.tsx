import { useState, useEffect, useRef } from 'react';
import { ServerConfigCard } from './components/ServerConfigCard';
import { SqlConfigCard } from './components/SqlConfigCard';
import { StatusCard } from './components/StatusCard';
import { LoginScreen } from './components/LoginScreen';

interface AppStatus {
  configured: boolean;
  serverUrl: string | null;
  clientId: string | null;
  sqlConnected: boolean;
  wsConnected: boolean;
}

interface ServerConfig {
  serverId: string;
  clientId: string;
  serverUrl: string;
  keycloakUrl: string;
  apiUrl: string;
  projectPath: string;
}

interface AuthStatus {
  requiresAuth: boolean;
  authenticated: boolean;
}

// Helper to make authenticated fetch requests
export const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('authToken');
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
};

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ requiresAuth: false, authenticated: false });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'status' | 'sql'>('status');
  const [uploadStatus, setUploadStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wait for server to come back online after restart
  const waitForServer = async (maxAttempts = 30): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          return true;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
  };

  // Trigger restart and wait for server to come back
  const triggerRestart = async () => {
    setRestarting(true);
    try {
      await fetch('/api/restart', { method: 'POST' });
    } catch {
      // Expected - server will disconnect
    }

    // Wait a bit for the server to go down
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Wait for server to come back
    const isBack = await waitForServer();
    if (isBack) {
      // Reload the page to show new config
      window.location.reload();
    } else {
      setRestarting(false);
      setUploadStatus({
        success: false,
        message: 'Server did not restart properly. Please restart manually: docker restart aisqlagent',
      });
    }
  };

  useEffect(() => {
    loadInitialData();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadInitialData = async () => {
    try {
      // Check auth status first (include token to verify session)
      const authRes = await fetchWithAuth('/api/auth/status');
      const authData = await authRes.json();
      setAuthStatus(authData);

      // Load public data
      const [statusRes, configRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/config'),
      ]);

      const statusData = await statusRes.json();
      const configData = await configRes.json();

      setStatus(statusData);
      setServerConfig(configData);
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
        fetchWithAuth('/api/auth/status'),
      ]);
      const statusData = await statusRes.json();
      const authData = await authRes.json();
      setStatus(statusData);
      setAuthStatus(authData);
    } catch (error) {
      console.error('Failed to refresh status:', error);
    }
  };

  const handleLogout = async () => {
    await fetchWithAuth('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('authToken');
    setAuthStatus({ requiresAuth: true, authenticated: false });
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

      const response = await fetchWithAuth('/api/config/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });

      const result = await response.json();

      if (result.success) {
        setUploading(false);
        // Automatically trigger restart
        await triggerRestart();
      } else {
        setUploadStatus({ success: false, message: result.error });
        setUploading(false);
      }
    } catch (error) {
      setUploadStatus({
        success: false,
        message: error instanceof SyntaxError ? 'Invalid JSON file' : 'Upload failed',
      });
      setUploading(false);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Show restarting screen
  if (restarting) {
    return (
      <div className="container">
        <div className="header">
          <h1>AISQLAGENT</h1>
          <p>Remote Probe for AISQLWatch</p>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spinner" style={{ margin: '0 auto 1.5rem' }}></div>
          <h2 style={{ marginBottom: '0.5rem' }}>Restarting with new configuration...</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Please wait while the agent restarts.
          </p>
        </div>
      </div>
    );
  }

  // Check if authentication is required and user is not authenticated
  if (authStatus.requiresAuth && !authStatus.authenticated) {
    return (
      <LoginScreen
        onLogin={() => {
          loadInitialData();
        }}
      />
    );
  }

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
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>AISQLAGENT</h1>
          <p>Remote Probe for AISQLWatch</p>
        </div>
        {authStatus.requiresAuth && authStatus.authenticated && (
          <button
            className="btn btn-secondary"
            onClick={handleLogout}
            style={{ marginTop: '0.5rem' }}
          >
            Logout
          </button>
        )}
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
      </div>

      {activeTab === 'status' && (
        <>
          <StatusCard
            status={status}
            isAuthenticated={authStatus.authenticated}
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
    </div>
  );
}

export default App;
