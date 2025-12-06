/**
 * Storage Service Root Module
 * Configures multi-tenant file storage
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '@launchdb/common/config';
import { DatabaseModule } from '@launchdb/common/database';
import { CryptoModule } from '@launchdb/common/crypto';
import { StorageModule } from './storage/storage.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Shared libraries
    DatabaseModule,
    CryptoModule,

    // Feature modules
    StorageModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
