const FNV_128_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_128_PRIME = 0x0000000001000000000000000000013bn;
const FNV_128_MASK = (1n << 128n) - 1n;

/** Impressão digital determinística para identidades; não é usada como PRNG. */
export function stableFingerprint(value: string): string {
  let hash = FNV_128_OFFSET;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_128_PRIME) & FNV_128_MASK;
  }
  return hash.toString(16).padStart(32, "0");
}
