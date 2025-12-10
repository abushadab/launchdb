/**
 * Storage Controller
 * Path-based routing per interfaces.md §6
 * Routes: /storage/:projectId/:bucket/*
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  StreamableFile,
  HttpCode,
  HttpStatus,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Readable } from 'stream';
import { StorageService } from './storage.service';
import { UploadQueryDto, UploadResponseDto } from './dto/upload.dto';
import { CreateSignedUrlDto, SignedUrlResponseDto, DeleteResponseDto } from './dto/signed-url.dto';

@Controller('storage/:projectId')
export class StorageController {
  constructor(private storageService: StorageService) {}

  /**
   * Validate path to prevent directory traversal attacks
   */
  private validatePath(path: string): void {
    if (!path) {
      throw new BadRequestException('Path is required');
    }
    // Reject paths with directory traversal attempts
    if (path.includes('..')) {
      throw new BadRequestException('Path contains invalid directory traversal');
    }
    // Reject absolute paths
    if (path.startsWith('/')) {
      throw new BadRequestException('Path must be relative');
    }
  }

  /**
   * POST /storage/:projectId/:bucket/*
   * Upload file
   */
  @Post(':bucket/*')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Param('0') path: string,
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadQueryDto,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const bucketName = query.bucket || bucket || 'default';
    const filePath = path || file.originalname;

    // Validate path for security
    this.validatePath(filePath);

    const stream = Readable.from(file.buffer);

    return this.storageService.uploadFile(
      projectId,
      bucketName,
      filePath,
      stream,
      file.mimetype,
    );
  }

  /**
   * GET /storage/:projectId/:bucket/*
   * Download file (with optional signed URL token)
   */
  @Get(':bucket/*')
  async download(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Param('0') path: string,
    @Query('token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    // Validate path for security
    this.validatePath(path);

    let result;

    if (token) {
      // Download with signed URL
      result = await this.storageService.downloadWithSignedUrl(
        projectId,
        bucket,
        path,
        token,
      );
    } else {
      // Regular download
      result = await this.storageService.downloadFile(projectId, bucket, path);
    }

    // Sanitize filename for Content-Disposition header
    const filename = path.split('/').pop() || 'download';
    const sanitizedFilename = filename.replace(/["\r\n]/g, '_');

    res.set({
      'Content-Type': result.contentType,
      'Content-Length': result.size,
      'Content-Disposition': `inline; filename="${sanitizedFilename}"`,
    });

    return new StreamableFile(result.stream);
  }

  /**
   * DELETE /storage/:projectId/:bucket/*
   * Delete file
   */
  @Delete(':bucket/*')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Param('0') path: string,
  ): Promise<DeleteResponseDto> {
    // Validate path for security
    this.validatePath(path);

    await this.storageService.deleteFile(projectId, bucket, path);
    return { message: 'File deleted successfully' };
  }

  /**
   * POST /storage/:projectId/sign
   * Create signed URL
   */
  @Post('sign')
  @HttpCode(HttpStatus.OK)
  async createSignedUrl(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSignedUrlDto,
  ): Promise<SignedUrlResponseDto> {
    // Validate path for security
    this.validatePath(dto.path);

    const bucket = dto.bucket || 'default';
    const expiresIn = dto.expires_in || 300; // Default 5 minutes

    return this.storageService.createSignedUrl(
      projectId,
      bucket,
      dto.path,
      expiresIn,
    );
  }
}
