#!/usr/bin/env node
// Use for build, test, check, bench, doc, package, clippy and coverage subcommands.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-with-cache.mjs', import.meta.url)), '--', 'cargo', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
