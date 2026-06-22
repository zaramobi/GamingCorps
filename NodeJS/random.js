/**
 * random.js — Uniform integer generation.
 *
 * Uses crypto.randomInt (Node ≥ 14.10) which draws from the OS CSPRNG
 * (getrandom / CryptGenRandom).  Falls back to Math.random only if
 * crypto is unavailable (e.g. a stripped build).
 *
 * Limitation: Math.random() is not cryptographically secure and has a
 * 32-bit internal state — suitable for a game demo, not for real money.
 * In production use crypto.randomInt exclusively.
 */

const crypto = require("crypto");

/**
 * Returns a random integer in [min, max] (both inclusive).
 * Throws a RangeError if min > max or either bound is not a safe integer.
 */
function randomInt(min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw Object.assign(new RangeError("min and max must be integers"), { status: 400 });
  }
  if (min > max) {
    throw Object.assign(new RangeError("min must be <= max"), { status: 400 });
  }

  if (crypto.randomInt) {
    // crypto.randomInt(min, max) upper bound is exclusive, so pass max + 1
    return crypto.randomInt(min, max + 1);
  }

  // Fallback (insecure — see module doc)
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { randomInt };
