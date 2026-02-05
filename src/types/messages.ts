export type MessageType = 'request' | 'response' | 'event';

export interface Message {
  id: string;
  type: MessageType;
  action: string;
  payload: unknown;
  timestamp: number;
}

// Server -> Client actions
export interface SqlExecutePayload {
  // NEW: Template-based execution (for catalog validation)
  template?: string;              // SQL with {{placeholders}}
  params?: Record<string, string>; // Parameter values for substitution
  toolId?: string;                // Tool ID for logging

  // LEGACY: Direct query (only when catalog disabled)
  query?: string;

  timeout?: number;
}

// Query catalog (sent from server via WebSocket)
export interface QueryCatalog {
  version: number;
  generated_at: string;
  expires_at: string;
  queries: Record<string, string>;  // toolId → hash
  signature: string;
}

// Catalog sync event payload
export interface CatalogSyncPayload {
  catalog: QueryCatalog;
}

export interface FileReadPayload {
  path: string;
}

export interface FileListPayload {
  path: string;
  recursive?: boolean;
}

export interface FileSearchPayload {
  pattern: string;
  glob?: string;
}

// Client -> Server responses
export interface SqlResultPayload {
  rows: unknown[];
  rowCount: number;
  duration: number;
  error?: string;
}

export interface FileContentPayload {
  path: string;
  content: string;
  size: number;
  error?: string;
}

export interface FileListResultPayload {
  path: string;
  files: FileInfo[];
  error?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export interface FolderTree {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FolderTree[];
  size?: number;
  modified?: string;
}

export interface MdFile {
  path: string;
  content: string;
  hash: string;
}
