#!/usr/bin/env python3
"""Explicit direct-rustc builder. Its build subcommand matches the ABI verifier's CARGO hook only."""
import sys, os, json, hashlib, subprocess, pathlib, time
HERE = pathlib.Path(__file__).resolve().parent
CONFIG = json.loads((HERE / 'generic-inputs.json').read_text())
RESERVE = 256 * 1024 * 1024

def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

def verify_generic():
    for item in CONFIG['files']:
        if sha(item['path']) != item['sha256']:
            raise RuntimeError('Generic input changed: ' + item['path'])

def run(args, env=None):
    if os.statvfs(HERE).f_bavail * os.statvfs(HERE).f_frsize < RESERVE:
        raise RuntimeError('Refusing direct rustc: free space is below the 256 MiB reserve')
    print('DIRECT RUSTC ' + json.dumps(args), flush=True)
    subprocess.run(args, check=True, env={**os.environ, **(env or {})})

def common(crate, source, output, kind, provider_kind, extra=None):
    selected = CONFIG['selection'][provider_kind]
    directory = pathlib.Path(next(iter(selected.values()))).parent
    args = ['rustc', '--edition=2021', '--crate-name', crate, str(source), '--crate-type', kind,
            '-C', 'opt-level=1', '-C', 'debuginfo=0', '-C', 'codegen-units=2', '-A', 'unused_parens',
            '-L', 'dependency=' + str(directory), '-o', str(output)]
    for name, path in selected.items():
        args += ['--extern', name + '=' + path]
    args += extra or []
    run(args)
    return {'crate': crate, 'source': str(source), 'sourceSha256': sha(source), 'output': str(output), 'outputSha256': sha(output), 'command': args}

def runtime(root, out):
    return common('rml', root / 'rust/src/lib.rs', out / 'librml.rlib', 'rlib', 'rml')

def main():
    verify_generic()
    mode, *args = sys.argv[1:]
    records = []
    if mode == 'rml':
        root, out = map(pathlib.Path, args)
        out.mkdir(parents=True, exist_ok=True)
        records.append(runtime(root, out))
    elif mode == 'helper':
        root, out = map(pathlib.Path, args)
        out.mkdir(parents=True, exist_ok=True)
        records.append(common('rml_linked_rust_ast', root / 'scripts/linked-runtime-rust/src/main.rs', out / 'rml-linked-rust-ast', 'bin', 'helper'))
    elif mode == 'build':
        # This is the sole Cargo-shaped operation requested by verifyLinkedTarget.
        if set(args[::2]) == set():
            raise RuntimeError('Missing ABI build options')
        allowed = {'--offline', '--locked', '--manifest-path', '--target-dir'}
        if any(a.startswith('--') and a not in allowed for a in args):
            raise RuntimeError('Unsupported build option')
        manifest = pathlib.Path(args[args.index('--manifest-path') + 1]).resolve()
        target = pathlib.Path(args[args.index('--target-dir') + 1]).resolve()
        if manifest.parts[-3:] != ('rust', 'linked-target', 'Cargo.toml'):
            raise RuntimeError('Only the declared linked-target build is supported')
        if not target.is_relative_to(HERE):
            raise RuntimeError('Direct output must belong to the new lease owner')
        root = manifest.parents[2]
        config = json.loads(pathlib.Path('/workspace/shared/rml-full-source-integration/lib/linked-runtime/configuration-manifest.json').read_text())
        for relative in ['rust/Cargo.toml', 'rust/Cargo.lock', 'rust/linked-target/Cargo.toml', 'rust/linked-target/Cargo.lock']:
            expected = next(x for x in config['files'] if x['path'] == relative)
            if sha(root / relative) != expected['generatedSha256']:
                raise RuntimeError('Emitted configuration drift: ' + relative)
        out = target / 'debug'
        out.mkdir(parents=True, exist_ok=True)
        records.append(runtime(root, out))
        own = ['-L', 'dependency=' + str(out), '--extern', 'rml=' + str(out / 'librml.rlib')]
        records.append(common('rml_linked_target', root / 'rust/linked-target/src/lib.rs', out / 'librml_linked_target.rlib', 'rlib', 'rml', own))
        records.append(common('rml_linked_target', root / 'rust/linked-target/src/main.rs', out / 'rml-linked-target', 'bin', 'rml', own + ['--extern', 'rml_linked_target=' + str(out / 'librml_linked_target.rlib')]))
    else:
        raise RuntimeError('Unsupported direct-rustc operation: ' + mode)
    verify_generic()
    with (HERE / 'direct-compilation-receipts.jsonl').open('a') as stream:
        for record in records:
            stream.write(json.dumps(record) + '\n')

if __name__ == '__main__':
    main()
