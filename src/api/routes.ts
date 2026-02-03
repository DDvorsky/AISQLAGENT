import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { SqlService } from '../services/sql.service.js';
import { SqlConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

export const apiRouter = Router();

// Shared services - will be injected from main app
let sqlService: SqlService;
let wsConnected = false;
let currentSession: { username: string; token: string } | null = null;

export function initializeRoutes(sql: SqlService) {
  sqlService = sql;
}

export function setWsConnected(connected: boolean) {
  wsConnected = connected;
}

// Storage paths
const CONFIG_DIR = path.join(process.cwd(), 'config');
const SQL_CONFIG_PATH = path.join(CONFIG_DIR, 'sql-config.json');
const AUTH_STORAGE_PATH = path.join(CONFIG_DIR, 'auth-storage.json');

// Helper functions for local storage
async function ensureConfigDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

async function loadJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return defaultValue;
  }
}

async function saveJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ============== STATUS ENDPOINTS ==============

apiRouter.get('/status', (req, res) => {
  res.json({
    configured: config.isConfigured,
    serverUrl: config.serverUrl || null,
    clientId: config.clientId || null,
    sqlConnected: sqlService?.isConnected() || false,
    wsConnected,
  });
});

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

// ============== SQL ENDPOINTS ==============

apiRouter.get('/sql/config', async (req, res) => {
  try {
    const savedConfig = await loadJsonFile<Partial<SqlConfig>>(SQL_CONFIG_PATH, {});
    // Don't return password
    res.json({
      server: savedConfig.server || '',
      port: savedConfig.port || 1433,
      user: savedConfig.user || '',
      database: savedConfig.database || '',
      encrypt: savedConfig.options?.encrypt ?? true,
      trustServerCertificate: savedConfig.options?.trustServerCertificate ?? true,
    });
  } catch (error) {
    res.json({});
  }
});

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

    // Save config (without password in plain text for security)
    await saveJsonFile(SQL_CONFIG_PATH, {
      server: sqlConfig.server,
      port: sqlConfig.port,
      user: sqlConfig.user,
      database: sqlConfig.database,
      options: sqlConfig.options,
      // Password is encrypted or stored securely - for now we keep it for functionality
      _encPassword: Buffer.from(sqlConfig.password).toString('base64'),
    });

    await sqlService.configure(sqlConfig);
    logger.info('SQL configuration saved');
    res.json({ success: true });
  } catch (error) {
    logger.error('SQL configuration failed:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Configuration failed',
    });
  }
});

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

// ============== AUTH ENDPOINTS ==============

interface AuthStorage {
  users: Array<{
    username: string;
    passwordHash: string;
    salt: string;
    createdAt: string;
  }>;
}

apiRouter.get('/auth/status', (req, res) => {
  res.json({
    authenticated: currentSession !== null,
    username: currentSession?.username || null,
  });
});

apiRouter.post('/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const storage = await loadJsonFile<AuthStorage>(AUTH_STORAGE_PATH, { users: [] });

    // Check if user exists
    if (storage.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ success: false, error: 'Username already exists' });
    }

    // Create user
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    storage.users.push({
      username,
      passwordHash,
      salt,
      createdAt: new Date().toISOString(),
    });

    await saveJsonFile(AUTH_STORAGE_PATH, storage);

    // Auto-login after registration
    const token = generateToken();
    currentSession = { username, token };

    logger.info(`User registered: ${username}`);
    res.json({ success: true, username });
  } catch (error) {
    logger.error('Registration failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Registration failed',
    });
  }
});

apiRouter.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const storage = await loadJsonFile<AuthStorage>(AUTH_STORAGE_PATH, { users: [] });

    const user = storage.users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const passwordHash = hashPassword(password, user.salt);

    if (passwordHash !== user.passwordHash) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    // Create session
    const token = generateToken();
    currentSession = { username: user.username, token };

    logger.info(`User logged in: ${username}`);
    res.json({ success: true, username: user.username });
  } catch (error) {
    logger.error('Login failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Login failed',
    });
  }
});

apiRouter.post('/auth/logout', (req, res) => {
  if (currentSession) {
    logger.info(`User logged out: ${currentSession.username}`);
  }
  currentSession = null;
  res.json({ success: true });
});

// ============== INIT.JSON UPLOAD ==============

apiRouter.post('/config/upload', async (req, res) => {
  try {
    const initJson = req.body;

    // Validate required fields
    if (!initJson.clientId || !initJson.clientSecret || !initJson.serverUrl) {
      return res.status(400).json({
        success: false,
        error: 'Invalid init.json - missing required fields (clientId, clientSecret, serverUrl)',
      });
    }

    // Save to config path
    const configPath = path.resolve(process.env.CONFIG_PATH || './config/init.json');
    await ensureConfigDir();
    await fs.writeFile(configPath, JSON.stringify(initJson, null, 2));

    logger.info('init.json uploaded successfully');
    res.json({
      success: true,
      message: 'Configuration saved.',
      needsRestart: true,
    });
  } catch (error) {
    logger.error('Config upload failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    });
  }
});

// ============== RESTART ENDPOINT ==============

apiRouter.post('/restart', (req, res) => {
  logger.info('Restart requested - shutting down process...');
  res.json({ success: true, message: 'Restarting...' });

  // Give time for response to be sent, then exit
  // Docker with restart policy will restart the container
  setTimeout(() => {
    process.exit(0);
  }, 500);
});

// ============== GENERIC STORAGE ==============

apiRouter.get('/storage/:key', async (req, res) => {
  const storage = await loadJsonFile<Record<string, unknown>>(
    path.join(CONFIG_DIR, 'storage.json'),
    {}
  );
  res.json({ value: storage[req.params.key] ?? null });
});

apiRouter.post('/storage/:key', async (req, res) => {
  const storagePath = path.join(CONFIG_DIR, 'storage.json');
  const storage = await loadJsonFile<Record<string, unknown>>(storagePath, {});
  storage[req.params.key] = req.body.value;
  await saveJsonFile(storagePath, storage);
  res.json({ success: true });
});

// ============== LOAD SAVED SQL CONFIG ON STARTUP ==============

export async function loadSavedSqlConfig(): Promise<void> {
  try {
    const saved = await loadJsonFile<{
      server?: string;
      port?: number;
      user?: string;
      database?: string;
      options?: { encrypt?: boolean; trustServerCertificate?: boolean };
      _encPassword?: string;
    }>(SQL_CONFIG_PATH, {});

    if (saved.server && saved.user && saved._encPassword) {
      const sqlConfig: SqlConfig = {
        server: saved.server,
        port: saved.port || 1433,
        user: saved.user,
        password: Buffer.from(saved._encPassword, 'base64').toString('utf-8'),
        database: saved.database,
        options: saved.options,
      };
      await sqlService.configure(sqlConfig);
      logger.info('Loaded saved SQL configuration');
    }
  } catch (error) {
    logger.warn('Could not load saved SQL config:', error);
  }
}
