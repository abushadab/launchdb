/**
 * LaunchDB Owners Module
 * Owner authentication module
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@launchdb/common/jwt';
import { DatabaseModule } from '@launchdb/common/database';
import { CryptoModule } from '@launchdb/common/crypto';
import { OwnersController } from './owners.controller';
import { OwnersService } from './owners.service';

@Module({
  imports: [DatabaseModule, CryptoModule, JwtModule],
  controllers: [OwnersController],
  providers: [OwnersService],
  exports: [OwnersService],
})
export class OwnersModule {}
