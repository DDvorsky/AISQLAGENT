import { SqlConfig } from '../../types/index.js';

export interface DbQueryResult {
  columns: string[];
  rows: unknown[];
  rowCount: number;
  duration: number;
}

export interface IDbDriver {
  connect(config: SqlConfig): Promise<void>;
  disconnect(): Promise<void>;
  execute(query: string, timeout?: number): Promise<DbQueryResult>;
  isConnected(): boolean;
}
