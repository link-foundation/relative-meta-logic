// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function ml_fixed(value, min, max, message) {
  if (value < min || value > max) throw new RangeError(message);
  return value;
}

// Integer division with the source's rounding; by zero it aborts with the message `zero`
// or, when that is null, is total (x / 0 = 0, x % 0 = x); a machine-integer quotient
// out of [min, max] aborts with `overflow`, the remainder too.
function ml_divide(a, b, rounding, zero, remainder, bounds) {
  if (b === 0n) {
    if (zero !== null) throw new RangeError(zero);
    return remainder ? a : 0n;
  }
  let q = a / b;
  const r = a - q * b;
  if (r !== 0n) {
    if (rounding === 'floor' && (r < 0n) !== (b < 0n)) q -= 1n;
    if (rounding === 'euclid' && r < 0n) q = b > 0n ? q - 1n : q + 1n;
  }
  if (bounds && (q < bounds[0] || q > bounds[1])) throw new RangeError(bounds[2]);
  return remainder ? a - q * b : q;
}

function ml_assert(holds, statement) {
  if (!holds) throw new Error(`assertion failed: ${statement}`);
}

function gcd(a, b) {
  ml_fixed(a, -9223372036854775808n, 9223372036854775807n, "i64 argument a out of range");
  ml_fixed(b, -9223372036854775808n, 9223372036854775807n, "i64 argument b out of range");
  if ((b === 0n)) {
    return a;
  } else {
    return gcd(b, ml_divide(a, b, 'trunc', "attempt to calculate the remainder with a divisor of zero", true, [-9223372036854775808n, 9223372036854775807n, "attempt to calculate the remainder with overflow"]));
  }
}

function triangle(n) {
  ml_fixed(n, -9223372036854775808n, 9223372036854775807n, "i64 argument n out of range");
  if ((n === 0n)) {
    return 0n;
  } else {
    return ml_fixed((n + triangle(ml_fixed((n - 1n), -9223372036854775808n, 9223372036854775807n, "attempt to subtract with overflow"))), -9223372036854775808n, 9223372036854775807n, "attempt to add with overflow");
  }
}

function sign(value) {
  ml_fixed(value, -9223372036854775808n, 9223372036854775807n, "i64 argument value out of range");
  if ((value === 0n)) {
    return 0n;
  } else {
    if ((value > 0n)) {
      return 1n;
    } else {
      return (-1n);
    }
  }
}

function main() {
  const a = gcd(84n, 36n);
  console.log(String(a));
  console.log(String(triangle(10n)));
  console.log(((String(sign((-7n))) + " ") + String(sign(a))));
  ml_assert((triangle(4n) === 10n), "assertion 1");
}

main();
