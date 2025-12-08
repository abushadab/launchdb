/**
 * LaunchDB JWT Module
 * Provides JWT encoding/decoding services
 */

import { Module } from '@nestjs/common';
import { JwtModule as NestJwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from './jwt.service';

@Module({
  imports: [
    ConfigModule,
    NestJwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('platformJwtSecret') || config.get<string>('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          // Note: expiresIn removed from global config to prevent conflicts
          // All JWT claims should set exp manually in the payload
        },
      }),
    }),
  ],
  providers: [JwtService],
  exports: [JwtService],
})
export class JwtModule {}
