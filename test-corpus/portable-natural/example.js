// Pure natural arithmetic; all effects/proofs remain outside this fragment.
function rml_square(x) { return x * x; }
function rml_mix(x, y) { return x <= y ? rml_square(x) + y : rml_square(y) + x; }
function rml_guard(x, y) { return x === y ? 0 : x < y ? rml_mix(x, y) + 1 : rml_mix(y, x) * 2; }
