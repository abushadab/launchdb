/**
 * LaunchDB Migrations Runner Service
 * Database schema migration executor
 * Port 8002
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { LaunchDbErrorFilter } from '@launchdb/common/errors';

async function bootstrap() {
  const logger = new Logger('Migrations Runner');
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

  const port = parseInt(process.env.MIGRATIONS_RUNNER_PORT || '8002', 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${process.env.MIGRATIONS_RUNNER_PORT}`);
  }
  await app.listen(port);

  logger.log(`Migrations Runner Service listening on port ${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start Migrations Runner Service', error.stack);
  process.exit(1);
});
