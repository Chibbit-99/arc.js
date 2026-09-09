// ============================================================
// ARC Browser npm loader
// v6
//
// Browser:
//   npm registry
//      ↓
//   tar.gz
//      ↓
//   virtual filesystem
//      ↓
//   package.json resolution
//      ↓
//   browser mappings / exports
//      ↓
//   esbuild-WASM
//      ↓
//   injected <script type="module">
//      ↓
//   module namespace
//
// Usage:
//
//   const Tesseract = await importPackage("tesseract.js");
//   console.log(Tesseract);
//
// ============================================================

(() => {

    // ========================================================
    // ARC state
    // ========================================================

    const ARC = {

        ESBUILD_VERSION: "0.28.1",
        FFLATE_VERSION: "0.8.2",

        esbuild: null,
        fflate: null,
        initialized: null,

        packages: new Map(),
        packageLoading: new Map(),

        modules: new Map(),
        blobs: new Map(),

        installedPackages: new Map(),

        bridgeCounter: 0
    };

    // ========================================================
    // Logging
    // ========================================================

    function log(...args) {
        console.log("[ARC]", ...args);
    }

    function warn(...args) {
        console.warn("[ARC]", ...args);
    }

    // ========================================================
    // Constants
    // ========================================================

    const decoder =
        new TextDecoder();

    const FILE_EXTENSIONS = [
        ".js",
        ".mjs",
        ".cjs",
        ".json",
        ".ts",
        ".tsx",
        ".jsx"
    ];

    const NODE_BUILTINS = new Set([
        "assert",
        "assert/strict",
        "async_hooks",
        "buffer",
        "child_process",
        "cluster",
        "console",
        "constants",
        "crypto",
        "dgram",
        "diagnostics_channel",
        "dns",
        "dns/promises",
        "domain",
        "events",
        "fs",
        "fs/promises",
        "http",
        "http2",
        "https",
        "module",
        "net",
        "os",
        "path",
        "path/posix",
        "path/win32",
        "perf_hooks",
        "process",
        "punycode",
        "querystring",
        "readline",
        "readline/promises",
        "repl",
        "stream",
        "stream/consumers",
        "stream/promises",
        "stream/web",
        "string_decoder",
        "sys",
        "timers",
        "timers/promises",
        "tls",
        "trace_events",
        "tty",
        "url",
        "util",
        "util/types",
        "v8",
        "vm",
        "wasi",
        "worker_threads",
        "zlib"
    ]);

    // ========================================================
    // Basic utilities
    // ========================================================

    function decode(bytes) {
        return decoder.decode(bytes);
    }

    function normalizePath(path) {

        const parts =
            String(path).split("/");

        const output = [];

        for (const part of parts) {

            if (
                !part ||
                part === "."
            ) {
                continue;
            }

            if (part === "..") {

                if (output.length) {
                    output.pop();
                }

                continue;
            }

            output.push(part);
        }

        return "/" + output.join("/");
    }

    function withoutLeadingSlash(path) {

        return String(path)
            .replace(/^\/+/, "");
    }

    function withoutLeadingDotSlash(path) {

        return String(path)
            .replace(/^\.?\//, "");
    }

    function packageRoot(name) {

        return "/node_modules/" + name;
    }

    function dirname(path) {

        const normalized =
            normalizePath(path);

        const index =
            normalized.lastIndexOf("/");

        if (index <= 0) {
            return "/";
        }

        return normalized.slice(
            0,
            index
        );
    }

    function fileExtension(path) {

        const filename =
            path.split("/").pop() || "";

        const index =
            filename.lastIndexOf(".");

        if (index === -1) {
            return "";
        }

        return filename.slice(index);
    }

    // ========================================================
    // Source map comment stripping (Problem 2)
    //
    // ARC does not fetch/host ".map" files through esbuild's
    // resolver, and esbuild-wasm cannot read arbitrary files
    // off a real filesystem to satisfy a
    // "//# sourceMappingURL=foo.js.map" comment on its own in
    // the browser. Left alone, esbuild-wasm treats that as a
    // load failure ("not implemented on js
    // [missing-source-map]") and warns/fails the whole
    // compilation.
    //
    // Source maps are optional debugging metadata, not part of
    // a package's actual behavior, so a missing one should never
    // break execution. Rather than let esbuild-wasm attempt (and
    // fail) to resolve them, ARC strips the comment before
    // handing source to esbuild. This is forward-compatible:
    // if/when ARC adds real source-map hosting, this stripping
    // step can simply be removed or made conditional.
    // ========================================================

    const SOURCE_MAPPING_URL_RE =
        /^\s*\/\/[#@]\s*sourceMappingURL=.*$/gm;

    function stripSourceMappingComments(
        source,
        path
    ) {

        if (
            !source.includes(
                "sourceMappingURL"
            )
        ) {
            return source;
        }

        let count = 0;

        const stripped =
            source.replace(
                SOURCE_MAPPING_URL_RE,
                () => {
                    count++;
                    return "";
                }
            );

        if (count > 0) {

            log(
                `Ignoring optional source map` +
                `${count > 1 ? "s" : ""} in: ` +
                `${path}`
            );
        }

        return stripped;
    }

    // ========================================================
    // Package specifier parser
    // ========================================================

    function parseSpecifier(specifier) {

        if (
            typeof specifier !== "string" ||
            !specifier.trim()
        ) {
            throw new Error(
                "Invalid npm package specifier"
            );
        }

        specifier =
            specifier.trim();

        // --------------------------------------------
        // Scoped package
        // --------------------------------------------

        if (specifier.startsWith("@")) {

            const slash =
                specifier.indexOf("/");

            if (slash === -1) {

                throw new Error(
                    `Invalid scoped package "${specifier}"`
                );
            }

            const secondSlash =
                specifier.indexOf(
                    "/",
                    slash + 1
                );

            const packageEnd =
                secondSlash === -1
                    ? specifier.length
                    : secondSlash;

            const packagePart =
                specifier.slice(
                    0,
                    packageEnd
                );

            const remainder =
                specifier.slice(
                    packageEnd
                );

            const at =
                packagePart.indexOf(
                    "@",
                    1
                );

            if (at !== -1) {

                return {

                    name:
                        packagePart.slice(
                            0,
                            at
                        ),

                    version:
                        packagePart.slice(
                            at + 1
                        ),

                    subpath:
                        remainder
                            ? remainder.slice(1)
                            : "."
                };
            }

            return {

                name:
                    packagePart,

                version:
                    null,

                subpath:
                    remainder
                        ? remainder.slice(1)
                        : "."
            };
        }

        // --------------------------------------------
        // Normal package
        // --------------------------------------------

        const slash =
            specifier.indexOf("/");

        const packagePart =
            slash === -1
                ? specifier
                : specifier.slice(
                    0,
                    slash
                );

        const subpath =
            slash === -1
                ? "."
                : specifier.slice(
                    slash + 1
                ) || ".";

        const at =
            packagePart.lastIndexOf("@");

        if (at > 0) {

            return {

                name:
                    packagePart.slice(
                        0,
                        at
                    ),

                version:
                    packagePart.slice(
                        at + 1
                    ),

                subpath
            };
        }

        return {
            name: packagePart,
            version: null,
            subpath
        };
    }

    // ========================================================
    // Semver
    // ========================================================

    function parseVersion(version) {

        if (!version) {
            return null;
        }

        const match =
            String(version)
                .trim()
                .replace(/^v/, "")
                .match(
                    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/
                );

        if (!match) {
            return null;
        }

        return {

            major:
                Number(match[1]),

            minor:
                Number(match[2] || 0),

            patch:
                Number(match[3] || 0)
        };
    }

    function compareVersions(a, b) {

        const A =
            parseVersion(a);

        const B =
            parseVersion(b);

        if (!A || !B) {
            return 0;
        }

        if (A.major !== B.major) {
            return A.major - B.major;
        }

        if (A.minor !== B.minor) {
            return A.minor - B.minor;
        }

        return A.patch - B.patch;
    }

    function satisfies(version, range) {

        if (
            !range ||
            range === "*" ||
            range === "latest"
        ) {
            return true;
        }

        range =
            String(range).trim();

        // OR
        if (range.includes("||")) {

            return range
                .split("||")
                .some(part =>
                    satisfies(
                        version,
                        part.trim()
                    )
                );
        }

        // Multiple comparators
        if (range.includes(" ")) {

            const parts =
                range
                    .split(/\s+/)
                    .filter(Boolean);

            if (parts.length > 1) {

                return parts.every(
                    part =>
                        satisfies(
                            version,
                            part
                        )
                );
            }
        }

        const actual =
            parseVersion(version);

        if (!actual) {
            return false;
        }

        // >= <= > <
        const comparator =
            range.match(
                /^(>=|<=|>|<|=)\s*(.+)$/
            );

        if (comparator) {

            const comparison =
                compareVersions(
                    version,
                    comparator[2]
                );

            switch (comparator[1]) {

                case ">=":
                    return comparison >= 0;

                case "<=":
                    return comparison <= 0;

                case ">":
                    return comparison > 0;

                case "<":
                    return comparison < 0;

                case "=":
                    return comparison === 0;
            }
        }

        // ^
        if (
            range.startsWith("^")
        ) {

            const base =
                parseVersion(
                    range.slice(1)
                );

            if (!base) {
                return false;
            }

            if (base.major > 0) {

                return (
                    actual.major ===
                        base.major &&
                    compareVersions(
                        version,
                        range.slice(1)
                    ) >= 0
                );
            }

            if (base.minor > 0) {

                return (
                    actual.major === 0 &&
                    actual.minor ===
                        base.minor &&
                    compareVersions(
                        version,
                        range.slice(1)
                    ) >= 0
                );
            }

            return (
                actual.major === 0 &&
                actual.minor === 0 &&
                actual.patch ===
                    base.patch
            );
        }

        // ~
        if (
            range.startsWith("~")
        ) {

            const base =
                parseVersion(
                    range.slice(1)
                );

            if (!base) {
                return false;
            }

            return (
                actual.major === base.major &&
                actual.minor === base.minor &&
                compareVersions(
                    version,
                    range.slice(1)
                ) >= 0
            );
        }

        // wildcard
        if (
            range.includes("x") ||
            range.includes("X") ||
            range.includes("*")
        ) {

            const parts =
                range.split(".");

            if (
                parts[0] !== "x" &&
                parts[0] !== "X" &&
                parts[0] !== "*"
            ) {

                if (
                    actual.major !==
                    Number(parts[0])
                ) {
                    return false;
                }
            }

            if (
                parts[1] &&
                parts[1] !== "x" &&
                parts[1] !== "X" &&
                parts[1] !== "*"
            ) {

                if (
                    actual.minor !==
                    Number(parts[1])
                ) {
                    return false;
                }
            }

            if (
                parts[2] &&
                parts[2] !== "x" &&
                parts[2] !== "X" &&
                parts[2] !== "*"
            ) {

                if (
                    actual.patch !==
                    Number(parts[2])
                ) {
                    return false;
                }
            }

            return true;
        }

        // 1
        if (
            /^\d+$/.test(range)
        ) {

            return (
                actual.major ===
                Number(range)
            );
        }

        // 1.2
        if (
            /^\d+\.\d+$/.test(range)
        ) {

            const parts =
                range
                    .split(".")
                    .map(Number);

            return (
                actual.major === parts[0] &&
                actual.minor === parts[1]
            );
        }

        // exact
        if (
            /^\d+\.\d+\.\d+$/.test(range)
        ) {

            const base =
                parseVersion(range);

            return (
                actual.major ===
                    base.major &&
                actual.minor ===
                    base.minor &&
                actual.patch ===
                    base.patch
            );
        }

        return false;
    }

    function chooseVersion(
        metadata,
        range
    ) {

        const versions =
            Object.keys(
                metadata.versions || {}
            )
                .filter(
                    version =>
                        parseVersion(version)
                )
                .filter(
                    version =>
                        satisfies(
                            version,
                            range
                        )
                )
                .sort(
                    compareVersions
                );

        if (!versions.length) {

            throw new Error(
                `No published version of ` +
                `${metadata.name} satisfies "${range}"`
            );
        }

        return versions[
            versions.length - 1
        ];
    }

    // ========================================================
    // npm registry
    // ========================================================

    async function fetchMetadata(name) {

        const response =
            await fetch(
                "https://registry.npmjs.org/" +
                encodeURIComponent(name)
            );

        if (!response.ok) {

            throw new Error(
                `npm metadata failed for ` +
                `${name}: HTTP ${response.status}`
            );
        }

        return response.json();
    }

    // ========================================================
    // TAR parser
    // ========================================================

    function tarString(
        bytes,
        start,
        length
    ) {

        return decode(
            bytes.slice(
                start,
                start + length
            )
        )
            .replace(/\0/g, "")
            .trim();
    }

    function tarOctal(
        bytes,
        start,
        length
    ) {

        const raw =
            tarString(
                bytes,
                start,
                length
            );

        const cleaned =
            raw.replace(
                /[^\d]/g,
                ""
            );

        return cleaned
            ? parseInt(cleaned, 8)
            : 0;
    }

    function extractTarGz(
        buffer
    ) {

        const compressed =
            new Uint8Array(buffer);

        const tar =
            ARC.fflate.gunzipSync(
                compressed
            );

        const files =
            new Map();

        let offset = 0;

        while (
            offset + 512 <=
            tar.length
        ) {

            const header =
                tar.slice(
                    offset,
                    offset + 512
                );

            let empty = true;

            for (
                let i = 0;
                i < 512;
                i++
            ) {

                if (header[i] !== 0) {
                    empty = false;
                    break;
                }
            }

            if (empty) {
                break;
            }

            const name =
                tarString(
                    header,
                    0,
                    100
                );

            const size =
                tarOctal(
                    header,
                    124,
                    12
                );

            const type =
                header[156];

            offset += 512;

            if (
                type === 0 ||
                type === 48
            ) {

                const data =
                    tar.slice(
                        offset,
                        offset + size
                    );

                let clean =
                    name.replace(
                        /^package\//,
                        ""
                    );

                clean =
                    clean.replace(
                        /^\/+/,
                        ""
                    );

                if (clean) {

                    files.set(
                        "/" + clean,
                        data
                    );
                }
            }

            offset +=
                Math.ceil(
                    size / 512
                ) * 512;
        }

        return files;
    }

    // ========================================================
    // Load npm package
    // ========================================================

    async function loadPackage(
        name,
        range = null
    ) {

        const requestKey =
            `${name}@${range || "latest"}`;

        if (
            ARC.packages.has(
                requestKey
            )
        ) {

            return ARC.packages.get(
                requestKey
            );
        }

        if (
            ARC.packageLoading.has(
                requestKey
            )
        ) {

            return ARC.packageLoading.get(
                requestKey
            );
        }

        const promise =
            (async () => {

                log(
                    `Fetching package metadata: ${name}`
                );

                const metadata =
                    await fetchMetadata(
                        name
                    );

                let version;

                if (
                    range &&
                    metadata.versions &&
                    metadata.versions[range]
                ) {

                    version =
                        range;

                } else if (range) {

                    version =
                        chooseVersion(
                            metadata,
                            range
                        );

                } else {

                    version =
                        metadata[
                            "dist-tags"
                        ]?.latest;
                }

                if (!version) {

                    throw new Error(
                        `Could not resolve ` +
                        `${name}@${range || "latest"}`
                    );
                }

                const packageJSON =
                    metadata.versions[
                        version
                    ];

                if (!packageJSON) {

                    throw new Error(
                        `npm has no ` +
                        `${name}@${version}`
                    );
                }

                const tarball =
                    packageJSON.dist?.tarball;

                if (!tarball) {

                    throw new Error(
                        `${name}@${version} ` +
                        `has no tarball`
                    );
                }

                log(
                    `Resolved ${name}@${version}`
                );

                log(
                    `Downloading ${name}@${version}...`
                );

                const response =
                    await fetch(
                        tarball
                    );

                if (!response.ok) {

                    throw new Error(
                        `Failed downloading ` +
                        `${name}@${version}: ` +
                        `HTTP ${response.status}`
                    );
                }

                const buffer =
                    await response.arrayBuffer();

                log(
                    `Downloaded ` +
                    `${(
                        buffer.byteLength /
                        1024 /
                        1024
                    ).toFixed(2)} MB`
                );

                log(
                    `Decompressing ` +
                    `${name}@${version}...`
                );

                const files =
                    extractTarGz(
                        buffer
                    );

                log(
                    `Extracted ${files.size} files`
                );

                const packageFile =
                    files.get(
                        "/package.json"
                    );

                if (!packageFile) {

                    throw new Error(
                        `${name}@${version} has no package.json`
                    );
                }

                const pkg =
                    JSON.parse(
                        decode(packageFile)
                    );

                const result = {

                    name,
                    version,

                    package:
                        pkg,

                    files
                };

                ARC.packages.set(
                    requestKey,
                    result
                );

                ARC.packages.set(
                    `${name}@${version}`,
                    result
                );

                return result;

            })();

        ARC.packageLoading.set(
            requestKey,
            promise
        );

        try {

            return await promise;

        } finally {

            ARC.packageLoading.delete(
                requestKey
            );
        }
    }

    // ========================================================
    // Find loaded package
    // ========================================================

    function findPackage(
        name
    ) {

        const direct =
            ARC.installedPackages.get(
                name
            );

        if (direct) {
            return direct;
        }

        for (
            const pkg
            of ARC.packages.values()
        ) {

            if (
                pkg.name === name
            ) {
                return pkg;
            }
        }

        return null;
    }

    // ========================================================
    // Package name from VFS path
    // ========================================================

    function packageNameFromPath(
        path
    ) {

        const prefix =
            "/node_modules/";

        if (
            !path.startsWith(prefix)
        ) {
            return null;
        }

        const rest =
            path.slice(
                prefix.length
            );

        if (
            rest.startsWith("@")
        ) {

            const firstSlash =
                rest.indexOf("/");

            if (firstSlash === -1) {
                return null;
            }

            const secondSlash =
                rest.indexOf(
                    "/",
                    firstSlash + 1
                );

            if (secondSlash === -1) {
                return rest;
            }

            return rest.slice(
                0,
                secondSlash
            );
        }

        const slash =
            rest.indexOf("/");

        if (slash === -1) {
            return rest;
        }

        return rest.slice(
            0,
            slash
        );
    }

    // ========================================================
    // File resolution
    // ========================================================

    function resolveFile(
        files,
        path
    ) {

        path =
            normalizePath(
                path
            );

        // Exact file
        if (
            files.has(path)
        ) {
            return path;
        }

        // Extensions
        for (
            const ext
            of FILE_EXTENSIONS
        ) {

            const candidate =
                path + ext;

            if (
                files.has(candidate)
            ) {
                return candidate;
            }
        }

        // Directory index
        const indexes = [
            "/index.js",
            "/index.mjs",
            "/index.cjs",
            "/index.json",
            "/index.ts",
            "/index.tsx",
            "/index.jsx"
        ];

        for (
            const suffix
            of indexes
        ) {

            const candidate =
                path + suffix;

            if (
                files.has(candidate)
            ) {
                return candidate;
            }
        }

        return null;
    }

    // ========================================================
    // browser field
    //
    // IMPORTANT:
    // Returns PACKAGE-RELATIVE paths only.
    //
    // Example:
    //
    //   /src/worker/node/index.js
    //
    // becomes:
    //
    //   /src/worker/browser/index.js
    //
    // It NEVER returns /node_modules/foo/...
    // ========================================================

    function applyBrowserMap(
        pkg,
        packageRelativePath
    ) {

        const browser =
            pkg.browser;

        if (!browser) {
            return packageRelativePath;
        }

        // String browser entry.
        //
        // Only used by package entry resolution.
        if (
            typeof browser === "string"
        ) {
            return packageRelativePath;
        }

        if (
            typeof browser !== "object"
        ) {
            return packageRelativePath;
        }

        const relative =
            "/" +
            withoutLeadingSlash(
                normalizePath(
                    packageRelativePath
                )
            );

        const clean =
            withoutLeadingSlash(
                relative
            );

        const keys = [
            "./" + clean,
            clean,
            relative
        ];

        for (
            const key
            of keys
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    browser,
                    key
                )
            ) {

                const replacement =
                    browser[key];

                if (
                    replacement === false
                ) {
                    return false;
                }

                // Always convert replacement to
                // package-relative format.

                let result =
                    String(
                        replacement
                    ).replace(
                        /^\.?\//,
                        ""
                    );

                result =
                    normalizePath(
                        "/" + result
                    );

                // SAFETY:
                //
                // A browser map replacement should
                // stay inside this package.

                if (
                    result.includes(
                        "/../"
                    )
                ) {

                    throw new Error(
                        `Invalid browser replacement: ` +
                        `${replacement}`
                    );
                }

                return result;
            }
        }

        return relative;
    }

    // ========================================================
    // Conditional exports
    // ========================================================

    function resolveConditional(
        value
    ) {

        if (
            typeof value === "string"
        ) {
            return value;
        }

        if (
            value === false
        ) {
            return false;
        }

        if (
            !value ||
            typeof value !== "object"
        ) {
            return null;
        }

        // -----------------------------------------------------
        // ARC is a browser + ESM runtime, so conditions are
        // preferred in this order:
        //
        //   browser -> import -> module -> default -> require
        //
        // "default" is the spec-sanctioned universal fallback
        // and is intentionally preferred over "require": a
        // "require" branch points at a CommonJS-shaped file,
        // which is a worse fit for us than an untagged
        // "default" branch that is very often the ESM/neutral
        // build (this is exactly the shape package.json uses:
        // { "require": {...}, "default": "./index.mjs" }).
        // "require" is kept as an actual last resort rather
        // than removed, since some packages only ship a
        // "require" condition with no "default" at all - ARC's
        // CJS interop (see wrapCommonJS) makes that survivable.
        // -----------------------------------------------------

        const conditions = [
            "browser",
            "import",
            "module",
            "default",
            "require"
        ];

        for (
            const condition
            of conditions
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    value,
                    condition
                )
            ) {

                const result =
                    resolveConditional(
                        value[condition]
                    );

                if (
                    result !== null
                ) {

                    log(
                        `Conditional exports: ` +
                        `selected "${condition}" -> ` +
                        `${typeof result === "string"
                            ? result
                            : JSON.stringify(result)}`
                    );

                    return result;
                }
            }
        }

        return null;
    }

    // ========================================================
    // exports resolver
    // ========================================================

    function resolveExports(
        pkg,
        subpath
    ) {

        if (!pkg.exports) {
            return null;
        }

        const exports =
            pkg.exports;

        // exports: "./index.js"
        if (
            typeof exports === "string"
        ) {

            return subpath === "."
                ? exports
                : null;
        }

        // Exact subpath
        if (
            Object.prototype.hasOwnProperty.call(
                exports,
                subpath
            )
        ) {

            return resolveConditional(
                exports[subpath]
            );
        }

        // Wildcard
        for (
            const [
                key,
                value
            ]
            of Object.entries(
                exports
            )
        ) {

            if (
                !key.includes("*")
            ) {
                continue;
            }

            const pieces =
                key.split("*");

            const prefix =
                pieces[0];

            const suffix =
                pieces[1];

            if (
                !subpath.startsWith(
                    prefix
                )
            ) {
                continue;
            }

            if (
                !subpath.endsWith(
                    suffix
                )
            ) {
                continue;
            }

            const middle =
                subpath.slice(
                    prefix.length,
                    subpath.length -
                    suffix.length
                );

            const target =
                resolveConditional(
                    value
                );

            if (
                typeof target === "string"
            ) {

                return target.replaceAll(
                    "*",
                    middle
                );
            }
        }

        // Conditional root export
        if (
            subpath === "."
        ) {

            return resolveConditional(
                exports
            );
        }

        return null;
    }

    // ========================================================
    // Resolve package entry
    // ========================================================

    function resolvePackageEntry(
        pkgResult,
        subpath = "."
    ) {

        const pkg =
            pkgResult.package;

        const files =
            pkgResult.files;

        log(
            `Resolving package entry: ` +
            `${pkgResult.name} ` +
            `(subpath "${subpath}")`
        );

        if (pkg.exports) {

            log(
                "Package exports field detected"
            );
        }

        let requested;

        // -----------------------------------------------------
        // exports
        // -----------------------------------------------------

        requested =
            resolveExports(
                pkg,
                subpath
            );

        // -----------------------------------------------------
        // direct subpath
        // -----------------------------------------------------

        if (
            !requested &&
            subpath !== "."
        ) {

            requested =
                "./" +
                withoutLeadingSlash(
                    subpath
                );
        }

        // -----------------------------------------------------
        // browser main
        // -----------------------------------------------------

        if (
            !requested &&
            typeof pkg.browser === "string" &&
            subpath === "."
        ) {

            requested =
                pkg.browser;
        }

        // -----------------------------------------------------
        // normal main
        // -----------------------------------------------------

        if (!requested) {

            requested =
                pkg.module ||
                pkg.main ||
                "index.js";
        }

        requested =
            withoutLeadingDotSlash(
                requested
            );

        log(
            `Selected browser/import entry: ` +
            `${requested}`
        );

        // -----------------------------------------------------
        // First resolve the real file.
        // -----------------------------------------------------

        let resolved =
            resolveFile(
                files,
                "/" + requested
            );

        if (!resolved) {

            throw new Error(
                `Cannot resolve package entry ` +
                `"${requested}" ` +
                `for ${pkgResult.name}`
            );
        }

        // -----------------------------------------------------
        // Browser map AFTER directory resolution.
        // -----------------------------------------------------

        const mapped =
            applyBrowserMap(
                pkg,
                resolved
            );

        if (
            mapped === false
        ) {

            return {
                empty: true
            };
        }

        if (
            mapped !== resolved
        ) {

            const browserFile =
                resolveFile(
                    files,
                    mapped
                );

            if (!browserFile) {

                throw new Error(
                    `Browser mapping ` +
                    `"${resolved}" → "${mapped}" ` +
                    `does not exist in ` +
                    `${pkgResult.name}`
                );
            }

            log(
                `browser: ` +
                `${resolved} → ${browserFile}`
            );

            resolved =
                browserFile;
        }

        return {
            path: resolved
        };
    }

    // ========================================================
    // Add package into VFS
    // ========================================================

    function addPackageToVFS(
        vfs,
        pkgResult
    ) {

        const root =
            packageRoot(
                pkgResult.name
            );

        for (
            const [
                path,
                bytes
            ]
            of pkgResult.files
        ) {

            vfs.set(
                root + path,
                bytes
            );
        }

        ARC.installedPackages.set(
            pkgResult.name,
            pkgResult
        );
    }

    // ========================================================
    // Dependency tree
    // ========================================================

    async function installDependencyTree(
        vfs,
        pkgResult,
        visited
    ) {

        const key =
            `${pkgResult.name}@${pkgResult.version}`;

        if (
            visited.has(key)
        ) {
            return;
        }

        visited.add(key);

        addPackageToVFS(
            vfs,
            pkgResult
        );

        const dependencies = {
            ...(pkgResult.package.dependencies || {}),
            ...(pkgResult.package.optionalDependencies || {})
        };

        for (
            const [
                dependencyName,
                dependencyRange
            ]
            of Object.entries(
                dependencies
            )
        ) {

            if (
                NODE_BUILTINS.has(
                    dependencyName
                )
            ) {
                continue;
            }

            // Unsupported protocols
            if (
                dependencyRange.startsWith("http:") ||
                dependencyRange.startsWith("https:") ||
                dependencyRange.startsWith("git:") ||
                dependencyRange.startsWith("git+") ||
                dependencyRange.startsWith("file:")
            ) {

                warn(
                    `Skipping unsupported dependency ` +
                    `${dependencyName}@${dependencyRange}`
                );

                continue;
            }

            try {

                log(
                    `Resolving dependency ` +
                    `${dependencyName}@${dependencyRange}`
                );

                const dependency =
                    await loadPackage(
                        dependencyName,
                        dependencyRange
                    );

                await installDependencyTree(
                    vfs,
                    dependency,
                    visited
                );

            } catch (err) {

                const optional =
                    pkgResult.package
                        .optionalDependencies &&
                    Object.prototype.hasOwnProperty.call(
                        pkgResult.package
                            .optionalDependencies,
                        dependencyName
                    );

                if (optional) {

                    warn(
                        `Optional dependency ` +
                        `${dependencyName} unavailable`
                    );

                    continue;
                }

                throw err;
            }
        }
    }

    // ========================================================
    // Browser tools
    // ========================================================

    async function initTools() {

        if (
            ARC.initialized
        ) {
            return ARC.initialized;
        }

        ARC.initialized =
            (async () => {

                log(
                    "Loading esbuild-WASM..."
                );

                ARC.esbuild =
                    await import(
                        "https://unpkg.com/" +
                        "esbuild-wasm@" +
                        ARC.ESBUILD_VERSION +
                        "/esm/browser.js"
                    );

                await ARC.esbuild.initialize({
                    wasmURL:
                        "https://unpkg.com/" +
                        "esbuild-wasm@" +
                        ARC.ESBUILD_VERSION +
                        "/esbuild.wasm"
                });

                log(
                    `esbuild-WASM ` +
                    `${ARC.esbuild.version} ready`
                );

                log(
                    "Loading fflate..."
                );

                ARC.fflate =
                    await import(
                        "https://unpkg.com/" +
                        "fflate@" +
                        ARC.FFLATE_VERSION +
                        "/esm/browser.js"
                    );

                log(
                    "fflate ready"
                );
            })();

        return ARC.initialized;
    }

    // ========================================================
    // Compile package
    // ========================================================

    async function compilePackage(
        name,
        version,
        subpath
    ) {

        await initTools();

        const rootPackage =
            await loadPackage(
                name,
                version
            );

        log(
            `Package: ${name}`
        );

        log(
            `Version: ${rootPackage.version}`
        );

        const entry =
            resolvePackageEntry(
                rootPackage,
                subpath
            );

        if (
            entry.empty
        ) {

            return {

                code:
                    "export default {};",

                packageResult:
                    rootPackage
            };
        }

        log(
            `Entry: ${entry.path}`
        );

        {
            const entryExt =
                fileExtension(
                    entry.path
                ).toLowerCase();

            const guessedFormat =
                entryExt === ".mjs"
                    ? "ESM (.mjs)"
                    : entryExt === ".cjs"
                        ? "CommonJS (.cjs)"
                        : "JS (format decided by " +
                          "esbuild during compilation)";

            log(
                `Entry file extension suggests: ` +
                `${guessedFormat}`
            );
        }

        // -----------------------------------------------------
        // Build VFS
        // -----------------------------------------------------

        const vfs =
            new Map();

        const visited =
            new Set();

        await installDependencyTree(
            vfs,
            rootPackage,
            visited
        );

        log(
            `Virtual filesystem: ` +
            `${vfs.size} files`
        );

        // -----------------------------------------------------
        // Package from importer
        // -----------------------------------------------------

        function packageFromImporter(
            importer
        ) {

            const name =
                packageNameFromPath(
                    importer
                );

            if (!name) {
                return null;
            }

            return findPackage(
                name
            );
        }

        // -----------------------------------------------------
        // Relative import resolver
        // -----------------------------------------------------

        function resolveRelative(
            specifier,
            importer
        ) {

            const currentPackage =
                packageFromImporter(
                    importer
                );

            if (!currentPackage) {

                throw new Error(
                    `Cannot determine package for ` +
                    `${importer}`
                );
            }

            const root =
                packageRoot(
                    currentPackage.name
                );

            // -------------------------------------------------
            // 1. Resolve the raw import first.
            //
            // ./worker/node
            // ->
            // /worker/node/index.js
            // -------------------------------------------------

            const rawPackagePath =
                normalizePath(
                    dirname(
                        importer
                    ).slice(
                        root.length
                    ) +
                    "/" +
                    specifier
                );

            const resolvedRelative =
                resolveFile(
                    currentPackage.files,
                    rawPackagePath
                );

            if (!resolvedRelative) {

                throw new Error(
                    `Cannot resolve ` +
                    `"${specifier}" from ` +
                    `${importer}`
                );
            }

            // -------------------------------------------------
            // 2. Browser mapping receives ONLY the
            //    package-relative path.
            // -------------------------------------------------

            const mapped =
                applyBrowserMap(
                    currentPackage.package,
                    resolvedRelative
                );

            if (
                mapped === false
            ) {

                return {

                    path:
                        "empty-" +
                        Math.random(),

                    namespace:
                        "arc-empty"
                };
            }

            // -------------------------------------------------
            // 3. Resolve mapped package-relative path.
            // -------------------------------------------------

            const finalRelative =
                resolveFile(
                    currentPackage.files,
                    mapped
                );

            if (!finalRelative) {

                throw new Error(
                    `Browser replacement ` +
                    `"${mapped}" does not exist in ` +
                    `${currentPackage.name}`
                );
            }

            if (
                finalRelative !==
                resolvedRelative
            ) {

                log(
                    `browser: ` +
                    `${resolvedRelative} → ` +
                    `${finalRelative}`
                );
            }

            // -------------------------------------------------
            // 4. Add package root exactly ONCE.
            // -------------------------------------------------

            const finalPath =
                root +
                finalRelative;

            return {

                path:
                    finalPath,

                namespace:
                    "arc"
            };
        }

        // -----------------------------------------------------
        // Bare package resolver
        // -----------------------------------------------------

        async function resolveBare(
            specifier,
            importer
        ) {

            if (
                NODE_BUILTINS.has(
                    specifier
                ) ||
                specifier.startsWith(
                    "node:"
                )
            ) {

                throw new Error(
                    `Node builtin "${specifier}" ` +
                    `was reached from ${importer}. ` +
                    `The browser resolver selected ` +
                    `Node-only code.`
                );
            }

            const parsed =
                parseSpecifier(
                    specifier
                );

            const owner =
                packageFromImporter(
                    importer
                );

            if (!owner) {

                throw new Error(
                    `Cannot determine importing ` +
                    `package for "${specifier}"`
                );
            }

            const declared = {
                ...(owner.package.dependencies || {}),
                ...(owner.package.optionalDependencies || {}),
                ...(owner.package.peerDependencies || {})
            };

            const requestedRange =
                parsed.version ||
                declared[
                    parsed.name
                ];

            if (!requestedRange) {

                throw new Error(
                    `${owner.name}@${owner.version} ` +
                    `imports "${specifier}" but does not ` +
                    `declare "${parsed.name}" as a dependency`
                );
            }

            const dependency =
                await loadPackage(
                    parsed.name,
                    requestedRange
                );

            // Ensure the dependency is in VFS.
            addPackageToVFS(
                vfs,
                dependency
            );

            const dependencyEntry =
                resolvePackageEntry(
                    dependency,
                    parsed.subpath
                );

            if (
                dependencyEntry.empty
            ) {

                return {

                    path:
                        "empty-" +
                        Math.random(),

                    namespace:
                        "arc-empty"
                };
            }

            const finalPath =
                packageRoot(
                    dependency.name
                ) +
                dependencyEntry.path;

            return {

                path:
                    finalPath,

                namespace:
                    "arc"
            };
        }

        // -----------------------------------------------------
        // esbuild plugin
        // -----------------------------------------------------

        const plugin = {

            name:
                "arc-npm",

            setup(build) {

                // ---------------------------------------------
                // Relative imports
                // ---------------------------------------------

                build.onResolve(
                    {
                        filter:
                            /^\.{1,2}\//
                    },

                    async args => {

                        return resolveRelative(
                            args.path,
                            args.importer
                        );
                    }
                );

                // ---------------------------------------------
                // Bare imports
                // ---------------------------------------------

                build.onResolve(
                    {
                        filter:
                            /^[^./][^?]*$/
                    },

                    async args => {

                        return resolveBare(
                            args.path,
                            args.importer
                        );
                    }
                );

                // ---------------------------------------------
                // Virtual files
                // ---------------------------------------------

                build.onLoad(
                    {
                        filter: /.*/,
                        namespace:
                            "arc"
                    },

                    async args => {

                        const bytes =
                            vfs.get(
                                args.path
                            );

                        if (!bytes) {

                            throw new Error(
                                `ARC VFS missing ` +
                                `${args.path}`
                            );
                        }

                        const ext =
                            fileExtension(
                                args.path
                            ).toLowerCase();

                        let loader =
                            "js";

                        switch (ext) {

                            case ".json":
                                loader = "json";
                                break;

                            case ".ts":
                                loader = "ts";
                                break;

                            case ".tsx":
                                loader = "tsx";
                                break;

                            case ".jsx":
                                loader = "jsx";
                                break;

                            default:
                                loader = "js";
                        }

                        let contents =
                            decode(bytes);

                        // JSON has no source-map comments and
                        // must remain valid JSON - only strip
                        // for JS-family loaders.
                        if (loader !== "json") {

                            contents =
                                stripSourceMappingComments(
                                    contents,
                                    args.path
                                );
                        }

                        return {

                            contents,

                            loader,

                            resolveDir:
                                dirname(
                                    args.path
                                )
                        };
                    }
                );

                // ---------------------------------------------
                // Empty modules
                // ---------------------------------------------

                build.onLoad(
                    {
                        filter: /.*/,
                        namespace:
                            "arc-empty"
                    },

                    async () => {

                        return {

                            contents:
                                `
                                const empty = {};
                                export default empty;
                                export { empty };
                                `,

                            loader:
                                "js"
                        };
                    }
                );
            }
        };

        // -----------------------------------------------------
        // Entry source
        // -----------------------------------------------------

        const fullEntryPath =
            packageRoot(name) +
            entry.path;

        const entryBytes =
            vfs.get(
                fullEntryPath
            );

        if (!entryBytes) {

            throw new Error(
                `Entry source missing from VFS: ` +
                `${fullEntryPath}`
            );
        }

        const entrySource =
            decode(entryBytes);

        // -----------------------------------------------------
        // esbuild
        // -----------------------------------------------------

        log(
            "Compiling with esbuild-WASM..."
        );

        const result =
            await ARC.esbuild.build({

                stdin: {

                    contents:
                        entrySource,

                    sourcefile:
                        fullEntryPath,

                    resolveDir:
                        dirname(
                            fullEntryPath
                        ),

                    loader:
                        "js"
                },

                bundle:
                    true,

                platform:
                    "browser",

                format:
                    "esm",

                target:
                    "es2020",

                write:
                    false,

                // Source-map generation from ARC's own bundling
                // step is intentionally left off. This is
                // distinct from the input-side stripping in
                // stripSourceMappingComments() above: that
                // stops esbuild-wasm from trying (and failing)
                // to resolve *existing* ".map" files referenced
                // by package source; this setting just stops
                // esbuild from generating a new inline map for
                // the bundle it produces, which is unrelated
                // work ARC doesn't currently consume. Safe to
                // turn back on later without touching anything
                // else.
                sourcemap:
                    false,

                logLevel:
                    "warning",

                plugins: [
                    plugin
                ]
            });

        if (
            !result.outputFiles ||
            !result.outputFiles.length
        ) {

            throw new Error(
                "esbuild returned no output"
            );
        }

        const code =
            result
                .outputFiles[0]
                .text;

        log(
            `Compiled bundle: ` +
            `${(
                code.length /
                1024
            ).toFixed(1)} KB`
        );

        return {

            code,

            packageResult:
                rootPackage
        };
    }

    // ========================================================
    // Inject module
    // ========================================================

    async function injectModule(
        code,
        packageName,
        version
    ) {

        const id =
            ++ARC.bridgeCounter;

        const resultKey =
            "__ARC_MODULE_" +
            id;

        // ----------------------------------------------------
        // Compiled bundle blob
        // ----------------------------------------------------

        const packageBlob =
            new Blob(
                [code],
                {
                    type:
                        "text/javascript"
                }
            );

        const packageURL =
            URL.createObjectURL(
                packageBlob
            );

        // ----------------------------------------------------
        // Bridge module
        //
        // CommonJS interop (Problem 1 fix, part 2)
        // -----------------------------------------
        // esbuild's own CJS->ESM interop is purely static: it
        // can only turn `module.exports.foo = ...` /
        // `exports.foo = ...` assignments into real named
        // exports when it can prove, at bundle time, that
        // `module.exports` was never *reassigned* wholesale.
        //
        // Many real npm packages (including @anthropic-ai/sdk's
        // CJS build) do exactly that:
        //
        //   exports = module.exports = function (...) {...}
        //   Object.defineProperty(exports, "Anthropic", {...})
        //
        // Once `module.exports` is reassigned to a new function,
        // esbuild can no longer statically prove which
        // properties end up on it, so it falls back to exposing
        // the whole thing as a single `default` export - which
        // is exactly the "everything becomes default" bug.
        //
        // Rather than trying to statically rewrite arbitrary CJS
        // source (fragile - regressions on real-world code are
        // very easy), ARC fixes this at the *runtime* boundary:
        // once the real module has actually executed, we look at
        // its `default` export and, if it is an object or
        // function that itself carries additional own-enumerable
        // properties (the CJS "hybrid export" pattern), we
        // re-project those properties as top-level named exports
        // too. Genuine ESM named exports always win over an
        // identically-named property found on `default`, since
        // those were explicitly authored as separate exports.
        //
        // This keeps working for:
        //   - pure ESM packages (three, tesseract.js): "default"
        //     rarely carries extra own properties worth
        //     re-projecting, so this is a no-op for them.
        //   - CJS object exports (module.exports = { a, b })
        //   - CJS callable exports with attached statics
        //     (module.exports = Foo; Foo.Bar = Bar)
        //   - mixed ESM (export default X; export { Y })
        // ----------------------------------------------------

        const bridgeCode =
            `
            import * as __ARC_MODULE
                from ${JSON.stringify(packageURL)};

            function __arc_projectNamespace(ns) {

                const namedKeys =
                    new Set(Object.keys(ns));

                const def = ns.default;

                const canCarryProps =
                    def !== null &&
                    (typeof def === "object" ||
                        typeof def === "function");

                if (!canCarryProps) {
                    return ns;
                }

                // Collect the CJS-style properties attached
                // directly to the default export.
                const extra = {};
                let hasExtra = false;

                for (
                    const key of
                    Object.getOwnPropertyNames(def)
                ) {

                    // Skip intrinsic function/class fields and
                    // anything already exported as a real named
                    // ESM export (named exports win).
                    if (
                        key === "length" ||
                        key === "name" ||
                        key === "prototype" ||
                        key === "caller" ||
                        key === "arguments" ||
                        key === "__esModule" ||
                        namedKeys.has(key)
                    ) {
                        continue;
                    }

                    const descriptor =
                        Object.getOwnPropertyDescriptor(
                            def,
                            key
                        );

                    if (!descriptor || !descriptor.enumerable) {
                        continue;
                    }

                    try {

                        extra[key] =
                            def[key];

                        hasExtra = true;

                    } catch (err) {
                        // Getter threw - skip it rather than
                        // failing the whole import.
                    }
                }

                if (!hasExtra) {
                    return ns;
                }

                // A real module namespace object can't be
                // extended directly, so build a plain object
                // that behaves like one: original named exports
                // plus the re-projected CJS properties.
                const projected =
                    Object.create(null);

                for (const key of namedKeys) {
                    projected[key] = ns[key];
                }

                for (const key of Object.keys(extra)) {
                    projected[key] = extra[key];
                }

                console.log(
                    "[ARC] Preserving named exports:",
                    Object.keys(extra).join(", ")
                );

                return projected;
            }

            globalThis[${JSON.stringify(resultKey)}]
                = __arc_projectNamespace(__ARC_MODULE);
            `;

        const bridgeBlob =
            new Blob(
                [bridgeCode],
                {
                    type:
                        "text/javascript"
                }
            );

        const bridgeURL =
            URL.createObjectURL(
                bridgeBlob
            );

        // ----------------------------------------------------
        // Actual DOM script
        // ----------------------------------------------------

        const script =
            document.createElement(
                "script"
            );

        script.type =
            "module";

        script.src =
            bridgeURL;

        script.dataset.arc =
            "true";

        script.dataset.arcPackage =
            packageName;

        script.dataset.arcVersion =
            version;

        script.dataset.arcId =
            String(id);

        // ----------------------------------------------------
        // Wait for module execution
        // ----------------------------------------------------

        const module =
            await new Promise(
                (resolve, reject) => {

                    let interval = null;
                    let settled = false;

                    function cleanup() {

                        if (interval) {

                            clearInterval(
                                interval
                            );

                            interval = null;
                        }

                        script.onload =
                            null;

                        script.onerror =
                            null;
                    }

                    function finish(
                        value
                    ) {

                        if (settled) {
                            return;
                        }

                        settled = true;

                        delete globalThis[
                            resultKey
                        ];

                        cleanup();

                        resolve(value);
                    }

                    function check() {

                        if (
                            Object.prototype.hasOwnProperty.call(
                                globalThis,
                                resultKey
                            )
                        ) {

                            finish(
                                globalThis[
                                    resultKey
                                ]
                            );
                        }
                    }

                    script.onload =
                        () => {

                            check();

                            if (!settled) {

                                interval =
                                    setInterval(
                                        check,
                                        5
                                    );
                            }
                        };

                    script.onerror =
                        () => {

                            if (settled) {
                                return;
                            }

                            settled = true;

                            cleanup();

                            delete globalThis[
                                resultKey
                            ];

                            reject(
                                new Error(
                                    `Failed loading ` +
                                    `ARC script for ` +
                                    `${packageName}@${version}`
                                )
                            );
                        };

                    document.head.appendChild(
                        script
                    );

                    interval =
                        setInterval(
                            check,
                            5
                        );

                    // Catch synchronous availability.
                    check();
                }
            );

        // ----------------------------------------------------
        // Keep references
        // ----------------------------------------------------

        ARC.blobs.set(
            `${packageName}@${version}`,
            {
                packageURL,
                bridgeURL,
                script
            }
        );

        return module;
    }

    // ========================================================
    // Public importPackage()
    // ========================================================

    async function importPackage(
        specifier
    ) {

        const parsed =
            parseSpecifier(
                specifier
            );

        if (
            ARC.modules.has(
                specifier
            )
        ) {

            log(
                `Cache hit: ${specifier}`
            );

            return ARC.modules.get(
                specifier
            );
        }

        log(
            "=========================================="
        );

        log(
            `Importing ${specifier}`
        );

        log(
            "=========================================="
        );

        try {

            // ------------------------------------------------
            // Compile
            // ------------------------------------------------

            const compiled =
                await compilePackage(
                    parsed.name,
                    parsed.version,
                    parsed.subpath
                );

            // ------------------------------------------------
            // Inject
            // ------------------------------------------------

            log(
                "Injecting compiled package <script>..."
            );

            const module =
                await injectModule(
                    compiled.code,
                    compiled.packageResult.name,
                    compiled.packageResult.version
                );

            // ------------------------------------------------
            // Cache
            // ------------------------------------------------

            ARC.modules.set(
                specifier,
                module
            );

            // ------------------------------------------------
            // Final logs
            // ------------------------------------------------

            log(
                `✓ ${compiled.packageResult.name}` +
                `@${compiled.packageResult.version}` +
                ` imported`
            );

            log(
                "Exports:",
                Object.keys(module)
            );

            return module;

        } catch (err) {

            console.error(
                `[ARC] importPackage("${specifier}") failed:`,
                err
            );

            throw err;
        }
    }

    // ========================================================
    // Public importGlobal()
    //
    // Promotes a single named export of an already-imported
    // package onto globalThis, so instead of writing
    // `three.ArrowHelper` you can write `ArrowHelper` directly.
    //
    // IMPORTANT: this intentionally does NOT call importPackage()
    // on your behalf. The package must already have been
    // imported (and therefore be present in ARC.modules) via a
    // prior:
    //
    //   await importPackage("three");
    //
    // If it isn't, importGlobal() throws immediately rather than
    // silently importing it - this keeps package loading (async,
    // network-bound, explicit) separate from "make this name
    // global" (sync, local, convenience-only), and avoids a
    // surprise network/compile step hiding inside what looks
    // like a synchronous global assignment.
    // ========================================================

    function importGlobal(
        packageName,
        exportKey,
        alias
    ) {

        if (
            typeof packageName !== "string" ||
            !packageName.trim()
        ) {

            throw new Error(
                `[ARC] importGlobal() requires a ` +
                `package name as its first argument`
            );
        }

        if (
            typeof exportKey !== "string" ||
            !exportKey.trim()
        ) {

            throw new Error(
                `[ARC] importGlobal() requires an ` +
                `export key as its second argument`
            );
        }

        const targetName =
            (
                alias &&
                String(alias).trim()
            ) ||
            exportKey;

        // -----------------------------------------------------
        // Resolve which cached module this refers to.
        //
        // ARC.modules is keyed by the exact specifier string
        // that was passed to importPackage() (e.g. "three",
        // "@anthropic-ai/sdk", "@anthropic-ai/sdk/helpers").
        // importGlobal() accepts the same kind of specifier.
        // -----------------------------------------------------

        if (
            !ARC.modules.has(
                packageName
            )
        ) {

            throw new Error(
                `[ARC] importGlobal("${packageName}", ` +
                `"${exportKey}"${alias ? `, "${alias}"` : ""}) ` +
                `failed: dependencies not imported. ` +
                `Call "await importPackage(${
                    JSON.stringify(packageName)
                })" first, then call importGlobal().`
            );
        }

        const module =
            ARC.modules.get(
                packageName
            );

        if (
            !Object.prototype.hasOwnProperty.call(
                module,
                exportKey
            )
        ) {

            throw new Error(
                `[ARC] importGlobal("${packageName}", ` +
                `"${exportKey}") failed: ` +
                `"${exportKey}" is not an export of ` +
                `"${packageName}". Available exports: ` +
                `${Object.keys(module).join(", ")}`
            );
        }

        const value =
            module[exportKey];

        if (
            Object.prototype.hasOwnProperty.call(
                globalThis,
                targetName
            )
        ) {

            warn(
                `importGlobal() is overwriting existing ` +
                `global "${targetName}"`
            );
        }

        globalThis[targetName] =
            value;

        log(
            `Global: ${targetName} = ` +
            `${packageName}.${exportKey}`
        );

        return value;
    }

    // ========================================================
    // Expose debugging API
    // ========================================================

    globalThis.ARC =
        ARC;

    globalThis.importPackage =
        importPackage;

    globalThis.importGlobal =
        importGlobal;

    // ========================================================
    // Ready
    // ========================================================

    console.log(
        "%c[ARC] Browser npm loader ready",
        "font-weight:bold"
    );

    console.log(
        'Test: const Tesseract = await importPackage("tesseract.js")'
    );

    console.log(
        'Then: importGlobal("three", "ArrowHelper")'
    );

})();
