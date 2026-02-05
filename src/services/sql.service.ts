import sql from 'mssql';
import { SqlConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class SqlService {
  private pool: sql.ConnectionPool | null = null;
  private config: SqlConfig | null = null;
  private _lastTestSuccess = false;  // Track if last connection test was successful

  async configure(config: SqlConfig): Promise<void> {
    this.config = config;
    this._lastTestSuccess = false;  // Reset on reconfigure
    await this.disconnect();
  }

  async connect(): Promise<boolean> {
    if (!this.config) {
      throw new Error('SQL not configured');
    }

    try {
      this.pool = await sql.connect({
        server: this.config.server,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        options: {
          encrypt: this.config.options?.encrypt ?? true,
          trustServerCertificate: this.config.options?.trustServerCertificate ?? true,
        },
        connectionTimeout: 15000,
        requestTimeout: 30000,
      });
      logger.info('Connected to SQL Server');
      return true;
    } catch (error) {
      logger.error('SQL connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      logger.info('Disconnected from SQL Server');
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connect();
      const result = await this.execute('SELECT 1 AS test');
      const success = result.rows.length > 0;
      this._lastTestSuccess = success;
      return { success };
    } catch (error) {
      this._lastTestSuccess = false;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async execute(
    query: string,
    timeout?: number
  ): Promise<{ rows: unknown[]; rowCount: number; duration: number; columns: string[] }> {
    if (!this.pool) {
      await this.connect();
    }

    const startTime = Date.now();

    try {
      const request = this.pool!.request();
      // Set query timeout via the request's internal timeout property
      if (timeout) {
        (request as unknown as { _timeout: number })._timeout = timeout;
      }

      const result = await request.query(query);
      const duration = Date.now() - startTime;

      // Extract column names from first row or empty array
      const columns = result.recordset && result.recordset.length > 0
        ? Object.keys(result.recordset[0])
        : [];

      // Convert rows from objects to arrays (matching column order)
      const rows = (result.recordset || []).map((row: Record<string, unknown>) =>
        columns.map(col => row[col])
      );

      // Important: We do NOT log the query (know-how protection)
      logger.debug(`Query executed in ${duration}ms, returned ${result.recordset?.length || 0} rows`);

      return {
        columns,
        rows,
        rowCount: result.recordset?.length || 0,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Query failed after ${duration}ms:`, error);
      throw error;
    }
  }

  isConnected(): boolean {
    // Return true if pool is connected OR if last test was successful
    // (pool might disconnect due to idle timeout, but config is still valid)
    return (this.pool?.connected ?? false) || this._lastTestSuccess;
  }

  getSqlHost(): string | null {
    return this.config?.server ?? null;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }
}
