import { useState, useEffect } from 'react';
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

  // Check if init.json is loaded
  if (!serverConfig?.serverUrl) {
    return (
      <div className="container">
        <div className="header">
          <h1>AISQLAGENT</h1>
          <p>Remote Probe for AISQLWatch</p>
        </div>
        <div className="card">
          <div className="alert alert-error">
            <strong>Configuration Missing</strong>
            <p style={{ marginTop: '0.5rem' }}>
              No init.json found. Please download the configuration file from AISQLWatch
              and mount it to <code>/app/config/init.json</code>
            </p>
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
