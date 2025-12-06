/**
 * LaunchDB Token Hash Service
 * SHA-256 hashing for token validation
 */

import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class TokenHashService {
  /**
   * Hash token using SHA-256
   * Used for signed URL token validation
   */
  hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generate random token (32 bytes, hex encoded)
   */
  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
