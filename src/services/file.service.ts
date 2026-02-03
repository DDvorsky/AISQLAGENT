import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { watch } from 'chokidar';
import { FolderTree, MdFile, FileInfo } from '../types/index.js';
import { logger } from '../utils/logger.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export class FileService {
  private basePath: string;
  private watcher: ReturnType<typeof watch> | null = null;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  /**
   * Validates path to prevent directory traversal attacks
   */
  private validatePath(relativePath: string): string {
    const fullPath = path.resolve(this.basePath, relativePath);

    if (!fullPath.startsWith(this.basePath)) {
      throw new Error('Access denied: path outside project directory');
    }

    return fullPath;
  }

  /**
   * Read file content safely
   */
  async readFile(relativePath: string): Promise<{ content: string; size: number }> {
    const fullPath = this.validatePath(relativePath);

    const stats = await fs.stat(fullPath);
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`);
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    return { content, size: stats.size };
  }

  /**
   * List files in directory
   */
  async listFiles(relativePath: string, recursive = false): Promise<FileInfo[]> {
    const fullPath = this.validatePath(relativePath);
    const files: FileInfo[] = [];

    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(relativePath, entry.name);
      const fullEntryPath = path.join(fullPath, entry.name);

      const info: FileInfo = {
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? 'directory' : 'file',
      };

      if (entry.isFile()) {
        const stats = await fs.stat(fullEntryPath);
        info.size = stats.size;
        info.modified = stats.mtime.toISOString();
      }

      files.push(info);

      if (recursive && entry.isDirectory()) {
        const subFiles = await this.listFiles(entryPath, true);
        files.push(...subFiles);
      }
    }

    return files;
  }

  /**
   * Scan project structure for server sync
   */
  async scanProjectStructure(): Promise<FolderTree> {
    return this.buildFolderTree('.');
  }

  private async buildFolderTree(relativePath: string): Promise<FolderTree> {
    const fullPath = this.validatePath(relativePath);
    const stats = await fs.stat(fullPath);
    const name = path.basename(fullPath) || this.basePath;

    if (stats.isFile()) {
      return {
        name,
        path: relativePath,
        type: 'file',
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };
    }

    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const children: FolderTree[] = [];

    for (const entry of entries) {
      // Skip common non-essential directories
      if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv'].includes(entry.name)) {
        continue;
      }

      const childPath = relativePath === '.' ? entry.name : path.join(relativePath, entry.name);
      children.push(await this.buildFolderTree(childPath));
    }

    return {
      name,
      path: relativePath,
      type: 'directory',
      children,
    };
  }

  /**
   * Scan all markdown files
   */
  async scanMarkdownFiles(): Promise<MdFile[]> {
    const mdFiles: MdFile[] = [];
    await this.findMarkdownFiles('.', mdFiles);
    return mdFiles;
  }

  private async findMarkdownFiles(relativePath: string, results: MdFile[]): Promise<void> {
    const fullPath = this.validatePath(relativePath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = relativePath === '.' ? entry.name : path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        // Skip non-essential directories
        if (!['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv'].includes(entry.name)) {
          await this.findMarkdownFiles(entryPath, results);
        }
      } else if (entry.name.endsWith('.md')) {
        try {
          const { content } = await this.readFile(entryPath);
          const hash = crypto.createHash('md5').update(content).digest('hex');
          results.push({ path: entryPath, content, hash });
        } catch (error) {
          logger.warn(`Failed to read MD file ${entryPath}:`, error);
        }
      }
    }
  }

  /**
   * Search in files (grep-like)
   */
  async searchInFiles(pattern: string, glob = '*'): Promise<{ file: string; matches: string[] }[]> {
    const results: { file: string; matches: string[] }[] = [];
    const regex = new RegExp(pattern, 'gi');
    const files = await this.listFiles('.', true);

    for (const file of files) {
      if (file.type !== 'file') continue;
      if (!this.matchGlob(file.name, glob)) continue;

      try {
        const { content } = await this.readFile(file.path);
        const lines = content.split('\n');
        const matches: string[] = [];

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            matches.push(`${index + 1}: ${line.trim()}`);
          }
        });

        if (matches.length > 0) {
          results.push({ file: file.path, matches });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  private matchGlob(filename: string, glob: string): boolean {
    if (glob === '*') return true;
    const pattern = glob.replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${pattern}$`, 'i').test(filename);
  }

  /**
   * Watch for file changes
   */
  startWatching(onChange: (event: string, path: string) => void): void {
    if (this.watcher) {
      this.watcher.close();
    }

    this.watcher = watch(this.basePath, {
      ignored: /(node_modules|\.git|dist|build)/,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on('add', (p) => onChange('add', path.relative(this.basePath, p)))
      .on('change', (p) => onChange('change', path.relative(this.basePath, p)))
      .on('unlink', (p) => onChange('unlink', path.relative(this.basePath, p)));

    logger.info('File watcher started');
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('File watcher stopped');
    }
  }
}
