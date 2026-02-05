/**
 * SQL Query Allowlist Service
 *
 * Validates SQL queries against a signed catalog from the server.
 * Only queries whose template hashes match the catalog can be executed.
 *
 * Security flow:
 * 1. Server sends signed catalog after WebSocket connection
 * 2. Service verifies signature using CA certificate
 * 3. On sql.execute: hash template, verify against catalog
 * 4. If valid: substitute params and return final query
 * 5. If invalid: throw error, block execution
 */
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { QueryCatalog } from '../types/messages.js';

/**
 * Error thrown when catalog validation fails
 */
export class AllowlistValidationError extends Error {
  constructor(
    message: string,
    public code: 'SIGNATURE_INVALID' | 'TEMPLATE_NOT_ALLOWED' | 'CATALOG_MISSING' | 'CATALOG_EXPIRED'
  ) {
    super(message);
    this.name = 'AllowlistValidationError';
  }
}

/**
 * Service for validating SQL queries against a signed catalog.
 */
export class AllowlistService {
  private caCertificate: string;
  private catalog: QueryCatalog | null = null;
  private templateHashMap: Map<string, string> = new Map();  // hash → toolId
  private expiresAt: Date | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(caCertificate: string) {
    this.caCertificate = caCertificate;
  }

  /**
   * Update catalog from server (called on allowlist.sync event)
   * Validates signature before accepting.
   */
  updateCatalog(catalog: QueryCatalog): void {
    // 1. Verify signature using CA public key
    if (!this.verifySignature(catalog)) {
      throw new AllowlistValidationError(
        'Catalog signature verification failed - possible tampering',
        'SIGNATURE_INVALID'
      );
    }

    // 2. Store catalog and build hash lookup
    this.catalog = catalog;
    this.expiresAt = new Date(catalog.expires_at);

    // Build reverse lookup: hash → toolId
    this.templateHashMap.clear();
    for (const [toolId, hash] of Object.entries(catalog.queries)) {
      this.templateHashMap.set(hash, toolId);
    }

    logger.info(`Query catalog loaded: ${this.templateHashMap.size} queries, expires: ${catalog.expires_at}`);
  }

  /**
   * Check if a catalog has been loaded
   */
  hasCatalog(): boolean {
    return this.catalog !== null;
  }

  /**
   * Check if the current catalog has expired
   */
  isCatalogExpired(): boolean {
    if (!this.expiresAt) return true;
    return new Date() > this.expiresAt;
  }

  /**
   * Get time until catalog expiration (in seconds)
   */
  getTimeUntilExpiration(): number {
    if (!this.expiresAt) return 0;
    const remaining = this.expiresAt.getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  }

  /**
   * Validate a SQL template against the catalog.
   * Throws AllowlistValidationError if not in catalog.
   *
   * @param template - SQL template with {{placeholders}}
   */
  validateTemplate(template: string): void {
    if (!this.hasCatalog()) {
      throw new AllowlistValidationError(
        'Query catalog not yet received from server',
        'CATALOG_MISSING'
      );
    }

    if (this.isCatalogExpired()) {
      throw new AllowlistValidationError(
        'Query catalog has expired - waiting for refresh',
        'CATALOG_EXPIRED'
      );
    }

    const hash = this.hashTemplate(template);

    if (!this.templateHashMap.has(hash)) {
      logger.warn(`Template REJECTED - hash not in catalog: ${hash.substring(0, 30)}...`);
      logger.debug(`Rejected template (first 200 chars): ${template.substring(0, 200)}`);
      throw new AllowlistValidationError(
        'Template not in approved catalog - execution blocked',
        'TEMPLATE_NOT_ALLOWED'
      );
    }

    const toolId = this.templateHashMap.get(hash);
    logger.debug(`Template approved: ${toolId} (hash: ${hash.substring(0, 20)}...)`);
  }

  /**
   * Normalize SQL template for consistent hashing.
   * Must match server-side normalization exactly!
   *
   * - Removes single-line comments (-- ...)
   * - Removes multi-line comments
   * - Normalizes whitespace
   * - Preserves {{param}} placeholders
   */
  private normalizeTemplate(template: string): string {
    // Remove single-line comments
    let normalized = template.replace(/--.*?$/gm, '');
    // Remove multi-line comments
    normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
    // Normalize whitespace (multiple spaces/newlines → single space)
    normalized = normalized.split(/\s+/).join(' ').trim();
    return normalized;
  }

  /**
   * Hash a SQL template using SHA-256.
   * Returns "sha256:hexdigest" format (matching server).
   */
  private hashTemplate(template: string): string {
    const normalized = this.normalizeTemplate(template);
    const hash = crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
    return `sha256:${hash}`;
  }

  /**
   * Recursively sort object keys to match Python's json.dumps(sort_keys=True).
   * This ensures JSON serialization matches exactly between Python and JS.
   */
  private sortObjectKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObjectKeys(item));
    }
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = this.sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  /**
   * Verify catalog signature using CA certificate.
   * The signature covers: version, generated_at, expires_at, queries (sorted JSON).
   */
  private verifySignature(catalog: QueryCatalog): boolean {
    if (!this.caCertificate) {
      logger.error('CA certificate not available for signature verification');
      return false;
    }

    try {
      // Recreate content that was signed (must match server exactly!)
      // Server uses: json.dumps(document, sort_keys=True, separators=(',', ':'))
      // We must recursively sort all keys to match Python's behavior
      const documentToVerify = this.sortObjectKeys({
        expires_at: catalog.expires_at,
        generated_at: catalog.generated_at,
        queries: catalog.queries,
        version: catalog.version,
      });
      const contentToVerify = JSON.stringify(documentToVerify);

      const signature = Buffer.from(catalog.signature, 'base64');

      const verifier = crypto.createVerify('SHA256');
      verifier.update(contentToVerify);

      const isValid = verifier.verify(this.caCertificate, signature);

      if (!isValid) {
        logger.error('Catalog signature verification FAILED');
        logger.debug(`Content to verify (first 200 chars): ${contentToVerify.substring(0, 200)}`);
      } else {
        logger.debug('Catalog signature verified successfully');
      }

      return isValid;
    } catch (error) {
      logger.error('Error verifying catalog signature:', error);
      return false;
    }
  }

  /**
   * Sanitize a parameter value for SQL substitution.
   * Only allows: alphanumeric, underscore, dot, brackets.
   * Must match server-side sanitization!
   */
  sanitizeParam(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.\[\]]/g, '');
  }

  /**
   * Substitute parameters into a validated template.
   * Call validateTemplate() first!
   *
   * @param template - SQL template with {{placeholders}}
   * @param params - Parameter values to substitute
   * @returns Final SQL query ready for execution
   */
  substituteParams(template: string, params: Record<string, string>): string {
    let result = template;

    for (const [key, value] of Object.entries(params)) {
      const sanitized = this.sanitizeParam(value);
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(placeholder, sanitized);
    }

    return result;
  }

  /**
   * Get catalog status for debugging/monitoring
   */
  getStatus(): {
    hasCatalog: boolean;
    expired: boolean;
    queryCount: number;
    expiresAt: string | null;
    secondsUntilExpiration: number;
  } {
    return {
      hasCatalog: this.hasCatalog(),
      expired: this.isCatalogExpired(),
      queryCount: this.templateHashMap.size,
      expiresAt: this.expiresAt?.toISOString() ?? null,
      secondsUntilExpiration: this.getTimeUntilExpiration(),
    };
  }

  /**
   * Clear the catalog (for testing or reset)
   */
  clearCatalog(): void {
    this.catalog = null;
    this.templateHashMap.clear();
    this.expiresAt = null;
    logger.info('Query catalog cleared');
  }
}
