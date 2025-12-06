/**
 * LaunchDB Crypto Module
 * Provides encryption, password hashing, and token hashing services
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CryptoService } from './crypto.service';
import { PasswordService } from './password.service';
import { TokenHashService } from './token-hash.service';

@Module({
  imports: [ConfigModule],
  providers: [CryptoService, PasswordService, TokenHashService],
  exports: [CryptoService, PasswordService, TokenHashService],
})
export class CryptoModule {}
