/**
 * LaunchDB PostgREST Module
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '@launchdb/common/database';
import { CryptoModule } from '@launchdb/common/crypto';
import { PostgRestService } from './postgrest.service';
import { PostgRestManagerService } from './postgrest-manager.service';
import { PostgRestProxyController } from './postgrest-proxy.controller';

@Module({
  imports: [
    HttpModule,
    DatabaseModule,
    CryptoModule,
  ],
  controllers: [PostgRestProxyController],
  providers: [
    PostgRestService,
    PostgRestManagerService,
  ],
  exports: [
    PostgRestService,
    PostgRestManagerService,
  ],
})
export class PostgrestModule {}
