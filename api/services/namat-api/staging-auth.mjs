import {createHash, timingSafeEqual} from 'node:crypto';

// Compare fixed-length digests so neither a prefix nor a length mismatch can
// reveal the configured credential. The server also bounds total header size.
export function hasStagingAccess(authorization, token) {
  const supplied = typeof authorization === 'string' ? authorization : '';
  const expected = `Bearer ${token}`;
  return timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest());
}
