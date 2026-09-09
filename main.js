async function getConfigValue() {
  try {
    console.log("[ARC] Loading config.json...");

    const response = await fetch("./arc/config.json");

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const config = await response.json();

    console.log("[ARC] Config loaded:", config);

    // Make sure modules exists and is an array
    if (!Array.isArray(config.modules)) {
      throw new Error('config.modules must be an array');
    }

    console.log(`[ARC] Found ${config.modules.length} module(s)`);

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

      // Create a script element
      const script = document.createElement("script");

      // Put the downloaded JavaScript into it
      script.textContent = code;

      console.log(`[ARC] Injecting module: ${moduleName}`);

      // Add it to the page — this executes the JavaScript
      document.body.appendChild(script);

      console.log(`[ARC] Module loaded: ${moduleName}`);
    }

    console.log("[ARC] All modules loaded successfully");

    return config;

  } catch (error) {
    console.error("[ARC] Failed to load config.json:", error);
  }
}

getConfigValue();
