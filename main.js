async function getConfigValue() {
  try {
    // 1. Fetch the JSON file from the root-relative path
    const response = await fetch('./.arc/config.json');
    
    // 2. Ensure the network request succeeded
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    // 3. Parse the JSON body
    const config = await response.json();
    
    // 4. Access the specific value you need (e.g., config.someKey)
    console.log("Config loaded:", config);
    return config;
    
  } catch (error) {
    console.error("Failed to load config.json:", error);
  }
}

// Call the function
getConfigValue();
