/**
 * Runtime-agnostic constant-time string comparison.
 *
 * Lives in its own module with zero imports because it must be usable from the
 * edge middleware *and* from the Node request handlers. Importing `node:crypto`
 * here would drag the whole Node crypto shim into the edge bundle.
 *
 * The comparison is not perfectly constant-time in the strictest sense — length
 * is observable through loop count — but it deliberately performs the same work
 * for equal-length inputs and does not short-circuit on the first differing
 * byte, which is what defeats naive timing oracles.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const lengthA = a.length;
  const lengthB = b.length;
  // Compare against a fixed-size buffer so the work does not depend on either
  // input's length beyond the initial normalisation.
  const max = Math.max(lengthA, lengthB, 32);
  let diff = lengthA ^ lengthB;

  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i % (lengthA || 1)) || 0) ^ (b.charCodeAt(i % (lengthB || 1)) || 0);
  }

  return diff === 0;
}
