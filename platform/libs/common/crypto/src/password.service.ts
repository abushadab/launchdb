/**
 * LaunchDB Password Service
 * Argon2id password hashing compatible with Python implementation
 */

import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * Hash password using Argon2id
   * Parameters match Python implementation:
   * - type: Argon2id
   * - time_cost: 2
   * - memory_cost: 65536 (64 MB)
   * - parallelism: 1
   * - hash_length: 32
   * - salt_length: 16
   */
  async hash(password: string): Promise<string> {
    try {
      return await argon2.hash(password, {
        type: argon2.argon2id,
        timeCost: 2,
        memoryCost: 65536, // 64 MB
        parallelism: 1,
        hashLength: 32,
        saltLength: 16,
      });
    } catch (error) {
      this.logger.error(`Password hashing failed: ${error.message}`);
      throw new Error('Password hashing failed');
    }
  }

  /**
   * Verify password against Argon2id hash
   * Compatible with Python argon2-cffi hashes
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      this.logger.error(`Password verification failed: ${error.message}`);
      return false;
    }
  }
}
