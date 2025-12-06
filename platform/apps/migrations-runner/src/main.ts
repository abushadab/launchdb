/**
 * LaunchDB Migrations Runner Service
 * Database schema migration executor
 * Port 8002
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.MIGRATIONS_RUNNER_PORT || 8002;
  await app.listen(port);

  console.log(`Migrations Runner Service listening on port ${port}`);
}

bootstrap();
