import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { WebSocketService } from './services/websocket.service.js';
import { SqlService } from './services/sql.service.js';
import { FileService } from './services/file.service.js';
import { logger } from './utils/logger.js';
import { apiRouter, initializeRoutes, setWsConnected, loadSavedSqlConfig } from './api/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes for local UI
app.use('/api', apiRouter);

// Serve static UI files
const uiPath = path.join(__dirname, '../ui/dist');
app.use(express.static(uiPath));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(uiPath, 'index.html'));
});

// Initialize services
const sqlService = new SqlService();
const fileService = new FileService(config.projectPath);

// Initialize routes with services
initializeRoutes(sqlService);

// WebSocket service with connection status callback
const wsService = new WebSocketService(config, sqlService, fileService);
wsService.onConnectionChange = setWsConnected;

// Start server
async function start() {
  // Load saved SQL configuration
  await loadSavedSqlConfig();

  app.listen(config.port, () => {
    logger.info(`AISQLAGENT running on port ${config.port}`);
    logger.info(`UI available at http://localhost:${config.port}`);
    logger.info(`Project path: ${config.projectPath}`);

    // Connect to AISQLWatch server if configured
    if (config.isConfigured) {
      logger.info('Connecting to AISQLWatch server...');
      wsService.connect();
    } else {
      logger.warn('Server not configured - waiting for init.json');
    }
  });
}

start().catch((error) => {
  logger.error('Failed to start:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  wsService.disconnect();
  await sqlService.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  wsService.disconnect();
  await sqlService.disconnect();
  process.exit(0);
});
