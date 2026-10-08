# Relative Meta Logic for VS Code

This extension adds editor support for Relative Meta Logic `.lino` files:

- Syntax highlighting and language configuration for LiNo source files
- Diagnostics, hover, go-to-definition, and completion through `rml-lsp`

Requires VS Code 1.91 or later and Node.js 22 or later.

## Install From VSIX

```sh
cd vscode
npm install
npm run package
code --install-extension relative-meta-logic.vsix
```

The VSIX bundles the JavaScript language server sources from `../js/src` at
package time. In a repository checkout, the extension falls back to that local
server path for development.

## Settings

- `rml.server.command`: override the bundled server command, for example
  `rml-lsp` when the CLI is installed globally.
- `rml.server.args`: additional arguments passed to the server command.

## Test

```sh
cd vscode
npm test
```

The smoke test resolves the same server command used by the extension, starts
the LSP over stdio, opens `.lino` text, and verifies diagnostics and
completions.
