import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

// This encoder is now available for the entire script
const enc = new Tiktoken(o200k_base);
console.log("✅ Tokenizer initialized.");
let lastTokenCount = 0;
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
 * within the defined context window limit.
 * @param {Array<object>} allMessages - The complete list of messages from the DB.
 * @param {number} limit - The context window token limit.
 * @returns {{effectiveMessages: Array<object>, totalTokens: number}} An object containing the messages that fit and their total token count.
 */
function getEffectiveMessages(allMessages, limit) {
  const messagesWithTokens = allMessages.map((msg) => ({
    ...msg,
    tokens: (msg.text || "").trim() ? enc.encode(msg.text).length : 0,
    isTruncated: false,
  }));

  let currentTotalTokens = 0;
  const effectiveMessages = [];

  for (let i = messagesWithTokens.length - 1; i >= 0; i--) {
    const message = messagesWithTokens[i];
    if (message.tokens === 0) continue;
    if (message.tokens > limit) {
      if (i === messagesWithTokens.length - 1) {
        message.isTruncated = true;
        effectiveMessages.unshift(message);
        currentTotalTokens = limit;
      }
      break;
    }

    if (currentTotalTokens + message.tokens <= limit) {
      currentTotalTokens += message.tokens;
      effectiveMessages.unshift(message);
    } else {
      break;
    }
  }
  return {
    effectiveMessages,
    totalTokens: currentTotalTokens,
    messagesWithTokens,
  };
}

/**
 * Attaches a token count display to each chat bubble, handling truncation and
 * visually distinguishing messages that are outside the context window.
 * @param {Array<object>} allMessages - The complete list of messages from the DB.
 * @param {Set<string>} effectiveMessageIds - A set of IDs for messages that are within the context window.
 * @param {Map<string, object>} effectiveMessageMap - A map to get the potentially modified (truncated) message object.
 * @param {number} limit - The context window token limit.
 */
function addHoverListeners(
  allMessages,
  effectiveMessageIds,
  effectiveMessageMap,
  limit,
  totalTokens,
  messagesWithTokens
) {
  if (totalTokens > 0 && lastTokenCount == totalTokens) {
    console.log("Same token count, skipping update.");
    return;
  }
  const turnElements = document.querySelectorAll(
    '[data-testid^="conversation-turn-"]'
  );
  if (!turnElements) {
    console.log("Elements still loading.");
    // run a debounce to wait for the changes
    debouncedRunTokenCheck();
    return;
  }

  let cumulativeTokens = 0;
  let maxcumulativeTokens = 0;
  console.log("Updating token UI...");
  turnElements.forEach((turnElement) => {
    const testId = turnElement.dataset.testid;
    const messageIndex = parseInt(testId.replace("conversation-turn-", ""), 10);
    const originalMessageData = allMessages[messageIndex];

    if (!originalMessageData) {
      console.log("Message data not found. Skipping update.");
      return;
    }

    const authorRoleElement = turnElement.querySelector(
      "[data-message-author-role]"
    );
    if (!authorRoleElement) {
      console.log("Author role element not found. Skipping update.");
      return;
    }

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

    if (effectiveMessageIds.has(originalMessageData.id)) {
      const effectiveMessageData = effectiveMessageMap.get(
        originalMessageData.id
      );
      const messageTokenCount = effectiveMessageData.tokens;
      if (effectiveMessageData.isTruncated) {
        cumulativeTokens = limit;
        tokenCountDiv.textContent = `${limit} tokens (Truncated from ${messageTokenCount})`;
      } else {
        cumulativeTokens += messageTokenCount;
        maxcumulativeTokens += messageTokenCount;
        if (messageTokenCount > 0) {
          tokenCountDiv.textContent = `${messageTokenCount} of ${cumulativeTokens}/${limit} tokens. Conversation: ${maxcumulativeTokens}.`;
        }
      }
      turnElement.style.opacity = "1";
    } else {
      const messageTokens= messagesWithTokens.find(
        (m) => m.id === originalMessageData.id
      ).tokens;
      maxcumulativeTokens += messageTokens;
      tokenCountDiv.textContent = `(May be out of context): ${messageTokens} tokens. Conversation: ${maxcumulativeTokens}.`;
      turnElement.style.opacity = "0.5";
      
    }
  });
  const hasTokenDiv = document.body.querySelector(".token-count-display");
  if (hasTokenDiv) lastTokenCount = totalTokens;
  else lastTokenCount = 0;
}

/**
 * Removes all token count UI elements and resets message styles.
 */
function clearTokenUI() {
  console.log("Clearing token UI...");
  const tokenDisplays = document.querySelectorAll(".token-count-display");
  tokenDisplays.forEach((display) => display.remove());

  const turnElements = document.querySelectorAll(
    '[data-testid^="conversation-turn-"]'
  );
  turnElements.forEach((turn) => {
    turn.style.opacity = "1"; // Reset opacity for all messages
  });
}

/**
 * Fetches the current conversation, processes it against the context limit,
 * and updates the UI accordingly.
 */
async function runTokenCheck() {
  const { contextWindow } = await chrome.storage.local.get({
    contextWindow: 8192,
  });

  // If contextWindow is 0, disable the feature and clean up the UI.
  if (contextWindow === 0) {
    clearTokenUI();
    return;
  }

  const pathParts = window.location.pathname.split("/");
  if (pathParts[1] !== "c" || !pathParts[2]) {
    return;
  }

  const conversationId = pathParts[2];

  try {
    const conversationData = await getConversationFromDB(conversationId);
    if (conversationData && Array.isArray(conversationData.messages)) {
      const {
        effectiveMessages,
        totalTokens,
        messagesWithTokens,
      } = getEffectiveMessages(conversationData.messages, contextWindow);
      const effectiveMessageIds = new Set(effectiveMessages.map((m) => m.id));
      const effectiveMessageMap = new Map(
        effectiveMessages.map((m) => [m.id, m])
      );

      console.log(
        `📊 TOTAL TOKENS IN CONTEXT for "${conversationData.title}": ${totalTokens} / ${contextWindow}`
      );
      addHoverListeners(
        conversationData.messages,
        effectiveMessageIds,
        effectiveMessageMap,
        contextWindow,
        totalTokens,
        messagesWithTokens
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

// Updated listener to handle both theme and context window changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;

  if (
    changes.themeObject ||
    changes.isThemeActive ||
    changes.isScriptingEnabled
  ) {
    applyTheme();
  }
  if (changes.contextWindow) {
    runTokenCheck();
  }
});

const debouncedRunTokenCheck = debounce(runTokenCheck, 1000);
debouncedRunTokenCheck();
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    lastTokenCount = 0;
    console.log("URL changed, running token check immediately.");
    debouncedRunTokenCheck();
  } else {
    debouncedRunTokenCheck();
  }
}).observe(document.body.querySelector("main"), {
  subtree: true,
  childList: true,
});
