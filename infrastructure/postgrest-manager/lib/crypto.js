/**
 * AES-256-GCM decryption for postgrest-manager
 * Compatible with platform crypto.service.ts
 *
 * Format: IV (12 bytes) || ciphertext || tag (16 bytes)
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96 bits for GCM
const TAG_LENGTH = 16;  // 128 bits

let masterKey = null;

/**
 * Get master key from environment
 * Validates key length on first access
 * @returns {Buffer} 32-byte master key
 */
function getMasterKey() {
  if (!masterKey) {
    const keyB64 = process.env.LAUNCHDB_MASTER_KEY;
    if (!keyB64) {
      throw new Error('LAUNCHDB_MASTER_KEY environment variable required');
    }

    masterKey = Buffer.from(keyB64, 'base64');

    if (masterKey.length !== 32) {
      throw new Error(`Invalid master key length: ${masterKey.length} bytes (expected 32)`);
    }
  }
  return masterKey;
}

/**
 * Decrypt AES-256-GCM encrypted data
 * @param {Buffer} encrypted - Encrypted buffer (IV + ciphertext + tag)
 * @returns {string} Decrypted plaintext
 */
function decrypt(encrypted) {
  if (!Buffer.isBuffer(encrypted)) {
    throw new Error('Encrypted value must be a Buffer');
  }

  if (encrypted.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Encrypted data too short');
  }

  const key = getMasterKey();

  // Extract components: IV || ciphertext || tag
  const iv = encrypted.slice(0, IV_LENGTH);
  const tag = encrypted.slice(-TAG_LENGTH);
  const ciphertext = encrypted.slice(IV_LENGTH, -TAG_LENGTH);

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  // Decrypt
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/**
 * Validate that master key is configured
 * Call at boot to fail fast
 */
function validateMasterKey() {
  getMasterKey(); // Throws if invalid
}

module.exports = {
  decrypt,
  validateMasterKey,
};
