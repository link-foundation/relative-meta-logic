# Shared Test Corpus

This folder contains `.lino` regression inputs that are shared by the
JavaScript and Rust test suites.

Each corpus file is listed in `expected.lino` with the query results both
implementations must produce. Tests in `js/tests/shared-test-corpus.test.mjs`
and `rust/tests/shared_test_corpus.rs` walk `test-corpus/*.lino`, excluding
`expected.lino`, and compare runtime output against that single contract.

`lino-frontend/cases.json` holds the cases both runtimes read through the
shared LiNo front end (`js/src/rml-lino-frontend.mjs` and
`rust/src/lino_frontend.rs`): the forms each source yields, with their lines
and columns, or the E006 error it fails with, and the text, the logical lines,
and the references that start with a quote that the prepare step returns.
`js/tests/lino-frontend.test.mjs` and `rust/tests/lino_frontend_tests.rs` check
every case.
`experiments/lino-frontend/case-entry.mjs` prints the entry for a new source,
`experiments/lino-frontend/differential.mjs` reads generated documents with
both front ends and prints any they read differently, and
`experiments/lino-frontend/deep-documents.mjs` generates and compares documents
whose parentheses nest deeper.
