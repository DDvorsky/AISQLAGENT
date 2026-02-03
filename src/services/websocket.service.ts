import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { AppConfig, Message, SqlExecutePayload, FileReadPayload, FileListPayload, FileSearchPayload } from '../types/index.js';
import { SqlService } from './sql.service.js';
import { FileService } from './file.service.js';
import { logger } from '../utils/logger.js';

const RECONNECT_INITIAL_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

export class WebSocketService {
  private socket: Socket | null = null;
  private config: AppConfig;
  private sqlService: SqlService;
  private fileService: FileService;
  private reconnectAttempts = 0;
  private jwtToken: string | null = null;

  constructor(config: AppConfig, sqlService: SqlService, fileService: FileService) {
    this.config = config;
    this.sqlService = sqlService;
    this.fileService = fileService;
  }

  async connect(): Promise<void> {
    if (!this.config.serverUrl) {
      logger.error('Server URL not configured');
      return;
    }

    try {
      // Get JWT token from Keycloak
      await this.authenticate();

      // Connect to WebSocket server
      this.socket = io(this.config.serverUrl, {
        auth: {
          token: this.jwtToken,
          clientId: this.config.clientId,
          serverId: this.config.serverId,
        },
        reconnection: true,
        reconnectionDelay: RECONNECT_INITIAL_DELAY,
        reconnectionDelayMax: RECONNECT_MAX_DELAY,
        reconnectionAttempts: Infinity,
      });

      this.setupEventHandlers();
    } catch (error) {
      logger.error('Connection failed:', error);
      this.scheduleReconnect();
    }
  }

  private async authenticate(): Promise<void> {
    const tokenUrl = `${this.config.keycloakUrl}/protocol/openid-connect/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status}`);
    }

    const data = await response.json();
    this.jwtToken = data.access_token;
    logger.info('Authenticated with Keycloak');
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      logger.info('Connected to AISQLWatch server');
      this.reconnectAttempts = 0;
      this.registerProbe();
      this.startHeartbeat();
      this.syncProjectData();
    });

    this.socket.on('disconnect', (reason) => {
      logger.warn(`Disconnected: ${reason}`);
    });

    this.socket.on('error', (error) => {
      logger.error('WebSocket error:', error);
    });

    // Handle incoming commands from server
    this.socket.on('message', (message: Message) => {
      this.handleMessage(message);
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    logger.debug(`Received: ${message.action}`);

    try {
      let response: unknown;

      switch (message.action) {
        case 'sql.execute':
          response = await this.handleSqlExecute(message.payload as SqlExecutePayload);
          break;
        case 'sql.testConnection':
          response = await this.sqlService.testConnection();
          break;
        case 'file.read':
          response = await this.handleFileRead(message.payload as FileReadPayload);
          break;
        case 'file.list':
          response = await this.handleFileList(message.payload as FileListPayload);
          break;
        case 'file.search':
          response = await this.handleFileSearch(message.payload as FileSearchPayload);
          break;
        case 'file.getStructure':
          response = await this.fileService.scanProjectStructure();
          break;
        default:
          response = { error: `Unknown action: ${message.action}` };
      }

      this.sendResponse(message.id, message.action, response);
    } catch (error) {
      this.sendResponse(message.id, message.action, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleSqlExecute(payload: SqlExecutePayload) {
    const startTime = Date.now();
    try {
      const result = await this.sqlService.execute(payload.query, payload.timeout);
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        duration: result.duration,
      };
    } catch (error) {
      return {
        rows: [],
        rowCount: 0,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'SQL execution failed',
      };
    }
  }

  private async handleFileRead(payload: FileReadPayload) {
    try {
      const result = await this.fileService.readFile(payload.path);
      return {
        path: payload.path,
        content: result.content,
        size: result.size,
      };
    } catch (error) {
      return {
        path: payload.path,
        content: '',
        size: 0,
        error: error instanceof Error ? error.message : 'File read failed',
      };
    }
  }

  private async handleFileList(payload: FileListPayload) {
    try {
      const files = await this.fileService.listFiles(payload.path, payload.recursive);
      return { path: payload.path, files };
    } catch (error) {
      return {
        path: payload.path,
        files: [],
        error: error instanceof Error ? error.message : 'File list failed',
      };
    }
  }

  private async handleFileSearch(payload: FileSearchPayload) {
    try {
      const results = await this.fileService.searchInFiles(payload.pattern, payload.glob);
      return { results };
    } catch (error) {
      return {
        results: [],
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  }

  private sendResponse(requestId: string, action: string, payload: unknown): void {
    const response: Message = {
      id: requestId,
      type: 'response',
      action: `${action}.response`,
      payload,
      timestamp: Date.now(),
    };
    this.socket?.emit('message', response);
  }

  private registerProbe(): void {
    const message: Message = {
      id: uuidv4(),
      type: 'request',
      action: 'probe.register',
      payload: { serverId: this.config.serverId },
      timestamp: Date.now(),
    };
    this.socket?.emit('message', message);
  }

  private startHeartbeat(): void {
    setInterval(() => {
      if (this.socket?.connected) {
        const message: Message = {
          id: uuidv4(),
          type: 'event',
          action: 'probe.heartbeat',
          payload: { status: 'ok' },
          timestamp: Date.now(),
        };
        this.socket.emit('message', message);
      }
    }, 30000);
  }

  private async syncProjectData(): Promise<void> {
    try {
      // Sync folder structure
      const structure = await this.fileService.scanProjectStructure();
      this.socket?.emit('message', {
        id: uuidv4(),
        type: 'request',
        action: 'sync.structure',
        payload: { structure },
        timestamp: Date.now(),
      });

      // Sync markdown files
      const mdFiles = await this.fileService.scanMarkdownFiles();
      this.socket?.emit('message', {
        id: uuidv4(),
        type: 'request',
        action: 'sync.mdFiles',
        payload: { files: mdFiles },
        timestamp: Date.now(),
      });

      logger.info(`Synced project: ${mdFiles.length} MD files`);
    } catch (error) {
      logger.error('Project sync failed:', error);
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      RECONNECT_INITIAL_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );
    this.reconnectAttempts++;
    logger.info(`Reconnecting in ${delay}ms...`);
    setTimeout(() => this.connect(), delay);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
