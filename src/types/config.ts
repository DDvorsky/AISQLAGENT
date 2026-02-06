export interface InitConfig {
  serverId: string;
  clientId: string;
  serverUrl: string;
  keycloakUrl: string;
  apiUrl: string;
  projectPath?: string;

  // Legacy authentication (deprecated)
  clientSecret?: string;

  // mTLS Certificate authentication (recommended)
  certificate?: string;      // PEM-encoded client certificate
  privateKey?: string;       // PEM-encoded private key
  caCertificate?: string;    // PEM-encoded CA certificate for server verification
  certExpiresAt?: string;    // ISO format expiration date

}

export interface AppConfig extends InitConfig {
  port: number;
  projectPath: string;
  configPath: string;
  isConfigured: boolean;

  // Resolved auth mode
  authMode: 'certificate' | 'secret' | 'none';

  // Auth required flag (from server via WebSocket)
  authRequired: boolean;
}

export type DbType = 'mssql' | 'postgres';

export interface SqlConfig {
  dbType?: DbType;
  server: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  options?: {
    // MSSQL options
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    // PostgreSQL options
    sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  };
}
