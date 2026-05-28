const crypto = require('crypto');

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.replace(/=+$/, '').toUpperCase();
  let val = 0;
  let count = 0;
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const idx = alphabet.indexOf(str[i]);
    if (idx === -1) throw new Error('Invalid base32 character');
    val = (val << 5) | idx;
    count += 5;
    if (count >= 8) {
      bytes.push((val >>> (count - 8)) & 255);
      count -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret(length = 16) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    secret += alphabet[bytes[i] % 32];
  }
  return secret;
}

function verifyTOTP(token, secret, timeStep = 30) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return false;
  
  try {
    const key = base32Decode(secret);
    const nowEpoch = Math.floor(Date.now() / 1000);
    
    // Check current step and adjacent steps to allow for slight clock drift
    for (let offset = -1; offset <= 1; offset++) {
      const counter = Math.floor((nowEpoch + offset * timeStep) / timeStep);
      const buffer = Buffer.alloc(8);
      // Write counter as 64-bit big endian integer
      buffer.writeUInt32BE(0, 0);
      buffer.writeUInt32BE(counter, 4);
      
      const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
      const hmacOffset = hmac[hmac.length - 1] & 0xf;
      const code = (
        ((hmac[hmacOffset] & 0x7f) << 24) |
        ((hmac[hmacOffset + 1] & 0xff) << 16) |
        ((hmac[hmacOffset + 2] & 0xff) << 8) |
        (hmac[hmacOffset + 3] & 0xff)
      ) % 1000000;
      
      if (String(code).padStart(6, '0') === token) {
        return true;
      }
    }
  } catch (e) {
    console.error('[totp] Verification error:', e.message);
  }
  return false;
}

module.exports = {
  generateSecret,
  verifyTOTP
};
