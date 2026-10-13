// rml-certified-item rust/src/lino_frontend.rs#MAX_LINO_NESTING_DEPTH@4785 target-sha256=0a238fbe446a4dfc488d75bd8e5872091cade048c6a1b318bf103104f0f16a14
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function MAX_LINO_NESTING_DEPTH() {
  return 64n;
}

function main() {

}

main();
// rml-certified-item rust/src/lino_frontend.rs#MAX_LINO_SOURCE_UNITS@4909 target-sha256=1aaebc104aa5bbd39cffa4acbd069805f2b7ca5df4a984a0a5583458d9a90131
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function ml_fixed(value, min, max, message) {
  if (value < min || value > max) throw new RangeError(message);
  return value;
}

function MAX_LINO_SOURCE_UNITS() {
  return ml_fixed((ml_fixed((10n * 1024n), 0n, 18446744073709551615n, "attempt to multiply with overflow") * 1024n), 0n, 18446744073709551615n, "attempt to multiply with overflow");
}

function main() {

}

main();
// rml-certified-item rust/src/lino_frontend.rs#LINO_PIECE_DEPTH@5117 target-sha256=28bae79ac89fd91c829f7533933ff3f1dba0e6185d38ffd321ab629ecf5f772a
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function LINO_PIECE_DEPTH() {
  return 2n;
}

function main() {

}

main();
// rml-certified-item rust/src/lino_frontend.rs#DROPPED_LINE@31975 target-sha256=970d7cd7216bc948af8d8475916f37b1e492e03c62bc3efca16e57691010e4a2
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function DROPPED_LINE() {
  return "unexpected indentation under a value of an indented id";
}

function main() {

}

main();
// rml-certified-item rust/src/lino_frontend.rs#PRIVATE_USE_COUNT@35678 target-sha256=c9699ecf1fb97fa98737e7b2c8c6b810d51b0d0797e457da348a5245e1ba3372
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function PRIVATE_USE_COUNT() {
  return 6400n;
}

function main() {

}

main();
