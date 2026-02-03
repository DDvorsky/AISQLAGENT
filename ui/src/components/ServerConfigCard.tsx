interface ServerConfigCardProps {
  config: {
    serverId: string;
    clientId: string;
    serverUrl: string;
    keycloakUrl: string;
    apiUrl: string;
    projectPath: string;
  } | null;
}

export function ServerConfigCard({ config }: ServerConfigCardProps) {
  if (!config) return null;

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

        <span className="info-label">Project Path:</span>
        <span className="info-value">{config.projectPath || '-'}</span>
      </div>
    </div>
  );
}
