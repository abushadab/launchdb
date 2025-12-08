/**
 * LaunchDB Migrations Runner Service
 * Database schema migration executor
 * Port 8002
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule);

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

    console.log(`Migrations Runner Service listening on port ${port}`);
  } catch (error) {
    console.error('Failed to start Migrations Runner Service:', error);
    process.exit(1);
  }
}

bootstrap();
