/**
 * LaunchDB Auth Service
 * Multi-tenant authentication service
 * Port 8001
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

  console.log(`Auth Service listening on port ${port}`);
}

bootstrap();
