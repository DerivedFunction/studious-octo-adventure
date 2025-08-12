import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

// This encoder is now available for the entire script
const enc = new Tiktoken(o200k_base);
console.log("✅ Tokenizer initialized.");

/* eslint-disable no-undef */

// --- UTILITY FUNCTIONS ---

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// --- TOKEN COUNTING LOGIC ---

/**
 * Retrieves a full conversation object from ChatGPT's IndexedDB.
 * @param {string} conversationId The ID of the conversation to fetch.
 * @returns {Promise<object|null>} A promise that resolves with the conversation data.
 */
async function getConversationFromDB(conversationId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ConversationsDatabase");
    request.onerror = () => reject("Error opening database");
    request.onsuccess = (event) => {
      try {
        const db = event.target.result;
        const transaction = db.transaction(["conversations"], "readonly");
        const objectStore = transaction.objectStore("conversations");
        const getRequest = objectStore.get(conversationId);
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => reject("Error fetching conversation");
      } catch (error) {
        reject(error);
      }
    };
  });
}

/**
 * Attaches mouseover event listeners to chat bubbles to show token counts.
 * It maps the DOM element to the corresponding message data from IndexedDB.
 * @param {Array<object>} messages - The array of message objects from the conversation.
 */
function addHoverListeners(messages) {
  const turnElements = document.querySelectorAll(
    '[data-testid^="conversation-turn-"]'
  );

  turnElements.forEach((turnElement) => {
    // If we've already attached a listener, skip it to avoid duplicates.
    if (turnElement.dataset.tokenListenerAttached) {
      return;
    }

    const testId = turnElement.dataset.testid; // e.g., "conversation-turn-2"
    // The index in the DOM's test-id directly corresponds to the message index.
    const messageIndex = parseInt(testId.replace("conversation-turn-", ""), 10);

    // Get the corresponding message from the database data.
    const messageData = messages[messageIndex];

    if (messageData) {
      const handleHover = () => {
        const messageText = messageData.text || "";
        if (messageText.trim()) {
          const messageTokenCount = enc.encode(messageText).length;
          console.log(`💬 Message Tokens (from DB): ${messageTokenCount}`);
        }
      };

      turnElement.addEventListener("mouseover", handleHover);
      // Mark the element so we don't add the listener again.
      turnElement.dataset.tokenListenerAttached = "true";
    }
  });
}

/**
 * Fetches the current conversation, counts its tokens, and attaches hover listeners.
 */
async function runTokenCheck() {
  const pathParts = window.location.pathname.split("/");
  // Check if the URL matches the pattern for a conversation
  if (pathParts[1] !== "c" || !pathParts[2]) {
    console.log("ⓘ Not on a conversation page. Token check skipped.");
    return;
  }

  const conversationId = pathParts[2];
  // console.log(`🚀 Running token check for conversation: ${conversationId}`); // This can be noisy, optional to keep.

  try {
    const conversationData = await getConversationFromDB(conversationId);
    if (conversationData && Array.isArray(conversationData.messages)) {
      const fullText = conversationData.messages
        .map((msg) => msg.text || "")
        .join("\n");
      const tokenCount = enc.encode(fullText).length;

      console.log(
        `📊 TOTAL TOKENS for "${conversationData.title}": ${tokenCount}`
      );

      // Add hover listeners using the accurate data from IndexedDB
      addHoverListeners(conversationData.messages);
    } else {
      // This can happen briefly during navigation, so a warn might be too much.
      // console.warn("Could not find conversation data or messages.");
    }
  } catch (error) {
    console.error("❌ Error during token check:", error);
  }
}

// --- THEME LOGIC ---

/**
 * Applies the correct theme (light or dark) based on stored settings
 * and the host page's current color scheme.
 */
const applyTheme = async () => {
  const hostScheme = document.documentElement.style.colorScheme || "light";
  chrome.storage.local.set({ isDarkMode: hostScheme === "dark" });
  // console.log("Applying theme for host scheme:", hostScheme);

  try {
    if (!chrome.storage?.local) {
      console.warn("Theme Extension: chrome.storage.local API not available.");
      return;
    }
    const { isScriptingEnabled } = await chrome.storage.local.get(
      "isScriptingEnabled"
    );
    const { isThemeActive } = await chrome.storage.local.get("isThemeActive");
    if (!isScriptingEnabled || !isThemeActive) {
      removeStyles();
      return;
    }
    const keysToGet = ["themeObject"];
    chrome.storage.local.get(keysToGet, (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error retrieving theme:", chrome.runtime.lastError);
        return;
      }

      const { themeObject } = result;
      if (!themeObject) {
        // console.warn("Theme object not found in storage.");
        return;
      }

      const currentTheme = themeObject[hostScheme];
      if (!currentTheme) {
        // console.warn(`No theme found for scheme: "${hostScheme}"`);
        return;
      }

      const keys = Object.keys(currentTheme);
      const values = Object.values(currentTheme);
      for (let i = 0; i < keys.length; i++) {
        document.documentElement.style.setProperty(
          `--theme-${keys[i]}`,
          values[i]
        );
      }
      // console.log("Theme successfully applied.");
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
  const config = {
    attributes: true,
    attributeFilter: ["style", "class"],
  };

  const callback = (mutationsList) => {
    for (const mutation of mutationsList) {
      if (
        mutation.type === "attributes" &&
        (mutation.attributeName === "style" ||
          mutation.attributeName === "class")
      ) {
        // console.log("Host page style or class attribute changed. Re-applying theme.");
        applyTheme();
        return;
      }
    }
  };

  const observer = new MutationObserver(callback);
  observer.observe(targetNode, config);
  // console.log("MutationObserver is now watching for color scheme changes.");
};

/**
 * Removes custom styles by clearing the CSS variables.
 */
const removeStyles = () => {
  // console.log("Removing styles...");
  const themeProperties = [
    "--theme-user-msg-bg",
    "--theme-user-msg-text",
    "--theme-submit-btn-bg",
    "--theme-submit-btn-text",
    "--theme-secondary-btn-bg",
    "--theme-secondary-btn-text",
    "--theme-user-selection-bg",
  ];
  themeProperties.forEach((prop) =>
    document.documentElement.style.removeProperty(prop)
  );
};

// --- SCRIPT INITIALIZATION ---

// 1. Apply the theme immediately when the script is injected.
applyTheme();

// 2. Set up the observer to watch for dynamic changes on the page for themes.
observeHostSchemeChanges();

// 3. Listen for changes from the extension's storage (e.g., user changes theme in the popup).
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    // console.log("Storage changed. Re-applying theme...");
    applyTheme();
  }
});

// 4. Run the token check on initial load.
runTokenCheck();

// 5. Create a debounced version of the token check function.
const debouncedRunTokenCheck = debounce(runTokenCheck, 500); // 500ms delay

// 6. Set up an observer for navigation and content changes.
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;

  // If the URL has changed, it's a navigation event. Run the check immediately.
  if (url !== lastUrl) {
    lastUrl = url;
    console.log("URL changed, running token check immediately.");
    runTokenCheck();
  } else {
    // Otherwise, it's a content change (e.g., AI typing). Use the debounced version.
    debouncedRunTokenCheck();
  }
}).observe(document.body, { subtree: true, childList: true });
