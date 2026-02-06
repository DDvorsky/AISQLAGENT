import WebSocket from 'ws';
import https from 'https';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AppConfig, Message, SqlExecutePayload, FileReadPayload, FileListPayload, FileSearchPayload, CatalogSyncPayload } from '../types/index.js';
import { SqlService } from './sql.service.js';
import { FileService } from './file.service.js';
import { AllowlistService, AllowlistValidationError } from './allowlist.service.js';
import { logger } from '../utils/logger.js';

// Path for persisting auth config received from server
const AUTH_CONFIG_PATH = path.join(process.cwd(), 'config', 'auth-config.json');

const RECONNECT_INITIAL_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

// Pending auth verification requests
interface PendingRequest {
  resolve: (value: { success: boolean; error?: string }) => void;
  reject: (error: Error) => void;
}

// Catalog refresh interval (50 minutes - before 60-min expiration)
const CATALOG_REFRESH_INTERVAL = 50 * 60 * 1000;

export class WebSocketService {
  private socket: WebSocket | null = null;
  private config: AppConfig;
  private sqlService: SqlService;
  private fileService: FileService;
  private allowlistService: AllowlistService;
  private reconnectAttempts = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private catalogRefreshInterval: NodeJS.Timeout | null = null;
  private _isConnected = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private _authRequired = false;

  // Callback for connection status changes
  public onConnectionChange: ((connected: boolean) => void) | null = null;
  // Callback for auth status changes
  public onAuthStatusChange: ((authRequired: boolean) => void) | null = null;

  constructor(config: AppConfig, sqlService: SqlService, fileService: FileService) {
    this.config = config;
    this.sqlService = sqlService;
    this.fileService = fileService;
    // Initialize allowlist service with CA certificate (for signature verification)
    this.allowlistService = new AllowlistService(config.caCertificate || '');
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

    // Handle responses to our requests (like auth.verify, allowlist.refresh)
    if (message.type === 'response' && message.id) {
      // Handle allowlist refresh response
      if (message.action === 'allowlist.refresh.response') {
        const payload = message.payload as CatalogSyncPayload | undefined;
        if (payload?.catalog) {
          this.handleAllowlistSync(payload);
        }
        return;
      }

      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        // Auth responses have success/error at root level, not in payload
        const responseMsg = message as unknown as { success?: boolean; error?: string };
        pending.resolve({
          success: responseMsg.success ?? false,
          error: responseMsg.error,
        });
      }
      return;
    }

    // Handle events from server (no response needed)
    if (message.type === 'event') {
      switch (message.action) {
        case 'config.sync':
          // Server sends authRequired flag on connection
          this.handleConfigSync(message.payload as { authRequired?: boolean });
          break;
        case 'allowlist.sync':
          // Server sends signed query catalog for validation
          this.handleAllowlistSync(message.payload as CatalogSyncPayload);
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
          if (!this.config.projectPath) {
            response = { error: 'Project path not configured on agent' };
          } else {
            response = await this.fileService.scanProjectStructure();
          }
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
   * Server tells us if auth is required (password is set on server).
   * Persists to file so auth is required on restart.
   */
  private async handleConfigSync(payload: { authRequired?: boolean }): Promise<void> {
    this._authRequired = payload.authRequired ?? false;

    if (this._authRequired) {
      logger.info('Server requires authentication for agent UI');
    } else {
      logger.info('Server has no password set - agent UI open access');
    }

    // Notify listeners about auth status
    this.onAuthStatusChange?.(this._authRequired);

    // Persist to file for next startup
    try {
      await fs.mkdir(path.dirname(AUTH_CONFIG_PATH), { recursive: true });
      await fs.writeFile(AUTH_CONFIG_PATH, JSON.stringify({ authRequired: this._authRequired }, null, 2));
      logger.debug('Auth config persisted to file');
    } catch (error) {
      logger.warn('Failed to persist auth config:', error);
    }
  }

  /**
   * Handle allowlist sync event from server.
   * Server sends signed query catalog for validation.
   */
  private handleAllowlistSync(payload: CatalogSyncPayload): void {
    try {
      this.allowlistService.updateCatalog(payload.catalog);

      // Start catalog refresh timer (to get new catalog before expiration)
      this.startCatalogRefresh();

      logger.info(`Query catalog synced: ${Object.keys(payload.catalog.queries).length} queries approved`);
    } catch (error) {
      if (error instanceof AllowlistValidationError) {
        logger.error(`Catalog validation failed: ${error.message} (${error.code})`);
      } else {
        logger.error('Failed to process catalog sync:', error);
      }
    }
  }

  /**
   * Verify password with the server.
   * Returns success/failure and error message if failed.
   */
  async verifyAuth(password: string): Promise<{ success: boolean; error?: string }> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'Not connected to server' };
    }

    const requestId = uuidv4();

    return new Promise((resolve, reject) => {
      // Set timeout for request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({ success: false, error: 'Authentication request timed out' });
      }, 10000);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      // Send auth verify request
      const message: Message = {
        id: requestId,
        type: 'request',
        action: 'auth.verify',
        payload: { password },
        timestamp: Date.now(),
      };
      this.sendMessage(message);
    });
  }

  /**
   * Check if authentication is required (password set on server)
   */
  isAuthRequired(): boolean {
    return this._authRequired;
  }

  private async handleSqlExecute(payload: SqlExecutePayload) {
    const startTime = Date.now();

    try {
      let queryToExecute: string;

      // NEW: Template-based execution with catalog validation
      if (payload.template) {
        // 1. Check catalog availability
        if (!this.allowlistService.hasCatalog()) {
          return {
            columns: [],
            rows: [],
            rowCount: 0,
            duration: Date.now() - startTime,
            error: 'Security: Query catalog not yet received from server',
          };
        }

        if (this.allowlistService.isCatalogExpired()) {
          return {
            columns: [],
            rows: [],
            rowCount: 0,
            duration: Date.now() - startTime,
            error: 'Security: Query catalog has expired - waiting for refresh',
          };
        }

        // 2. Validate template against catalog (throws if invalid)
        try {
          this.allowlistService.validateTemplate(payload.template);
        } catch (error) {
          if (error instanceof AllowlistValidationError) {
            logger.warn(`Template rejected: ${error.code}`);
            return {
              columns: [],
              rows: [],
              rowCount: 0,
              duration: Date.now() - startTime,
              error: `Security: ${error.message}`,
            };
          }
          throw error;
        }

        // 3. Substitute params into validated template
        queryToExecute = this.allowlistService.substituteParams(
          payload.template,
          payload.params || {}
        );

        logger.debug(`Executing validated query for tool: ${payload.toolId}`);
      } else if (payload.query) {
        // LEGACY: Direct query - only allow if catalog not loaded (backward compat)
        if (this.allowlistService.hasCatalog()) {
          return {
            columns: [],
            rows: [],
            rowCount: 0,
            duration: Date.now() - startTime,
            error: 'Security: Direct queries not allowed - template required',
          };
        }
        queryToExecute = payload.query;
        logger.warn('Executing direct query (no catalog validation)');
      } else {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          duration: Date.now() - startTime,
          error: 'No query or template provided',
        };
      }

      // 4. Execute the query
      const result = await this.sqlService.execute(queryToExecute, payload.timeout);
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
    // Check if project path is configured
    if (!this.config.projectPath) {
      return {
        path: payload.path,
        content: '',
        size: 0,
        error: 'Project path not configured on agent',
      };
    }

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
    // Check if project path is configured
    if (!this.config.projectPath) {
      return {
        path: payload.path,
        files: [],
        error: 'Project path not configured on agent',
      };
    }

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
    // Check if project path is configured
    if (!this.config.projectPath) {
      return {
        results: [],
        error: 'Project path not configured on agent',
      };
    }

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
          dbType: this.sqlService.getDbType(),
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

  /**
   * Start periodic catalog refresh.
   * Requests fresh catalog from server before expiration.
   */
  private startCatalogRefresh(): void {
    this.stopCatalogRefresh();

    this.catalogRefreshInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        logger.info('Requesting catalog refresh...');
        this.sendMessage({
          id: uuidv4(),
          type: 'request',
          action: 'allowlist.refresh',
          payload: {},
          timestamp: Date.now(),
        });
      }
    }, CATALOG_REFRESH_INTERVAL);

    logger.debug(`Catalog refresh scheduled every ${CATALOG_REFRESH_INTERVAL / 60000} minutes`);
  }

  private stopCatalogRefresh(): void {
    if (this.catalogRefreshInterval) {
      clearInterval(this.catalogRefreshInterval);
      this.catalogRefreshInterval = null;
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
    this.stopCatalogRefresh();
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
