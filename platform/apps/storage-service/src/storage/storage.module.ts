/**
 * Storage Module
 * Multi-tenant file storage module
 */

import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { DiskStorageService } from './disk-storage.service';
import { SignedUrlService } from './signed-url.service';
import { DatabaseModule } from '@launchdb/common/database';
import { CryptoModule } from '@launchdb/common/crypto';

@Module({
  imports: [
    DatabaseModule,
    CryptoModule,
    MulterModule.register({
      limits: {
        fileSize: 100 * 1024 * 1024, // 100 MB max file size
      },
    }),
  ],
  controllers: [StorageController],
  providers: [
    StorageService,
    DiskStorageService,
    SignedUrlService,
  ],
  exports: [StorageService, DiskStorageService, SignedUrlService],
})
export class StorageModule {}
