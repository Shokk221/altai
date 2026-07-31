import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

// Format: scrypt$<saltHex>$<hashHex> — .env'e yazılacak BREAK_GLASS_PASSWORD_HASH
// değeri bu formatta üretilir (bkz. tools/hash-password).
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  const derived = (await scrypt(plain, salt, expected.length)) as Buffer;
  if (derived.length !== expected.length) return false;

  return timingSafeEqual(derived, expected);
}
