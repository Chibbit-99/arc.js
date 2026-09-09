async function getConfigValue() {
  try {
    // ==================================================
    // Load config.json
    // ==================================================

    console.log("[ARC] Loading config.json...");

    const response = await fetch("./arc/config.json");

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const config = await response.json();

    console.log("[ARC] Config loaded:", config);

    // Make sure modules exists and is an array
    if (!Array.isArray(config.modules)) {
      throw new Error("[ARC] config.modules must be an array");
    }

    console.log(`[ARC] Found ${config.modules.length} module(s)`);

    // ==================================================
    // Load ARC modules
    // ==================================================

    for (const moduleName of config.modules) {
      const url = `https://chibbit-99.github.io/arc.js/module/${moduleName}`;

      console.log(`[ARC] Loading module: ${moduleName}`);
      console.log(`[ARC] Fetching: ${url}`);

      const moduleResponse = await fetch(url);

      if (!moduleResponse.ok) {
        console.error(
          `[ARC] Failed to fetch ${moduleName}: HTTP ${moduleResponse.status}`
        );
        continue;
      }

      const code = await moduleResponse.text();

      console.log(
        `[ARC] Fetched ${moduleName} (${code.length} bytes)`
      );

      const script = document.createElement("script");

      script.textContent = code;

      console.log(`[ARC] Injecting module: ${moduleName}`);

      document.body.appendChild(script);

      console.log(`[ARC] Module loaded: ${moduleName}`);
    }

    console.log("[ARC] All modules loaded successfully");

    // ==================================================
    // Load arc/init.js
    // ==================================================

    const initURL = "./arc/init.js";

    console.log("[ARC] Looking for init.js...");

    const initResponse = await fetch(initURL);

    if (initResponse.ok) {
      const initCode = await initResponse.text();

      console.log(
        `[ARC] Fetched init.js (${initCode.length} bytes)`
      );

      console.log("[ARC] Executing init.js...");

      /*
       * Execute init.js as an async function.
       *
       * This allows init.js to use:
       *
       *     await importPackage("package")
       *
       * because the generated function itself is async.
       *
       * `importPackage` is available because it is resolved
       * from the surrounding scope where npmloader.js defined it.
       */
      const executeInit = new Function(`
        return (async () => {
          ${initCode}
        })();
      `);

      await executeInit();

      console.log("[ARC] init.js executed successfully");

    } else if (initResponse.status === 404) {

      console.warn(
        "[ARC] No arc/init.js found. It is recommended to put all ARC setup scripts in arc/init.js so that dependencies are initialized before your main JavaScript file."
      );

    } else {

      console.warn(
        `[ARC] Failed to load arc/init.js: HTTP ${initResponse.status}`
      );

    }

    // ==================================================
    // Load project's main JavaScript file
    // ==================================================

    if (!config.js) {
      console.warn(
        '[ARC] No "js" property found in config.json. No project JavaScript file will be executed.'
      );

      return config;
    }

    console.log(`[ARC] Loading project JavaScript: ${config.js}`);

    const jsResponse = await fetch(config.js);

    if (!jsResponse.ok) {
      console.error(
        `[ARC] Failed to fetch project JavaScript "${config.js}": HTTP ${jsResponse.status}`
      );

      return config;
    }

    const jsCode = await jsResponse.text();

    console.log(
      `[ARC] Fetched project JavaScript (${jsCode.length} bytes)`
    );

    console.log(
      `[ARC] Executing project JavaScript: ${config.js}`
    );

    const jsScript = document.createElement("script");

    jsScript.textContent = jsCode;

    document.body.appendChild(jsScript);

    console.log(
      `[ARC] Project JavaScript executed successfully: ${config.js}`
    );

    // ==================================================
    // Finished
    // ==================================================

    console.log("[ARC] Project startup complete");

    return config;

  } catch (error) {
    console.error("[ARC] Failed to start project:", error);
  }
}

getConfigValue();
