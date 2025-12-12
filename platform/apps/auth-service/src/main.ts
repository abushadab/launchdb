/**
 * LaunchDB Auth Service
 * Multi-tenant authentication service
 * Port 8001
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { LaunchDbErrorFilter } from '@launchdb/common/errors';

async function bootstrap() {
  const logger = new Logger('Auth Service');
  const app = await NestFactory.create(AppModule);

  // Global exception filter for LaunchDbError
  app.useGlobalFilters(new LaunchDbErrorFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS for client applications
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin) {
    throw new Error(
      'CORS_ORIGIN environment variable must be set for auth service',
    );
  }

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  const port = process.env.AUTH_SERVICE_PORT || 8001;
  await app.listen(port);

  logger.log(`Auth Service listening on port ${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start Auth Service', error.stack);
  process.exit(1);
});
