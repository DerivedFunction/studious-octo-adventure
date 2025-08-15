// --- THEME LOGIC ---
/* eslint-disable no-undef */
(() => {
  const applyTheme = async () => {
    const hostScheme = document.documentElement.style.colorScheme || "light";
    chrome.storage.local.set({ isDarkMode: hostScheme === "dark" });
    try {
      const { isScriptingEnabled, isThemeActive } =
        await chrome.storage.local.get(["isScriptingEnabled", "isThemeActive"]);
      if (!isScriptingEnabled || !isThemeActive) {
        removeStyles();
        return;
      }
      chrome.storage.local.get("themeObject", (result) => {
        if (chrome.runtime.lastError || !result.themeObject) return;
        const currentTheme = result.themeObject[hostScheme];
        if (!currentTheme) return;
        Object.entries(currentTheme).forEach(([key, value]) => {
          document.documentElement.style.setProperty(`--theme-${key}`, value);
        });
      });
    } catch (error) {
      console.error("❌ An unexpected error occurred in applyTheme:", error);
    }
  };

  const observeHostSchemeChanges = () => {
    const observer = new MutationObserver(() => applyTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  };

  const removeStyles = () => {
    chrome.storage.local.get("themeObject", (result) => {
      if (chrome.runtime.lastError || !result.themeObject) return;
      const currentTheme = result.themeObject["light"];
      if (!currentTheme) return;
      Object.entries(currentTheme).forEach(([key]) => {
        document.documentElement.style.removeProperty(`--theme-${key}`);
      });
    });
  };

  // --- SCRIPT INITIALIZATION ---

  applyTheme();
  observeHostSchemeChanges();

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local") return;
    if (changes.isScriptingEnabled || changes.themeObject || changes.isThemeActive) {
      applyTheme();
      return;
    }
  });
})();
