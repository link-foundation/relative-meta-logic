// Number and BigInt arithmetic, an object-literal namespace and node:assert effects.
import assert from 'node:assert/strict';

const numeric = {
  /** @param {bigint} n @returns {bigint} */
  factorial(n) {
    if (n <= 0n) return 1n;
    return n * numeric.factorial(n - 1n);
  },
  /** @param {number} x @returns {number} */
  half(x) {
    return x / 2;
  },
};

/** @param {bigint} a @param {bigint} b @returns {bigint} */
function power(a, b) {
  if (b === 0n) return 1n;
  return a * power(a, b - 1n);
}

console.log(String(numeric.factorial(20n)));
console.log(numeric.half(7));
console.log(String(power(2n, 64n)));
assert.equal(numeric.half(10), 5);
