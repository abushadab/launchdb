import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { Response } from 'express';
import { LaunchDbError } from './launchdb-error';

@Catch(LaunchDbError)
export class LaunchDbErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(LaunchDbErrorFilter.name);

  catch(exception: LaunchDbError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    this.logger.warn(
      `${exception.code}: ${exception.message}`,
      exception.originalError?.stack,
    );

    response.status(exception.httpStatusCode).json(exception.toJSON());
  }
}
