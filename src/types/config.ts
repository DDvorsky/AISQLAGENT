export interface InitConfig {
  serverId: string;
  clientId: string;
  clientSecret: string;
  serverUrl: string;
  keycloakUrl: string;
  apiUrl: string;
}

export interface AppConfig extends InitConfig {
  port: number;
  projectPath: string;
  configPath: string;
  isConfigured: boolean;
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
