/**
 * LaunchDB Storage Service
 * Multi-tenant file storage with signed URLs
 * Port 8003
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Storage Service');
  const app = await NestFactory.create(AppModule);

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
      'CORS_ORIGIN environment variable must be set for storage service',
    );
  }

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  const port = process.env.STORAGE_SERVICE_PORT || 8003;
  await app.listen(port);

  logger.log(`Storage Service listening on port ${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start Storage Service', error.stack);
  process.exit(1);
});
