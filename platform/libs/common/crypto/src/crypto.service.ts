/**
 * LaunchDB Crypto Service
 * AES-256-GCM encryption/decryption compatible with Python implementation
 * Per interfaces.md §4
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly masterKey: Buffer;
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly IV_LENGTH = 12; // 96 bits for GCM
  private readonly TAG_LENGTH = 16; // 128 bits

  constructor(private configService: ConfigService) {
    const masterKeyB64 = this.configService.get<string>('masterKey');
    if (!masterKeyB64) {
      throw new Error('masterKey is required');
    }

    // Master key must be base64-encoded 32 bytes (256 bits)
    this.masterKey = Buffer.from(masterKeyB64, 'base64');
    if (this.masterKey.length !== 32) {
      throw new Error(
        `Invalid master key length: ${this.masterKey.length} bytes (expected 32)`
      );
    }

    this.logger.log('Crypto service initialized with AES-256-GCM');
  }

  /**
   * Encrypt plaintext using AES-256-GCM
   * Format: <IV:12 bytes><ciphertext><tag:16 bytes>
   * Compatible with Python cryptography.hazmat.primitives.ciphers
   *
   * @param plaintext String to encrypt
   * @returns Encrypted buffer
   */
  encrypt(plaintext: string): Buffer {
    try {
      // Generate random IV
      const iv = crypto.randomBytes(this.IV_LENGTH);

      // Create cipher
      const cipher = crypto.createCipheriv(this.ALGORITHM, this.masterKey, iv);

      // Encrypt
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);

      // Get authentication tag
      const tag = cipher.getAuthTag();

      // Concatenate: IV || ciphertext || tag
      return Buffer.concat([iv, ciphertext, tag]);
    } catch (error) {
      this.logger.error(`Encryption failed: ${error.message}`);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt ciphertext using AES-256-GCM
   * Compatible with Python implementation
   *
   * @param encrypted Encrypted buffer
   * @returns Decrypted plaintext
   */
  decrypt(encrypted: Buffer): string {
    try {
      if (encrypted.length < this.IV_LENGTH + this.TAG_LENGTH) {
        throw new Error('Invalid encrypted data length');
      }

      // Extract components
      const iv = encrypted.slice(0, this.IV_LENGTH);
      const tag = encrypted.slice(-this.TAG_LENGTH);
      const ciphertext = encrypted.slice(this.IV_LENGTH, -this.TAG_LENGTH);

      // Create decipher
      const decipher = crypto.createDecipheriv(this.ALGORITHM, this.masterKey, iv);
      decipher.setAuthTag(tag);

      // Decrypt
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return plaintext.toString('utf8');
    } catch (error) {
      this.logger.error(`Decryption failed: ${error.message}`);
      throw new Error('Decryption failed');
    }
  }

  /**
   * Encrypt and return as base64 string (for database storage)
   */
  encryptToBase64(plaintext: string): string {
    return this.encrypt(plaintext).toString('base64');
  }

  /**
   * Decrypt from base64 string
   */
  decryptFromBase64(encrypted: string): string {
    return this.decrypt(Buffer.from(encrypted, 'base64'));
  }
}
