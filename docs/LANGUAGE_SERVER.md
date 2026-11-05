# RML Language Server

`rml-lsp` is a stdio Language Server Protocol server for `.lino` files. It
uses the JavaScript evaluator for diagnostics and provides editor features
that are useful while writing RML:

- Diagnostics from `evaluate()` as LSP `textDocument/publishDiagnostics`
- Hover text for local definitions and core RML keywords
- Go-to-definition for definitions declared in the current document
- Completion for keywords, operators, terms, templates, relations, and local
  definitions

The server reads a document through the same LiNo front end as the
evaluator, once per change. RML spans count columns in Unicode code points
(see [`DIAGNOSTICS.md`](./DIAGNOSTICS.md)); the server converts them to the
UTF-16 positions LSP uses, so a diagnostic or a definition after an emoji or
a leading byte order mark lands on the right character. LF, CRLF, and a lone
CR each end a line, the way both LSP and the front end count lines.

## Install

From the repository checkout:

```sh
cd js
npm install
npm run lsp
```

When the package is installed globally or linked, the binary name is:

```sh
rml-lsp
```

The server speaks only LSP over stdin/stdout. Do not run it directly in a
terminal unless an editor or test harness is managing the JSON-RPC stream.

## VS Code

A VS Code extension package lives in [`vscode/`](../vscode/). It contributes
the `lino` language, TextMate syntax highlighting for `.lino` files, comment
and bracket behavior, and starts the same `rml-lsp` server for diagnostics,
hover, go-to-definition, and completion.

Build an installable VSIX from the repository checkout:

```sh
cd vscode
npm install
npm run package
code --install-extension relative-meta-logic.vsix
```

The package step copies the JavaScript LSP sources from `../js/src` into the
extension's `server/` directory before creating the VSIX. In a checkout used
for extension development, the extension falls back to `../js/src/rml-lsp.mjs`
when the packaged copy has not been generated yet.

If you prefer a globally installed server, set `rml.server.command` to
`rml-lsp`. Additional server arguments can be provided with `rml.server.args`.

## Neovim

For Neovim's built-in LSP client, add this to your Lua config:

```lua
vim.filetype.add({
  extension = {
    lino = "lino",
  },
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = "lino",
  callback = function(args)
    vim.lsp.start({
      name = "rml-lsp",
      cmd = { "rml-lsp" },
      root_dir = vim.fs.root(args.buf, { "js/package.json", ".git" }) or vim.fn.getcwd(),
    })
  end,
})
```

If you are using the repository checkout without linking the package, replace
`cmd` with an absolute path:

```lua
cmd = { "node", "/path/to/relative-meta-logic/js/src/rml-lsp.mjs" }
```

## Helix

Add a language entry to `~/.config/helix/languages.toml`:

```toml
[[language]]
name = "lino"
scope = "source.lino"
file-types = ["lino"]
comment-token = "#"
language-servers = ["rml-lsp"]

[language-server.rml-lsp]
command = "rml-lsp"
```

For a repository checkout without a linked binary, use:

```toml
[language-server.rml-lsp]
command = "node"
args = ["/path/to/relative-meta-logic/js/src/rml-lsp.mjs"]
```

## Smoke Test

The protocol smoke test starts the server through stdio framing and verifies
initialize, diagnostics, hover, definition, completion, shutdown, and exit:

```sh
cd js
node --test tests/lsp.test.mjs
```

The VS Code extension smoke test verifies the language contributions and then
starts the extension-resolved LSP command over stdio:

```sh
cd vscode
npm test
```
