/**
 * LaunchDB Config Module
 * Provides configuration management across all services
 */

import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import configuration from './configuration';

@Module({
  imports: [
    NestConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      cache: true,
    }),
  ],
  exports: [NestConfigModule],
})
export class LaunchDBConfigModule {}
