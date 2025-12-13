/**
 * PostgREST Proxy Controller
 * Proxies /db/:projectId/* requests to per-project PostgREST containers
 * Per Codex guidance: validate project active, then forward to postgrest-{projectId}:3000
 */

import {
  All,
  Controller,
  Param,
  Req,
  Res,
  Next,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { DatabaseService } from '@launchdb/common/database';
import { randomUUID } from 'crypto';

@Controller('db/:projectId')
export class PostgRestProxyController {
  private readonly logger = new Logger(PostgRestProxyController.name);

  constructor(private databaseService: DatabaseService) {}

  /**
   * Proxy all requests to per-project PostgREST container
   * Route: /db/:projectId/*
   */
  @All('*')
  async proxy(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    // Validate projectId format (avoid DB hit for invalid IDs)
    if (!/^proj_[a-z0-9]{16}$/.test(projectId)) {
      throw new NotFoundException('Project not found');
    }

    // Check project exists and is active
    try {
      const project = await this.databaseService.queryOne(
        'SELECT id, status FROM platform.projects WHERE id = $1',
        [projectId],
      );

      if (!project) {
        throw new NotFoundException('Project not found');
      }

      if (project.status !== 'active') {
        throw new ForbiddenException('Project not accessible');
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(`Failed to validate project ${projectId}: ${error.message}`);
      throw new ServiceUnavailableException('Database validation failed');
    }

    // Generate request ID for tracing
    const requestIdHeader = req.headers['x-request-id'];
    const requestId = (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) || randomUUID();

    // Create proxy middleware
    const proxy = createProxyMiddleware({
      target: `http://postgrest-${projectId}:3000`,
      changeOrigin: true,
      pathRewrite: {
        [`^/db/${projectId}`]: '', // Remove /db/{projectId} prefix
      },
      timeout: 30000, // 30 seconds
      proxyTimeout: 30000,

      // Forward specific headers
      onProxyReq: (proxyReq, req) => {
        // Add tracing headers FIRST (before any write)
        proxyReq.setHeader('X-Forwarded-For', req.ip || req.socket.remoteAddress || '');
        proxyReq.setHeader('X-Request-ID', requestId);

        // Re-stream body if it was parsed by body-parser middleware
        if (req.body && Object.keys(req.body).length > 0) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }

        this.logger.debug(
          `Proxying ${req.method} ${req.url} to postgrest-${projectId}:3000`,
        );
      },

      // Handle errors
      onError: (err: any, req, res) => {
        this.logger.error(
          `Proxy error for ${projectId}: ${err.message}`,
        );

        // Container unreachable
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
          (res as Response).status(503).json({
            error: 'Service Unavailable',
            message: 'PostgREST container is not running',
          });
          return;
        }

        // Timeout
        if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
          (res as Response).status(504).json({
            error: 'Gateway Timeout',
            message: 'Request to PostgREST timed out',
          });
          return;
        }

        // Generic error
        (res as Response).status(502).json({
          error: 'Bad Gateway',
          message: 'Failed to proxy request to PostgREST',
        });
      },
    });

    // Execute proxy
    return proxy(req, res, next);
  }
}
