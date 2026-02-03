import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { SqlService } from '../services/sql.service.js';
import { SqlConfig } from '../types/index.js';

export const apiRouter = Router();

const sqlService = new SqlService();

// Get current status
apiRouter.get('/status', (req, res) => {
  res.json({
    configured: config.isConfigured,
    serverUrl: config.serverUrl || null,
    clientId: config.clientId || null,
    sqlConnected: sqlService.isConnected(),
  });
});

// Get init config (readonly display)
apiRouter.get('/config', (req, res) => {
  res.json({
    serverId: config.serverId,
    clientId: config.clientId,
    serverUrl: config.serverUrl,
    keycloakUrl: config.keycloakUrl,
    apiUrl: config.apiUrl,
    projectPath: config.projectPath,
  });
});

// Configure SQL connection
apiRouter.post('/sql/configure', async (req, res) => {
  try {
    const sqlConfig: SqlConfig = {
      server: req.body.server,
      port: parseInt(req.body.port, 10) || 1433,
      user: req.body.user,
      password: req.body.password,
      database: req.body.database,
      options: {
        encrypt: req.body.encrypt ?? true,
        trustServerCertificate: req.body.trustServerCertificate ?? true,
      },
    };

    await sqlService.configure(sqlConfig);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Configuration failed',
    });
  }
});

// Test SQL connection
apiRouter.post('/sql/test', async (req, res) => {
  try {
    const result = await sqlService.testConnection();
    res.json(result);
  } catch (error) {
    res.json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
    });
  }
});

// Simple storage API (persisted to server via WebSocket)
// For now, store locally in a temp file - will be replaced with server storage
const LOCAL_STORAGE_PATH = path.join(process.cwd(), 'config', 'local-storage.json');

async function getLocalStorage(): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(LOCAL_STORAGE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function setLocalStorage(data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_STORAGE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_STORAGE_PATH, JSON.stringify(data, null, 2));
}

apiRouter.get('/storage/:key', async (req, res) => {
  const storage = await getLocalStorage();
  res.json({ value: storage[req.params.key] ?? null });
});

apiRouter.post('/storage/:key', async (req, res) => {
  const storage = await getLocalStorage();
  storage[req.params.key] = req.body.value;
  await setLocalStorage(storage);
  res.json({ success: true });
});
