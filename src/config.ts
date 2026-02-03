import fs from 'fs';
import path from 'path';
import { InitConfig, AppConfig } from './types/config.js';

const CONFIG_PATH = process.env.CONFIG_PATH || './config/init.json';

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

const initConfig = loadInitConfig();

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  projectPath: process.env.PROJECT_PATH || '/project',
  configPath: CONFIG_PATH,

  // From init.json (server-generated)
  serverId: initConfig?.serverId || '',
  clientId: initConfig?.clientId || '',
  clientSecret: initConfig?.clientSecret || '',
  serverUrl: initConfig?.serverUrl || '',
  keycloakUrl: initConfig?.keycloakUrl || '',
  apiUrl: initConfig?.apiUrl || '',

  // Runtime state
  isConfigured: !!initConfig?.serverUrl,
};
