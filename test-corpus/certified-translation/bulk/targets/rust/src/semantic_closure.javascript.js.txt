// rml-certified-item rust/src/semantic_closure.rs#SEMANTIC_CLOSURE_SCHEMA@1963 target-sha256=1934b333aa4fe886b7d67f60cdf4dea567f7e5c5540013db8501ed76f81b0fd5
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function SEMANTIC_CLOSURE_SCHEMA() {
  return "rml-semantic-closure/v1";
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#UNIVERSE_CONTRACT_SCHEMA@2032 target-sha256=7326c3053ce538724a31c7ab1617a369aa2790c12d878b86a8114654a2048474
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function UNIVERSE_CONTRACT_SCHEMA() {
  return "rml-universe-contract/v1";
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#ROOT@2323 target-sha256=e721ea0d050a89139c4db92a52532bffd8eb4348efa8dbe29d57a96b239dafec
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function ROOT() {
  return "rml.closure";
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#NIL@2357 target-sha256=f1c441dd989b67e7dceee3cead0f4ff23afbe25388fa3192b96485ff3693da96
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function NIL() {
  return "rml.nil";
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#ONTOLOGY@2386 target-sha256=16bc955691e764664b7bfac2194f0b4f8b5a4b1f5295cb9de29ee09bad35e20f
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function ONTOLOGY() {
  return "rml.ontology";
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#CATEGORY_ROOT@2425 target-sha256=cb052a4de49f3ec1b5011f4bc29730b13dac56aec6f5d9654f776de2ebc9d8d3
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function CATEGORY_ROOT() {
  return "rml.category";
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#labelled_role@2548 target-sha256=911cc013e2c238335ebd308066b5d4aaedde1b69a6a96ceee745e4892fb2d6f8
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function labelled_role(role) {
  return ((role === "assumption") || (role === "hypothesis"));
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#atom_address@3041 target-sha256=beee9c2d17e73db93ecbce02bfeba22848c4edc75d52f6ce8e234e610021f3eb
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function atom_address(text) {
  return ("rml.atom/" + text);
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#tag_address@3114 target-sha256=7137099aa8f37b2dbed9ce965480809e5befd7aad08ec49d1a6a515917f626af
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function atom_address(text) {
  return ("rml.atom/" + text);
}

function tag_address(kind) {
  return atom_address(("rml." + kind));
}

function main() {

}

main();
// rml-certified-item rust/src/semantic_closure.rs#program_address@3280 target-sha256=97f953a776bd5dd46cb22f1d843129c0ff668a29371cbe45fddbe9db8c5afa06
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function program_address(name) {
  return ("rml.program/" + name);
}

function main() {

}

main();
