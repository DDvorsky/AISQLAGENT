import WebSocket from 'ws';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { AppConfig, Message, SqlExecutePayload, FileReadPayload, FileListPayload, FileSearchPayload } from '../types/index.js';
import { SqlService } from './sql.service.js';
import { FileService } from './file.service.js';
import { logger } from '../utils/logger.js';

const RECONNECT_INITIAL_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

export class WebSocketService {
  private socket: WebSocket | null = null;
  private config: AppConfig;
  private sqlService: SqlService;
  private fileService: FileService;
  private reconnectAttempts = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private _isConnected = false;

  // Callback for connection status changes
  public onConnectionChange: ((connected: boolean) => void) | null = null;

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

    if (this.config.authMode === 'none') {
      logger.error('No authentication configured. Please download init.json from the server.');
      return;
    }

    try {
      // Build WebSocket URL and options based on auth mode
      const { wsUrl, wsOptions } = this.buildWebSocketConnection();

      if (this.config.authMode === 'certificate') {
        logger.info(`Connecting to ${wsUrl} (mTLS authentication)`);
      } else {
        logger.info(`Connecting to ${wsUrl.replace(/client_secret=[^&]+/, 'client_secret=***')} (legacy authentication)`);
      }

      this.socket = new WebSocket(wsUrl, wsOptions);

      this.socket.on('open', () => {
        logger.info(`Connected to AISQLWatch server via ${this.config.authMode} auth`);
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.onConnectionChange?.(true);
        this.registerProbe();
        this.startHeartbeat();
        this.syncProjectData();
      });

      this.socket.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as Message;
          this.handleMessage(message);
        } catch (error) {
          logger.error('Failed to parse message:', error);
        }
      });

      this.socket.on('close', (code: number, reason: Buffer) => {
        logger.warn(`Disconnected: code=${code}, reason=${reason.toString()}`);
        this._isConnected = false;
        this.onConnectionChange?.(false);
        this.stopHeartbeat();

        // Reconnect unless it was an auth failure
        if (code !== 4001) {
          this.scheduleReconnect();
        } else {
          if (this.config.authMode === 'certificate') {
            logger.error('Authentication failed - certificate may be invalid, expired, or revoked');
          } else {
            logger.error('Authentication failed - check client_id and client_secret');
          }
        }
      });

      this.socket.on('error', (error: Error) => {
        logger.error('WebSocket error:', error);
      });

    } catch (error) {
      logger.error('Connection failed:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Build WebSocket connection URL and options based on authentication mode
   */
  private buildWebSocketConnection(): { wsUrl: string; wsOptions: WebSocket.ClientOptions } {
    // Convert HTTP URL to WebSocket URL
    let baseUrl = this.config.serverUrl;

    // Handle protocol conversion
    // When using certificate auth, always use secure WebSocket (wss://)
    const forceSecure = this.config.authMode === 'certificate';

    if (baseUrl.startsWith('https://')) {
      baseUrl = baseUrl.replace('https://', 'wss://');
    } else if (baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', forceSecure ? 'wss://' : 'ws://');
    }

    // Remove trailing slash
    baseUrl = baseUrl.replace(/\/$/, '');

    // Add /ws/probe path if not present
    if (!baseUrl.includes('/ws/probe')) {
      baseUrl = `${baseUrl}/ws/probe`;
    }

    const url = new URL(baseUrl);
    const wsOptions: WebSocket.ClientOptions = {};

    if (this.config.authMode === 'certificate') {
      // Certificate authentication - send certificate in header
      // Since nginx terminates TLS, we can't do true mTLS
      // Instead, we send the certificate in a header for the server to verify
      url.searchParams.set('client_id', this.config.clientId);

      // Send certificate in header (URL-encoded PEM format)
      // The server will verify this certificate against its CA
      wsOptions.headers = {
        'x-client-cert': encodeURIComponent(this.config.certificate || ''),
      };

      // Use system CA store for server verification (Let's Encrypt)
      wsOptions.agent = new https.Agent({
        rejectUnauthorized: true,
      });

      logger.debug('Using certificate authentication via header');
    } else {
      // Legacy authentication - use client_secret in query params
      url.searchParams.set('client_id', this.config.clientId);
      url.searchParams.set('client_secret', this.config.clientSecret || '');

      // If CA certificate is provided, use it to verify server
      if (this.config.caCertificate) {
        wsOptions.agent = new https.Agent({
          ca: this.config.caCertificate,
          rejectUnauthorized: true,
        });
      }

      logger.debug('Using legacy secret authentication');
    }

    return { wsUrl: url.toString(), wsOptions };
  }

  private async handleMessage(message: Message): Promise<void> {
    logger.debug(`Received: ${message.type}/${message.action}`);

    // Handle events from server (no response needed)
    if (message.type === 'event') {
      switch (message.action) {
        case 'config.sync':
          // Server sends config like passwordHash on connection
          this.handleConfigSync(message.payload as { passwordHash?: string });
          break;
        default:
          logger.debug(`Unknown event: ${message.action}`);
      }
      return;
    }

    // Handle requests from server (need response)
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

  /**
   * Handle config sync event from server.
   * Updates local config with server-provided values like passwordHash.
   */
  private handleConfigSync(payload: { passwordHash?: string }): void {
    if (payload.passwordHash) {
      this.config.passwordHash = payload.passwordHash;
      logger.info('Received passwordHash from server - auth enabled for local UI');
    } else {
      // Server has no password set - clear local auth requirement
      this.config.passwordHash = undefined;
      logger.info('No passwordHash from server - local UI auth disabled');
    }
  }

  private async handleSqlExecute(payload: SqlExecutePayload) {
    const startTime = Date.now();
    try {
      const result = await this.sqlService.execute(payload.query, payload.timeout);
      return {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        duration: result.duration,
      };
    } catch (error) {
      return {
        columns: [],
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
    this.sendMessage(response);
  }

  private sendMessage(message: Message): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private registerProbe(): void {
    const message: Message = {
      id: uuidv4(),
      type: 'request',
      action: 'probe.register',
      payload: { serverId: this.config.serverId },
      timestamp: Date.now(),
    };
    this.sendMessage(message);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Send initial heartbeat immediately to sync status
    this.sendHeartbeat();
    // Then schedule periodic heartbeats
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);
  }

  private sendHeartbeat(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      const message: Message = {
        id: uuidv4(),
        type: 'event',
        action: 'probe.heartbeat',
        payload: {
          status: 'ok',
          sqlConnected: this.sqlService.isConnected(),
          sqlHost: this.sqlService.getSqlHost(),
          projectPath: this.config.projectPath || null,
        },
        timestamp: Date.now(),
      };
      this.sendMessage(message);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async syncProjectData(): Promise<void> {
    // Skip sync if no project path configured
    if (!this.config.projectPath) {
      logger.info('No project path configured - skipping file sync');
      return;
    }

    try {
      // Sync folder structure
      const structure = await this.fileService.scanProjectStructure();
      this.sendMessage({
        id: uuidv4(),
        type: 'request',
        action: 'sync.structure',
        payload: { structure },
        timestamp: Date.now(),
      });

      // Sync markdown files
      const mdFiles = await this.fileService.scanMarkdownFiles();
      this.sendMessage({
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
    this.stopHeartbeat();
    this._isConnected = false;
    this.onConnectionChange?.(false);
    this.socket?.close();
    this.socket = null;
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Force sending a heartbeat to sync status with server.
   * Call this after SQL config changes or other status updates.
   */
  notifyStatusChange(): void {
    this.sendHeartbeat();
  }
}
