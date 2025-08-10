/* eslint-disable no-undef */
(() => {
  console.log("Attempting to read from storage in Script 1...");
  try {
    // Check if the chrome.storage API is available
    if (chrome.storage?.local) {
      // Keys to retrieve from storage
      const keysToGet = ["themeColor", "isDarkMode"];

      // Use the chrome.storage.local.get method
      chrome.storage.local.get(keysToGet, (result) => {
        // This callback function executes once the data is retrieved.

        // Check for any runtime errors during the API call
        if (chrome.runtime.lastError) {
          console.error(
            "Script 1: Error retrieving data:",
            chrome.runtime.lastError
          );
          return;
        }

        // Log the retrieved data
        console.log(
          "Script 1: Data retrieved successfully from chrome.storage.local:"
        );
        console.log(result);

        // You can now use the retrieved data, for example:
        const { themeColor, isDarkMode } = result;
        console.log(`Script 1: Theme Color is ${themeColor}`);
        console.log(`Script 1: Is Dark Mode? ${isDarkMode}`);
      });
    } else {
      console.warn(
        "Script 1: chrome.storage.local API not available. Are you in an extension context?"
      );
    }
  } catch (error) {
    console.error("Script 1: An unexpected error occurred:", error);
  }
})();
