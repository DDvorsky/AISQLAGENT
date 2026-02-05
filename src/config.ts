import fs from 'fs';
import path from 'path';
import { InitConfig, AppConfig } from './types/config.js';

const CONFIG_PATH = process.env.CONFIG_PATH || './config/init.json';
const AUTH_CONFIG_PATH = path.join(process.cwd(), 'config', 'auth-config.json');

function loadInitConfig(): InitConfig | null {
  try {
    const configPath = path.resolve(CONFIG_PATH);
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as InitConfig;
    }
  } catch (error) {
    console.error('Failed to load init.json:', error);
  }
  return null;
}

/**
 * Load persisted auth config (authRequired flag) from file.
 * This is received from the server via WebSocket and saved locally.
 */
function loadAuthConfig(): { authRequired?: boolean } {
  try {
    if (fs.existsSync(AUTH_CONFIG_PATH)) {
      const content = fs.readFileSync(AUTH_CONFIG_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Failed to load auth config:', error);
  }
  return {};
}

/**
 * Determine authentication mode based on available credentials
 */
function determineAuthMode(initConfig: InitConfig | null): 'certificate' | 'secret' | 'none' {
  if (initConfig?.certificate && initConfig?.privateKey) {
    return 'certificate';
  }
  if (initConfig?.clientSecret) {
    return 'secret';
  }
  return 'none';
}

/**
 * Check certificate expiration
 */
function checkCertificateExpiration(certExpiresAt: string | undefined): void {
  if (!certExpiresAt) return;

  const expiresAt = new Date(certExpiresAt);
  const now = new Date();
  const daysUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    console.error(`WARNING: Certificate has EXPIRED on ${expiresAt.toISOString()}`);
    console.error('Please regenerate the certificate via the AISQLWatch web interface.');
  } else if (daysUntilExpiry < 30) {
    console.warn(`WARNING: Certificate expires in ${daysUntilExpiry} days (${expiresAt.toISOString()})`);
    console.warn('Consider regenerating the certificate soon.');
  } else if (daysUntilExpiry < 90) {
    console.info(`Certificate expires in ${daysUntilExpiry} days (${expiresAt.toISOString()})`);
  }
}

const initConfig = loadInitConfig();
const authConfig = loadAuthConfig();
const authMode = determineAuthMode(initConfig);

// Check certificate expiration on startup
if (authMode === 'certificate') {
  checkCertificateExpiration(initConfig?.certExpiresAt);
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  projectPath: process.env.PROJECT_PATH || initConfig?.projectPath || '',
  configPath: CONFIG_PATH,

  // From init.json (server-generated)
  serverId: initConfig?.serverId || '',
  clientId: initConfig?.clientId || '',
  serverUrl: initConfig?.serverUrl || '',
  keycloakUrl: initConfig?.keycloakUrl || '',
  apiUrl: initConfig?.apiUrl || '',

  // Legacy authentication
  clientSecret: initConfig?.clientSecret,

  // Certificate authentication (mTLS)
  certificate: initConfig?.certificate,
  privateKey: initConfig?.privateKey,
  caCertificate: initConfig?.caCertificate,
  certExpiresAt: initConfig?.certExpiresAt,

  // Auth required flag (received from server, persisted locally)
  authRequired: authConfig.authRequired ?? false,

  // Runtime state
  // Configured means we have serverUrl AND valid authentication (secret or certificate)
  isConfigured: !!initConfig?.serverUrl && authMode !== 'none',
  authMode,
};
