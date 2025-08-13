import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

// This encoder is now available for the entire script
const enc = new Tiktoken(o200k_base);
console.log("✅ Tokenizer initialized.");

// The fixed context window size for our simulation.
const CONTEXT_WINDOW_LIMIT = 8192;

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
 * Processes the full message history to determine which messages fit
 * within the defined CONTEXT_WINDOW_LIMIT. This correctly models a real context
 * window by taking the most recent messages that fit.
 * @param {Array<object>} allMessages - The complete list of messages from the DB.
 * @returns {{effectiveMessages: Array<object>, totalTokens: number}} An object containing the messages that fit and their total token count.
 */
function getEffectiveMessages(allMessages) {
  const messagesWithTokens = allMessages.map((msg) => ({
    ...msg,
    tokens: (msg.text || "").trim() ? enc.encode(msg.text).length : 0,
    isTruncated: false, // Flag for truncation
  }));

  let currentTotalTokens = 0;
  const effectiveMessages = [];

  // Iterate backwards from the last message to the first.
  for (let i = messagesWithTokens.length - 1; i >= 0; i--) {
    const message = messagesWithTokens[i];
    if (message.tokens === 0) continue; // Skip empty messages

    // Special case: If the most recent message is too big, it's the only one, and it's truncated.
    if (message.tokens > CONTEXT_WINDOW_LIMIT) {
      if (i === messagesWithTokens.length - 1) {
        message.isTruncated = true;
        effectiveMessages.unshift(message);
        currentTotalTokens = CONTEXT_WINDOW_LIMIT;
      }
      // This oversized message (or an earlier one) blocks everything before it.
      break;
    }

    // If the current message fits, add it.
    if (currentTotalTokens + message.tokens <= CONTEXT_WINDOW_LIMIT) {
      currentTotalTokens += message.tokens;
      effectiveMessages.unshift(message); // Add to the beginning to maintain order
    } else {
      // Otherwise, the context is full. Stop adding older messages.
      break;
    }
  }
  return { effectiveMessages, totalTokens: currentTotalTokens };
}

/**
 * Attaches a token count display to each chat bubble, handling truncation and
 * visually distinguishing messages that are outside the context window.
 * @param {Array<object>} allMessages - The complete list of messages from the DB.
 * @param {Set<string>} effectiveMessageIds - A set of IDs for messages that are within the context window.
 * @param {Map<string, object>} effectiveMessageMap - A map to get the potentially modified (truncated) message object.
 */
function addHoverListeners(
  allMessages,
  effectiveMessageIds,
  effectiveMessageMap
) {
  const turnElements = document.querySelectorAll(
    '[data-testid^="conversation-turn-"]'
  );
  let cumulativeTokens = 0;

  turnElements.forEach((turnElement) => {
    const testId = turnElement.dataset.testid;
    const messageIndex = parseInt(testId.replace("conversation-turn-", ""), 10);
    const originalMessageData = allMessages[messageIndex];

    if (!originalMessageData) return;

    const authorRoleElement = turnElement.querySelector(
      "[data-message-author-role]"
    );
    if (!authorRoleElement) return;

    let tokenCountDiv = authorRoleElement.querySelector(".token-count-display");
    if (!tokenCountDiv) {
      tokenCountDiv = document.createElement("div");
      tokenCountDiv.className = "token-count-display";
      tokenCountDiv.style.display = "inline-block";
      tokenCountDiv.style.marginLeft = "8px";
      tokenCountDiv.style.fontSize = "12px";
      tokenCountDiv.style.color = "var(--text-secondary)";
      tokenCountDiv.style.fontWeight = "normal";
      authorRoleElement.appendChild(tokenCountDiv);
    }

    // The cumulative sum is only calculated for messages inside the effective context.
    if (effectiveMessageIds.has(originalMessageData.id)) {
      const effectiveMessageData = effectiveMessageMap.get(
        originalMessageData.id
      );
      const messageTokenCount = effectiveMessageData.tokens;

      if (effectiveMessageData.isTruncated) {
        // A truncated message resets and fills the context.
        cumulativeTokens = CONTEXT_WINDOW_LIMIT;
        tokenCountDiv.textContent = `| ${CONTEXT_WINDOW_LIMIT} tokens (Truncated from ${messageTokenCount})`;
      } else {
        cumulativeTokens += messageTokenCount;
        if (messageTokenCount > 0) {
          tokenCountDiv.textContent = `| ${messageTokenCount} tokens (Total: ${cumulativeTokens})`;
        }
      }
      turnElement.style.opacity = "1"; // Ensure it's fully visible
    } else {
      // This message is outside the context window.
      tokenCountDiv.textContent = `| (Out of Context)`;
      turnElement.style.opacity = "0.5"; // Visually dim it
    }
  });
}

/**
 * Fetches the current conversation, processes it against the context limit,
 * and updates the UI accordingly.
 */
async function runTokenCheck() {
  const pathParts = window.location.pathname.split("/");
  if (pathParts[1] !== "c" || !pathParts[2]) {
    return;
  }

  const conversationId = pathParts[2];

  try {
    const conversationData = await getConversationFromDB(conversationId);
    if (conversationData && Array.isArray(conversationData.messages)) {
      const { effectiveMessages, totalTokens } = getEffectiveMessages(
        conversationData.messages
      );
      const effectiveMessageIds = new Set(effectiveMessages.map((m) => m.id));
      const effectiveMessageMap = new Map(
        effectiveMessages.map((m) => [m.id, m])
      );

      console.log(
        `📊 TOTAL TOKENS IN CONTEXT for "${conversationData.title}": ${totalTokens} / ${CONTEXT_WINDOW_LIMIT}`
      );

      addHoverListeners(
        conversationData.messages,
        effectiveMessageIds,
        effectiveMessageMap
      );
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

  try {
    if (!chrome.storage?.local) {
      return;
    }
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
    console.error("An unexpected error occurred in applyTheme:", error);
  }
};

/**
 * Sets up a MutationObserver to watch for changes to the <html> element's style.
 */
const observeHostSchemeChanges = () => {
  const observer = new MutationObserver(() => applyTheme());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });
};

/**
 * Removes custom styles by clearing the CSS variables.
 */
const removeStyles = () => {
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

applyTheme();
observeHostSchemeChanges();
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") applyTheme();
});

runTokenCheck();
const debouncedRunTokenCheck = debounce(runTokenCheck, 500);

let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log("URL changed, running token check immediately.");
    runTokenCheck();
  } else {
    debouncedRunTokenCheck();
  }
}).observe(document.body, { subtree: true, childList: true });
