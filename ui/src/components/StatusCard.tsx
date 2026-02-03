interface StatusCardProps {
  status: {
    configured: boolean;
    serverUrl: string | null;
    clientId: string | null;
    sqlConnected: boolean;
    wsConnected: boolean;
  } | null;
  isAuthenticated: boolean;
}

export function StatusCard({ status, isAuthenticated }: StatusCardProps) {
  const getOverallStatus = () => {
    if (!status) return 'disconnected';
    if (status.wsConnected && status.sqlConnected && isAuthenticated) return 'connected';
    if (status.configured) return 'pending';
    return 'disconnected';
  };

  const overallStatus = getOverallStatus();

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Connection Status</h2>
        <span className={`status-badge status-${overallStatus}`}>
          {overallStatus === 'connected' ? 'Online' : overallStatus === 'pending' ? 'Partial' : 'Offline'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <StatusRow
          label="AISQLWatch Server"
          connected={status?.wsConnected || false}
          detail={status?.serverUrl || 'Not configured'}
        />
        <StatusRow
          label="SQL Server"
          connected={status?.sqlConnected || false}
          detail={status?.sqlConnected ? 'Connected' : 'Not connected'}
        />
        <StatusRow
          label="User Authentication"
          connected={isAuthenticated}
          detail={isAuthenticated ? 'Authenticated' : 'Not authenticated'}
        />
      </div>
    </div>
  );
}

interface StatusRowProps {
  label: string;
  connected: boolean;
  detail: string;
}

function StatusRow({ label, connected, detail }: StatusRowProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div className="connection-status">
        <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
        <span>{label}</span>
      </div>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{detail}</span>
    </div>
  );
}
