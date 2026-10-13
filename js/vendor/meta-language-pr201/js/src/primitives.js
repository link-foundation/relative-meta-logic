// RML vendoring shim, not upstream code. The PR #201 primitives.js is
// byte-identical to the pinned submodule copy (its sha256 is recorded in
// upstream-files.json). Re-exporting it keeps a single LinkId/LinkMetadata
// class identity shared with RML's `#meta-language` import.
export * from '../../../meta-language/js/src/primitives.js';
