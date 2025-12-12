/**
 * LaunchDB Platform API
 * Main entry point for Platform API service
 * Port 8000 per nestjs-plan.md Section 0
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { LaunchDbErrorFilter } from '@launchdb/common/errors';

async function bootstrap() {
  const logger = new Logger('Platform API');
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

  // Configure CORS
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin) {
    throw new Error(
      'CORS_ORIGIN environment variable must be set for platform API',
    );
  }

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  const port = process.env.PLATFORM_API_PORT || 8000;
  await app.listen(port);

  logger.log(`Platform API listening on port ${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start Platform API', error.stack);
  process.exit(1);
});
