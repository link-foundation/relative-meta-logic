// Rust is compiled and tested only on hosted CI; local verification uses the
// JavaScript implementation. Every repository path that would compile Rust asks
// this policy first, so a local run cannot start a Rust build by accident.
// RML_ALLOW_LOCAL_RUST=1 is the explicit, per-invocation override.

/** Cargo subcommands that neither compile nor test Rust. */
const nonCompiling = new Set(['fmt', 'fetch', 'metadata', 'locate-project', 'tree', 'version', '--version', '-V', '--list']);

/** The reason a local Rust compilation is refused, or null when it is allowed. */
export function localRustRefusal(env = process.env) {
  if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true' || env.RML_ALLOW_LOCAL_RUST === '1') return null;
  return 'Rust is compiled only in CI; local verification uses JavaScript (set RML_ALLOW_LOCAL_RUST=1 to override)';
}

/** Whether a cargo argument vector compiles or tests Rust. */
export function cargoCompiles(args) {
  const subcommand = args.find(arg => !arg.startsWith('+') && !/^-(?:-locked|-offline|-frozen|q|v+|-quiet|-verbose)$/.test(arg));
  return subcommand !== undefined && !nonCompiling.has(subcommand);
}

/** Throws unless this process may compile Rust. */
export function assertLocalRustAllowed(env = process.env) {
  const refusal = localRustRefusal(env);
  if (refusal) throw new Error(refusal);
}
