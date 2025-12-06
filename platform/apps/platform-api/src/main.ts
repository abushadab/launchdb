/**
 * LaunchDB Platform API
 * Main entry point for Platform API service
 * Port 8000 per nestjs-plan.md Section 0
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Platform API');
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS for development
  app.enableCors();

  const port = process.env.PLATFORM_API_PORT || 8000;
  await app.listen(port);

  logger.log(`Platform API listening on port ${port}`);
}

bootstrap();
