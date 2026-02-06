import sql from 'mssql';
import { SqlConfig } from '../../types/index.js';
import { IDbDriver, DbQueryResult } from './db-driver.interface.js';
import { logger } from '../../utils/logger.js';

export class MssqlDriver implements IDbDriver {
  private pool: sql.ConnectionPool | null = null;

  async connect(config: SqlConfig): Promise<void> {
    this.pool = await sql.connect({
      server: config.server,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      options: {
        encrypt: config.options?.encrypt ?? true,
        trustServerCertificate: config.options?.trustServerCertificate ?? true,
      },
      connectionTimeout: 15000,
      requestTimeout: 30000,
    });
    logger.info('Connected to SQL Server');
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      logger.info('Disconnected from SQL Server');
    }
  }

  async execute(query: string, timeout?: number): Promise<DbQueryResult> {
    if (!this.pool) {
      throw new Error('MSSQL not connected');
    }

    const startTime = Date.now();
    const request = this.pool.request();
    if (timeout) {
      (request as unknown as { _timeout: number })._timeout = timeout;
    }

    const result = await request.query(query);
    const duration = Date.now() - startTime;

    const columns = result.recordset && result.recordset.length > 0
      ? Object.keys(result.recordset[0])
      : [];

    const rows = (result.recordset || []).map((row: Record<string, unknown>) =>
      columns.map(col => row[col])
    );

    logger.debug(`Query executed in ${duration}ms, returned ${result.recordset?.length || 0} rows`);

    return { columns, rows, rowCount: result.recordset?.length || 0, duration };
  }

  isConnected(): boolean {
    return this.pool?.connected ?? false;
  }
}
