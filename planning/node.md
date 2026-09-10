# Node.js Compatibility

## Goal

Add a Node.js compatibility layer to ARC.js so that JavaScript packages designed for Node can run in the browser when their APIs and dependencies can be satisfied.

ARC is **not** trying to turn the browser into Node.js. The goal is to provide a practical compatibility/runtime layer between Node-oriented npm packages and browser APIs.

## Core idea

JavaScript is the language; Node.js is a runtime/environment that provides JavaScript with APIs that browsers do not normally provide.

Examples of Node APIs include:

- `fs` — filesystem access
- `path` — path manipulation
- `process` — process/environment information
- `buffer` — binary data
- `stream` — streams
- `events` — event emitter implementation
- `util` — Node utility functions
- `http` — Node HTTP APIs
- `crypto` — cryptographic APIs
- `child_process` — spawning OS processes
- `worker_threads` — Node worker threads
- `net` — low-level networking
- `cluster` — multi-process scaling

Normal browser JavaScript already supports the language itself. The compatibility work is therefore primarily about APIs, module resolution, and runtime behaviour rather than converting JavaScript syntax.

## ARC module resolution

ARC already has the concept of `importPackage()`. Node compatibility should integrate with that resolver instead of requiring a completely separate package system.

Conceptually:

```text
importPackage("lodash")
    -> npm/package resolver

importPackage("path")
    -> ARC Node compatibility layer
    -> components/node/path/

importPackage("fs")
    -> ARC Node compatibility layer
    -> components/node/fs/
```

The resolver should recognise both ordinary Node package names and the `node:` prefix where appropriate:

```js
import path from "path";
import path2 from "node:path";
```

Both should resolve to the ARC implementation of Node's `path` API.

## Planned directory structure

Use a dedicated Node compatibility directory:

```text
components/
├── npmloader.js
└── node/
    ├── fs/
    │   └── index.js
    ├── path/
    │   └── index.js
    ├── process/
    │   └── index.js
    ├── buffer/
    │   └── index.js
    ├── stream/
    │   └── index.js
    ├── events/
    │   └── index.js
    ├── util/
    │   └── index.js
    ├── http/
    │   └── index.js
    ├── crypto/
    │   └── index.js
    └── ...
```

Each Node API gets its own compatibility module. This keeps the implementations modular and lets ARC add support incrementally.

## CommonJS support

Node packages may use CommonJS as well as ESM.

ARC should eventually be able to transform/resolve patterns such as:

```js
const foo = require("foo");
```

to the equivalent ARC package resolution, conceptually:

```js
const foo = importPackage("foo");
```

Likewise:

```js
const { thing } = require("foo");
```

should resolve correctly.

ESM imports should also resolve:

```js
import foo from "foo";
```

The exact transformation mechanism is an implementation detail; the important requirement is that both common Node module styles can participate in ARC's package system.

## Existing libraries to investigate/use

ARC should avoid reinventing mature browser implementations where practical.

### `node-stdlib-browser`

Investigate this as a source of browser-compatible implementations of many Node standard-library modules. It can potentially provide implementations for APIs such as `path`, `buffer`, `events`, `stream`, `util`, and `process`.

### Browserify

Browserify is an important reference implementation. It has historically bundled Node-style CommonJS modules for browsers and supplied browser versions of various Node core modules.

ARC should study its compatibility approach, but ARC's runtime/package-loader architecture should remain independent rather than simply becoming Browserify.

### BrowserFS

Investigate BrowserFS for `fs`-style functionality. It provides a Node-like filesystem API in the browser using browser storage backends.

This could be useful for giving packages a virtual/browser filesystem rather than pretending the browser has unrestricted access to the user's real filesystem.

### `node-libs-browser`

Useful as historical/reference material for Node core browser shims, but it is deprecated and should not be treated as the primary modern dependency.

## Compatibility categories

Not every Node API can actually be reproduced in a normal browser. ARC should explicitly distinguish levels of compatibility.

### Full or near-full browser implementation

Examples:

- `path`
- `url`
- `events`
- `buffer`
- much of `util`

These are primarily JavaScript functionality and can generally be implemented in the browser.

### Browser-adapted / partial implementation

Examples:

- `fs`
- `process`
- `http`
- `crypto`
- `stream`
- `net`

These may have meaningful browser equivalents, but the semantics and available capabilities differ from Node. ARC should document the differences rather than claiming perfect Node compatibility.

### Fundamentally unavailable in a normal browser

Examples:

- `child_process` — cannot genuinely execute arbitrary OS shell commands from normal browser JavaScript.
- `cluster` — Node's process-based model has no direct normal-browser equivalent.

ARC should fail clearly for unsupported capabilities instead of providing a fake implementation that silently behaves incorrectly.

## Capability detection / diagnostics

ARC should eventually inspect a package's dependency graph and report its Node compatibility.

Example diagnostic:

```text
[ARC] Loading some-package
[ARC] ✓ lodash
[ARC] ✓ path -> ARC Node compatibility
[ARC] ⚠ fs -> browser/virtual filesystem implementation
[ARC] ✗ child_process -> unavailable in browser
```

This is preferable to discovering an incompatible Node API only after a runtime crash.

A future compatibility report could look like:

```text
Package: some-package

Dependencies:
  lodash          ✓
  path            ✓ ARC shim
  fs              ⚠ partial support
  child_process   ✗ unsupported
```

## Important distinction: transpilation vs compatibility

ARC should treat these as separate problems:

- **Transpilation:** change source syntax/code into another form.
- **Bundling:** resolve and package dependencies.
- **Polyfilling/shimming:** provide missing APIs.
- **Runtime compatibility:** make code designed for another runtime operate correctly in the browser where possible.

ARC's Node work is primarily the last three, with source transformation only where required for module compatibility.

## Example target

A Node-oriented package might contain:

```js
import path from "path";
import fs from "fs";
import lodash from "lodash";
```

ARC should conceptually resolve this as:

```text
path
  -> components/node/path/

fs
  -> components/node/fs/
  -> virtual/browser filesystem

lodash
  -> npm package resolver
```

The package should not need to know that it is running through ARC.

## Architecture

```text
                    Node-oriented package
                            |
                            v
                     ARC module resolver
                            |
              +-------------+-------------+
              |                           |
              v                           v
       npm/package source          Node compatibility
              |                           |
              v                 +---------+---------+
        importPackage()         |                   |
                                v                   v
                         ARC Node modules      Browser APIs
                                |
                                v
                         Browser runtime
```

The intended result is not a Node clone. It is an ARC compatibility environment that makes as many Node-targeted web packages as possible usable directly in the browser.

## Phased implementation

### Phase 1 — resolver

- Add recognition of Node built-ins.
- Support both `foo` and `node:foo` forms.
- Route recognised built-ins to `components/node/<api>/`.
- Integrate with `importPackage()`.

### Phase 2 — easy APIs

Implement/integrate high-value APIs such as:

- `path`
- `url`
- `events`
- `buffer`
- `util`
- `process`

Prefer established browser implementations where suitable.

### Phase 3 — browser-adapted APIs

Investigate:

- `fs` / BrowserFS or equivalent virtual filesystem
- `stream`
- `crypto`
- `http`
- other commonly encountered Node APIs

Document behavioural differences from real Node.js.

### Phase 4 — CommonJS compatibility

Improve support for:

- `require()`
- `module.exports`
- `exports.foo`
- mixed CommonJS/ESM packages

### Phase 5 — package compatibility analysis

Before executing a package, identify Node built-ins and classify them as:

- supported
- browser-adapted
- partial
- unsupported

Provide useful ARC diagnostics.

### Phase 6 — testing

Build a compatibility test suite using real npm packages with different dependency patterns. Test packages that use Node built-ins, CommonJS, ESM, nested dependencies, and mixed browser/Node targets.

## Design principle

The objective is:

> Give ARC a frontend package. It can have 43 dependencies and be written for Node-style tooling; ARC should resolve what it can, provide compatibility layers where possible, and clearly explain what is fundamentally impossible in a browser.

ARC should maximise compatibility without pretending browser security restrictions do not exist.
