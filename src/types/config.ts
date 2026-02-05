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

  // Agent UI authentication (required)
  passwordHash?: string;     // SHA256 hash for local UI authentication
}

export interface AppConfig extends InitConfig {
  port: number;
  projectPath: string;
  configPath: string;
  isConfigured: boolean;

  // Resolved auth mode
  authMode: 'certificate' | 'secret' | 'none';
}

export interface SqlConfig {
  server: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
  };
}
