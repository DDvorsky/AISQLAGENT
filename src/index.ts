import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config.js';
import { WebSocketService } from './services/websocket.service.js';
import { SqlService } from './services/sql.service.js';
import { FileService } from './services/file.service.js';
import { logger } from './utils/logger.js';
import { apiRouter } from './api/routes.js';

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
app.use(express.static(path.join(__dirname, '../ui/dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../ui/dist/index.html'));
});

// Initialize services
const sqlService = new SqlService();
const fileService = new FileService(config.projectPath);
const wsService = new WebSocketService(config, sqlService, fileService);

// Start server
app.listen(config.port, () => {
  logger.info(`AISQLAGENT running on port ${config.port}`);
  logger.info(`UI available at http://localhost:${config.port}`);

  // Connect to AISQLWatch server if configured
  if (config.isConfigured) {
    wsService.connect();
  } else {
    logger.info('Waiting for initial configuration...');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  wsService.disconnect();
  await sqlService.disconnect();
  process.exit(0);
});
