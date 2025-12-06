/**
 * Disk Storage Service
 * Local disk file I/O per interfaces.md §6
 * Storage path: /data/<projectId>/<bucket>/<path>
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';

export interface FileMetadata {
  size: number;
  contentType: string;
  path: string;
}

@Injectable()
export class DiskStorageService {
  private readonly logger = new Logger(DiskStorageService.name);
  private readonly storageBasePath: string;

  constructor(private configService: ConfigService) {
    this.storageBasePath = this.configService.get<string>('storageBasePath') || '/data';
  }

  /**
   * Write file to disk
   */
  async writeFile(
    projectId: string,
    bucket: string,
    filePath: string,
    stream: Readable,
    contentType: string,
  ): Promise<FileMetadata> {
    const fullPath = this.getFullPath(projectId, bucket, filePath);

    // Ensure directory exists
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });

    // Write file
    const writeStream = createWriteStream(fullPath);

    await new Promise<void>((resolve, reject) => {
      stream.pipe(writeStream);
      writeStream.on('finish', () => resolve());
      writeStream.on('error', (err) => reject(err));
    });

    // Get file size
    const stats = await fs.stat(fullPath);

    this.logger.log(
      `File written: ${projectId}/${bucket}/${filePath} (${stats.size} bytes)`,
    );

    return {
      size: stats.size,
      contentType,
      path: filePath,
    };
  }

  /**
   * Read file from disk
   */
  async readFile(
    projectId: string,
    bucket: string,
    filePath: string,
  ): Promise<{ stream: Readable; metadata: FileMetadata }> {
    const fullPath = this.getFullPath(projectId, bucket, filePath);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch {
      throw new NotFoundException(`File not found: ${filePath}`);
    }

    const stats = await fs.stat(fullPath);
    const stream = createReadStream(fullPath);

    // Try to determine content type from extension
    const contentType = this.getContentTypeFromPath(filePath);

    return {
      stream,
      metadata: {
        size: stats.size,
        contentType,
        path: filePath,
      },
    };
  }

  /**
   * Delete file from disk
   */
  async deleteFile(
    projectId: string,
    bucket: string,
    filePath: string,
  ): Promise<void> {
    const fullPath = this.getFullPath(projectId, bucket, filePath);

    try {
      await fs.unlink(fullPath);
      this.logger.log(`File deleted: ${projectId}/${bucket}/${filePath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`File not found: ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(
    projectId: string,
    bucket: string,
    filePath: string,
  ): Promise<boolean> {
    const fullPath = this.getFullPath(projectId, bucket, filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get full disk path with comprehensive security validation
   * Prevents path traversal attacks via absolute paths, .., and invalid bucket names
   */
  private getFullPath(projectId: string, bucket: string, filePath: string): string {
    // Validate projectId format (must match proj_<16 hex chars>)
    if (!/^proj_[a-z0-9]{16}$/.test(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    // Validate bucket (alphanumeric + hyphen, 3-63 chars, S3-compatible)
    // Must start/end with alphanumeric, no slashes or .. allowed
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new BadRequestException('Invalid bucket name');
    }

    // Remove leading slashes (prevents absolute path override in path.join)
    // Remove leading .. (prevents directory traversal)
    const sanitizedPath = path.normalize(filePath)
      .replace(/^[\/\\]+/, '')           // Remove leading slashes
      .replace(/^(\.\.(\/|\\|$))+/, ''); // Remove leading ..

    const fullPath = path.join(this.storageBasePath, projectId, bucket, sanitizedPath);

    // Final safety check: ensure resolved path is within allowed base directory
    const resolved = path.resolve(fullPath);
    const allowedBase = path.resolve(this.storageBasePath, projectId, bucket);

    if (!resolved.startsWith(allowedBase + path.sep) && resolved !== allowedBase) {
      throw new BadRequestException('Invalid file path');
    }

    return fullPath;
  }

  /**
   * Get content type from file extension
   */
  private getContentTypeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
