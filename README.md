# ARC.js

ARC.js is a lightweight browser runtime for loading project JavaScript from a simple configuration file and importing NPM packages directly in the browser.

It is designed for experimenting with a more flexible browser runtime without needing a traditional build setup for the project itself.

-----------------------------------
## Arrc.js is deprecated.

-> ARCH.JS https://github.com/Chibbit-99/arch.js
-----------------------------------


## Try it

**Documentation:** https://chibbit-99.github.io/arc.js/docs/

**Three.js demo:** https://chibbit-99.github.io/arc.js/demo/threejs/

**Project site:** https://chibbit-99.github.io/arc.js/

## Quick start

Create a page that loads ARC.js:

```html
<!doctype html>
<html>
<body>
    <script src="https://chibbit-99.github.io/arc.js/main.js"></script>
</body>
</html>
```

Then give the page an `arc/` directory:

```text
my-project/
├── index.html
├── arc/
│   ├── config.json
│   └── init.js
└── src/
    └── main.js
```

### `arc/config.json`

```json
{
  "modules": ["npmloader.js"],
  "js": ["./src/main.js"]
}
```

`modules` tells ARC.js which runtime modules to load. `js` tells it which project JavaScript files to execute. `js` can be either one string or an array.

### `src/main.js`

Normal browser JavaScript works as the project entry point:

```js
console.log("Hello from ARC.js");
```

Open `index.html` through a web server/static host and ARC.js will load the configuration and start the project.

## Import an NPM package

Add `npmloader.js` to your modules and use `importPackage()` from your project code or `arc/init.js`:

```json
{
  "modules": ["npmloader.js"],
  "js": ["./src/main.js"]
}
```

```js
const three = await importPackage("three");

const scene = new three.Scene();
console.log(scene);
```

The loader resolves the package through the NPM registry, handles its package files and dependencies, bundles it for the browser, and returns the resulting module namespace.

Versioned requests and subpaths are supported:

```js
const three = await importPackage("three@0.180.0");
const helpers = await importPackage("some-package/helpers");
```

## Use `arc/init.js`

`arc/init.js` is optional, but it is useful for dependency setup that should happen before your main project files execute.

```js
const THREE = await importPackage("three");

globalThis.THREE = THREE;
```

ARC.js waits for `arc/init.js` to finish before executing the files listed in `config.json`.

## Make an export global

After importing a package, `importGlobal()` can place one of its exports on `globalThis`:

```js
await importPackage("three");

importGlobal("three", "ArrowHelper");
```

You can also give the global a different name:

```js
importGlobal("three", "Vector3", "Vec3");
```

`importGlobal()` does not load the package itself. The package must already have been imported with `await importPackage(...)`.

## Multiple project files

`config.json` can contain several project files:

```json
{
  "modules": ["npmloader.js"],
  "js": [
    "./src/components.js",
    "./src/main.js"
  ]
}
```

ARC.js fetches the project files concurrently and executes them in the order listed in `js`.

## Reusable ARC modules

Runtime functionality is kept in the `module/` directory. A module listed in `config.modules` is loaded before `arc/init.js`.

For example, the repository currently ships `module/npmloader.js`, which provides the NPM package loading API.

A module can therefore be enabled per project instead of putting every feature into the core runtime.

## Existing examples

### Minimal demo

`demo/arc/` shows the basic project structure with:

```text
demo/arc/
├── config.json
├── init.js
└── src/
    └── main.js
```

Open it at https://chibbit-99.github.io/arc.js/demo/

### Three.js demo

`demo/threejs/` uses the same structure and imports Three.js through ARC.js. Its project code then builds a full browser 3D scene.

Open it at https://chibbit-99.github.io/arc.js/demo/threejs/

## Debugging

ARC.js writes startup and package-loading information to the browser console with an `[ARC]` prefix.

The NPM loader also exposes `ARC` for inspection:

```js
console.log(ARC);
```

Imported packages are cached, so repeating the same package specifier can reuse the existing module.

## Important notes

ARC.js is a browser runtime, not a replacement for every Node.js feature. Packages that depend on Node-only built-ins or unsupported package protocols may not work in the browser.

Package resolution is designed around browser use and currently handles common `exports`, `browser`, `module`, `main`, dependency, semver, ESM, and CommonJS cases.

## Documentation

For the full usage guide and API reference:

https://chibbit-99.github.io/arc.js/docs/

## License

See the repository for the current license and project status.
