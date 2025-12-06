/**
 * Auth Service Root Module
 * Configures multi-tenant authentication
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '@launchdb/common/config';
import { DatabaseModule } from '@launchdb/common/database';
import { CryptoModule } from '@launchdb/common/crypto';
import { JwtModule } from '@launchdb/common/jwt';
import { AuthModule } from './auth/auth.module';
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
    JwtModule,

    // Feature modules
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
