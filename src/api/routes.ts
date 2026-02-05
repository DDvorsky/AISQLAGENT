import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { SqlService } from '../services/sql.service.js';
import { WebSocketService } from '../services/websocket.service.js';
import { SqlConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

export const apiRouter = Router();

// Shared services - will be injected from main app
let sqlService: SqlService;
let wsService: WebSocketService | null = null;
let wsConnected = false;
let currentSession: { username: string; token: string } | null = null;

export function initializeRoutes(sql: SqlService, ws?: WebSocketService) {
  sqlService = sql;
  wsService = ws || null;
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

// ============== SQL ENDPOINTS (Protected) ==============

apiRouter.get('/sql/config', authMiddleware, async (req, res) => {
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

apiRouter.post('/sql/configure', authMiddleware, async (req, res) => {
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

apiRouter.post('/sql/test', authMiddleware, async (req, res) => {
  try {
    const result = await sqlService.testConnection();
    // Notify server about SQL status change
    if (result.success && wsService) {
      wsService.notifyStatusChange();
    }
    res.json(result);
  } catch (error) {
    res.json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
    });
  }
});

// ============== AUTH ENDPOINTS ==============

// Session tokens storage (in-memory)
const sessions = new Map<string, { createdAt: number }>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function validateSession(token: string | undefined): boolean {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  // Check if session is expired
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function getTokenFromRequest(req: { headers: { authorization?: string } }): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return undefined;
}

// Auth status - tells UI if auth is required and if user is authenticated
apiRouter.get('/auth/status', (req, res) => {
  const token = getTokenFromRequest(req);
  const isAuthenticated = validateSession(token);
  const requiresAuth = !!config.passwordHash;

  res.json({
    requiresAuth,
    authenticated: isAuthenticated,
  });
});

// Login - verify password against hash from init.json
apiRouter.post('/auth/login', (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, error: 'Password required' });
    }

    // Check if auth is configured
    if (!config.passwordHash) {
      return res.status(400).json({ success: false, error: 'Authentication not configured' });
    }

    // Hash the input password with SHA256 (same as server)
    const inputHash = crypto.createHash('sha256').update(password).digest('hex');

    if (inputHash !== config.passwordHash) {
      logger.warn('Login attempt with invalid password');
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }

    // Create session token
    const token = generateToken();
    sessions.set(token, { createdAt: Date.now() });

    logger.info('User logged in successfully');
    res.json({ success: true, token });
  } catch (error) {
    logger.error('Login failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Login failed',
    });
  }
});

// Logout - invalidate session token
apiRouter.post('/auth/logout', (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) {
    sessions.delete(token);
    logger.info('User logged out');
  }
  res.json({ success: true });
});

// Auth middleware for protecting routes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authMiddleware = (req: any, res: any, next: () => void) => {
  // Skip auth if no password is configured (agent is open)
  if (!config.passwordHash) {
    return next();
  }

  const token = getTokenFromRequest(req);
  if (!validateSession(token)) {
    return res.status(401).json({ error: 'Unauthorized - please login' });
  }

  next();
};

// ============== INIT.JSON UPLOAD (Protected) ==============

apiRouter.post('/config/upload', authMiddleware, async (req, res) => {
  try {
    const initJson = req.body;

    // Validate required fields
    // Must have clientId and serverUrl
    if (!initJson.clientId || !initJson.serverUrl) {
      return res.status(400).json({
        success: false,
        error: 'Invalid init.json - missing required fields (clientId, serverUrl)',
      });
    }

    // Must have either clientSecret (legacy) OR certificate+privateKey (mTLS)
    const hasSecretAuth = !!initJson.clientSecret;
    const hasCertAuth = !!initJson.certificate && !!initJson.privateKey;

    if (!hasSecretAuth && !hasCertAuth) {
      return res.status(400).json({
        success: false,
        error: 'Invalid init.json - missing authentication (requires either clientSecret or certificate+privateKey)',
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

// ============== PROJECT PATH UPDATE ==============

apiRouter.post('/config/project-path', authMiddleware, async (req, res) => {
  try {
    const { projectPath } = req.body;

    // Load existing init.json
    const configPath = path.resolve(process.env.CONFIG_PATH || './config/init.json');
    let initJson: Record<string, unknown> = {};

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      initJson = JSON.parse(content);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'init.json not found - please upload configuration first',
      });
    }

    // Update project path
    initJson.projectPath = projectPath || '';

    // Save updated config
    await fs.writeFile(configPath, JSON.stringify(initJson, null, 2));

    logger.info(`Project path updated to: ${projectPath || '(empty)'}`);
    res.json({
      success: true,
      message: 'Project path saved.',
      needsRestart: true,
    });
  } catch (error) {
    logger.error('Project path update failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Update failed',
    });
  }
});

// ============== RESTART ENDPOINT ==============

apiRouter.post('/restart', authMiddleware, (req, res) => {
  logger.info('Restart requested - shutting down process...');
  res.json({ success: true, message: 'Restarting...' });

  // Give time for response to be sent, then exit
  // Docker with restart policy will restart the container
  setTimeout(() => {
    process.exit(0);
  }, 500);
});

// ============== GENERIC STORAGE (Protected) ==============

apiRouter.get('/storage/:key', authMiddleware, async (req, res) => {
  const storage = await loadJsonFile<Record<string, unknown>>(
    path.join(CONFIG_DIR, 'storage.json'),
    {}
  );
  res.json({ value: storage[req.params.key] ?? null });
});

apiRouter.post('/storage/:key', authMiddleware, async (req, res) => {
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

      // Test connection to validate config and set connected state
      const testResult = await sqlService.testConnection();
      if (testResult.success) {
        logger.info('SQL connection test successful');
        // Notify server about SQL status (if ws is connected)
        if (wsService) {
          wsService.notifyStatusChange();
        }
      } else {
        logger.warn('SQL connection test failed:', testResult.error);
      }
    }
  } catch (error) {
    logger.warn('Could not load saved SQL config:', error);
  }
}
