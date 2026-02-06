import pg from 'pg';
import { SqlConfig } from '../../types/index.js';
import { IDbDriver, DbQueryResult } from './db-driver.interface.js';
import { logger } from '../../utils/logger.js';

export class PostgresDriver implements IDbDriver {
  private pool: pg.Pool | null = null;

  async connect(config: SqlConfig): Promise<void> {
    const ssl = this.buildSslConfig(config.options?.sslMode);

    this.pool = new pg.Pool({
      host: config.server,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database || 'postgres',
      ssl,
      connectionTimeoutMillis: 15000,
      query_timeout: 30000,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    // Verify connection works
    const client = await this.pool.connect();
    client.release();
    logger.info('Connected to PostgreSQL');
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('Disconnected from PostgreSQL');
    }
  }

  async execute(query: string, timeout?: number): Promise<DbQueryResult> {
    if (!this.pool) {
      throw new Error('PostgreSQL not connected');
    }

    const startTime = Date.now();

    let text = query;
    if (timeout) {
      text = `SET LOCAL statement_timeout = ${timeout}; ${query}`;
    }

    const result = await this.pool.query(text);
    const duration = Date.now() - startTime;

    const columns = result.fields
      ? result.fields.map(f => f.name)
      : [];

    const rows = (result.rows || []).map((row: Record<string, unknown>) =>
      columns.map(col => row[col])
    );

    logger.debug(`Query executed in ${duration}ms, returned ${result.rowCount ?? 0} rows`);

    return {
      columns,
      rows,
      rowCount: result.rowCount ?? 0,
      duration,
    };
  }

  isConnected(): boolean {
    return this.pool !== null && (this.pool as unknown as { ending?: boolean }).ending !== true;
  }

  private buildSslConfig(sslMode?: string): boolean | object {
    switch (sslMode) {
      case 'require':
        return { rejectUnauthorized: false };
      case 'verify-ca':
      case 'verify-full':
        return { rejectUnauthorized: true };
      case 'disable':
      default:
        return false;
    }
  }
}
