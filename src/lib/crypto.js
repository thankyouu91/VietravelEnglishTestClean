const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'default-fallback-secret-for-development-32-chars';
const ENCRYPTION_KEY = crypto.scryptSync(JWT_SECRET, 'pii-salt', 32);

function encryptPII(text) {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    console.error('[crypto] Encryption failed:', e.message);
    return text;
  }
}

function decryptPII(text) {
  if (!text) return text;
  if (typeof text !== 'string' || !text.includes(':')) {
    return text; // Return as-is for legacy plaintext data
  }
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    // Return original text if decryption fails to maintain compatibility
    return text;
  }
}

function hashEmail(email) {
  if (!email) return '';
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

module.exports = {
  encryptPII,
  decryptPII,
  hashEmail
};
