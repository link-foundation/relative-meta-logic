// RML vendoring shim, not upstream code. The PR #201 network.js imports the
// complete grammar catalog (tens of megabytes of data). The typed-program code
// copied here only needs LinkNetwork with field relations, which the pinned
// js/vendor/meta-language submodule already provides, so both share one class.
export * from '../../../meta-language/js/src/network.js';
