import { randomUUID } from 'crypto';

export function cryptoRandomString(): string {
  return randomUUID();
}
