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
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('platformJwtSecret') || config.get<string>('JWT_SECRET');

        if (!secret) {
          throw new Error('JWT secret is required. Set platformJwtSecret or JWT_SECRET in environment');
        }

        return {
          secret,
          signOptions: {
            // NOTE: expiresIn removed - we always set exp explicitly in claims
            // Having a default expiresIn causes "exp already set" conflicts
            algorithm: 'HS256',
          },
        };
      },
    }),
  ],
  providers: [JwtService],
  exports: [JwtService],
})
export class JwtModule {}
