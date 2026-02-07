import { SqlConfig, DbType } from '../types/index.js';
import { IDbDriver, DbQueryResult } from './drivers/db-driver.interface.js';
import { MssqlDriver } from './drivers/mssql.driver.js';
import { PostgresDriver } from './drivers/postgres.driver.js';
import { logger } from '../utils/logger.js';

export class SqlService {
  private driver: IDbDriver | null = null;
  private config: SqlConfig | null = null;
  private _lastTestSuccess = false;

  async configure(config: SqlConfig): Promise<void> {
    if (!config.dbType) {
      config.dbType = 'mssql';
    }

    // Skip disconnect if connection params haven't changed and driver is alive
    const connectionChanged = !this.config
      || this.config.dbType !== config.dbType
      || this.config.server !== config.server
      || this.config.port !== config.port
      || this.config.user !== config.user
      || this.config.password !== config.password
      || this.config.database !== config.database;

    this.config = config;

    if (!connectionChanged && this.driver) {
      return;
    }

    this._lastTestSuccess = false;
    await this.disconnect();
    this.driver = this.createDriver(config.dbType);
  }

  private createDriver(dbType: DbType): IDbDriver {
    switch (dbType) {
      case 'mssql':
        return new MssqlDriver();
      case 'postgres':
        return new PostgresDriver();
      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }
  }

  async connect(): Promise<boolean> {
    if (!this.config) {
      throw new Error('SQL not configured');
    }
    if (!this.driver) {
      this.driver = this.createDriver(this.config.dbType || 'mssql');
    }

    try {
      await this.driver.connect(this.config);
      return true;
    } catch (error) {
      logger.error('SQL connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.disconnect();
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
  ): Promise<DbQueryResult> {
    if (!this.driver || !this.driver.isConnected()) {
      await this.connect();
    }

    const startTime = Date.now();
    try {
      return await this.driver!.execute(query, timeout);
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Query failed after ${duration}ms:`, error);
      throw error;
    }
  }

  isConnected(): boolean {
    return (this.driver?.isConnected() ?? false) || this._lastTestSuccess;
  }

  getSqlHost(): string | null {
    return this.config?.server ?? null;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  getDbType(): DbType | null {
    return this.config?.dbType ?? null;
  }
}
