/* eslint-disable no-undef */

/**
 * Applies the correct theme (light or dark) based on stored settings
 * and the host page's current color scheme.
 */
const applyTheme = async () => {
  // Determine the host's color scheme, defaulting to 'light'
  const hostScheme = document.documentElement.style.colorScheme || "light";
  chrome.storage.local.set({ isDarkMode:  hostScheme === "dark" })
  console.log("Applying theme for host scheme:", hostScheme);

  try {
    if (!chrome.storage?.local) {
      console.warn("Theme Extension: chrome.storage.local API not available.");
      return;
    }
    const { isScriptingEnabled } = await chrome.storage.local.get(
      "isScriptingEnabled"
    );
    if (!isScriptingEnabled) return;
    const keysToGet = ["themeObject"];
    chrome.storage.local.get(keysToGet, (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error retrieving theme:", chrome.runtime.lastError);
        return;
      }

      const { themeObject } = result;
      if (!themeObject) {
        console.warn("Theme object not found in storage.");
        return;
      }

      // Select the correct theme palette (light or dark)
      const currentTheme = themeObject[hostScheme];
      if (!currentTheme) {
        console.warn(`No theme found for scheme: "${hostScheme}"`);
        return;
      }

      // Apply the theme by setting CSS variables on the root element
      document.documentElement.style.setProperty(
        "--theme-user-msg-bg",
        currentTheme["user-msg-bg"]
      );
      document.documentElement.style.setProperty(
        "--theme-user-msg-text",
        currentTheme["user-msg-text"]
      );
      document.documentElement.style.setProperty(
        "--theme-submit-btn-bg",
        currentTheme["submit-btn-bg"]
      );
      document.documentElement.style.setProperty(
        "--theme-submit-btn-text",
        currentTheme["submit-btn-text"]
      );
      document.documentElement.style.setProperty(
        "--theme-secondary-btn-bg",
        currentTheme["secondary-btn-bg"]
      );
      document.documentElement.style.setProperty(
        "--theme-secondary-btn-text",
        currentTheme["secondary-btn-text"]
      );
      document.documentElement.style.setProperty(
        "--theme-user-selection-bg",
        currentTheme["user-selection-bg"]
      );

      console.log("Theme successfully applied.");
    });
  } catch (error) {
    console.error("An unexpected error occurred in applyTheme:", error);
  }
};

/**
 * Sets up a MutationObserver to watch for changes to the <html> element's style,
 * which is where the color-scheme is often set.
 */
const observeHostSchemeChanges = () => {
  const targetNode = document.documentElement;

  // Configuration for the observer
  const config = {
    attributes: true, // Watch for attribute changes
    attributeFilter: ["style", "class"], // Specifically watch the 'style' and 'class' attributes
  };

  // Callback function to execute when mutations are observed
  const callback = (mutationsList, observer) => {
    for (const mutation of mutationsList) {
      if (
        mutation.type === "attributes" &&
        (mutation.attributeName === "style" ||
          mutation.attributeName === "class")
      ) {
        console.log(
          "Host page style or class attribute changed. Re-applying theme."
        );
        applyTheme();
        // No need to break, as we want to re-apply once per mutation batch.
        return;
      }
    }
  };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(callback);

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);
  console.log("MutationObserver is now watching for color scheme changes.");
};

// Function to remove custom styles
const removeStyles = () => {
  console.log("Removing styles...");
  // Remove custom CSS variables
  document.documentElement.style.removeProperty("--theme-user-msg-bg");
  document.documentElement.style.removeProperty("--theme-user-msg-text");
  document.documentElement.style.removeProperty("--theme-submit-btn-bg");
  document.documentElement.style.removeProperty("--theme-submit-btn-text");
  document.documentElement.style.removeProperty("--theme-secondary-btn-bg");
  document.documentElement.style.removeProperty("--theme-secondary-btn-text");
  document.documentElement.style.removeProperty("--theme-user-selection-bg");
};

// --- SCRIPT INITIALIZATION ---

// 1. Apply the theme immediately when the script is injected.
applyTheme();

// 2. Set up the observer to watch for dynamic changes on the page.
observeHostSchemeChanges();

// 3. Listen for changes from the extension's storage (e.g., user changes theme in the popup).
chrome.storage.onChanged.addListener((changes, namespace) => {
  console.log(changes);
  if (
    namespace === "local" &&
    (changes.themeObject || changes.isScriptingEnabled.newValue)
  ) {
    console.log("Theme object in storage changed. Re-applying styles...");
    applyTheme();
  }
  if (namespace === "local" && changes.isScriptingEnabled.newValue === false) {
    removeStyles();
  }
});
