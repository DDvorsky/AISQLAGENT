import sql from 'mssql';
import { SqlConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class SqlService {
  private pool: sql.ConnectionPool | null = null;
  private config: SqlConfig | null = null;

  async configure(config: SqlConfig): Promise<void> {
    this.config = config;
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
      return { success: result.rows.length > 0 };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async execute(
    query: string,
    timeout?: number
  ): Promise<{ rows: unknown[]; rowCount: number; duration: number }> {
    if (!this.pool) {
      await this.connect();
    }

    const startTime = Date.now();

    try {
      const request = this.pool!.request();
      if (timeout) {
        request.timeout = timeout;
      }

      const result = await request.query(query);
      const duration = Date.now() - startTime;

      // Important: We do NOT log the query (know-how protection)
      logger.debug(`Query executed in ${duration}ms, returned ${result.recordset?.length || 0} rows`);

      return {
        rows: result.recordset || [],
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
    return this.pool?.connected ?? false;
  }
}
