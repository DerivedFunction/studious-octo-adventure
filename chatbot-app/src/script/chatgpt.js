import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

// This encoder is now available for the entire script
const enc = new Tiktoken(o200k_base);
console.log("✅ Tokenizer initialized.");
let lastTokenCount = 0;
let fetchController; // Controller to abort in-flight fetch requests
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
 * Fetches detailed conversation data from the backend API to find file and canvas tokens.
 * @param {string} conversationId The ID of the conversation to fetch.
 * @returns {Promise<Map<string, object>>} A map where keys are message IDs and values contain file/canvas info.
 */
async function processBackendData(conversationId) {
  // Abort any previous fetch request to avoid race conditions on navigation
  if (fetchController) {
    fetchController.abort();
  }
  fetchController = new AbortController();
  const signal = fetchController.signal;

  console.log(`Fetching data from backend-api for ${conversationId}...`);
  const additionalDataMap = new Map();

  try {
    // First, get the access token needed for the API call
    const session = await fetch("https://chatgpt.com/api/auth/session", {
      signal,
    }).then((res) => {
      if (!res.ok) throw new Error("Failed to fetch auth session");
      return res.json();
    });
    const accessToken = session.accessToken;

    if (!accessToken) {
      console.error("Could not retrieve access token.");
      return additionalDataMap;
    }

    // Then, fetch the full conversation data
    const conversationApiData = await fetch(
      `https://chatgpt.com/backend-api/conversation/${conversationId}`,
      {
        headers: {
          accept: "*/*",
          authorization: `Bearer ${accessToken}`,
        },
        method: "GET",
        signal, // Pass the signal to the fetch request
      }
    ).then((res) => {
      if (!res.ok)
        throw new Error(
          `Backend API request failed with status: ${res.status}`
        );
      return res.json();
    });

    // Process the mapping to find file and canvas metadata
    if (conversationApiData && conversationApiData.mapping) {
      for (const messageId in conversationApiData.mapping) {
        const node = conversationApiData.mapping[messageId];
        if (node.message) {
          const metadata = node.message.metadata;
          const content = node.message.content;
          let fileInfo = null;
          let canvasInfo = null;

          // Default to the current message's ID. This will be updated for canvas messages.
          let targetMessageId = node.message.id;

          // Check for file attachments (this logic is correct)
          if (metadata.attachments && metadata.attachments.length > 0) {
            fileInfo = metadata.attachments.map((file) => ({
              name: file.name,
              tokens: file.file_token_size || 0,
            }));
          }

          // Check for canvas/textdoc creation
          if (
            node.message.recipient === "canmore.create_textdoc" &&
            content.parts &&
            content.parts[0]
          ) {
            try {
              const canvasContent = JSON.parse(content.parts[0]);
              canvasInfo = {
                title: canvasContent.name || "Canvas",
                tokens: enc.encode(canvasContent.content || "").length,
              };

              // --- FIX: Find the correct target message ID ---
              // The canvas info belongs to the grandchild of this tool-call node.
              // Traverse down the conversation tree to find it.
              if (node.children && node.children.length > 0) {
                const toolResponseNodeId = node.children[0];
                const toolResponseNode =
                  conversationApiData.mapping[toolResponseNodeId];
                if (
                  toolResponseNode &&
                  toolResponseNode.children &&
                  toolResponseNode.children.length > 0
                ) {
                  // This is the ID of the final, user-visible assistant message.
                  targetMessageId = toolResponseNode.children[0];
                }
              }
            } catch (e) {
              console.error("Error parsing canvas content:", e);
            }
          }

          if (fileInfo || canvasInfo) {
            // Use the potentially updated targetMessageId as the key.
            // This ensures that if a message has both a file and a canvas, they are merged.
            const existingData = additionalDataMap.get(targetMessageId) || {};
            additionalDataMap.set(targetMessageId, {
              files: fileInfo || existingData.files,
              canvas: canvasInfo || existingData.canvas,
            });
          }
        }
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      console.log("Fetch aborted for previous conversation.");
    } else {
      console.error("❌ Error processing backend data:", error);
    }
  }
  console.log("✅ Backend data processed.", additionalDataMap);
  return additionalDataMap;
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
 * Attaches a token count display to each chat bubble.
 * @param {Array<object>} allMessages - The complete list of messages from the DB.
 * @param {Set<string>} effectiveMessageIds - A set of IDs for messages that are within the context window.
 * @param {Map<string, object>} effectiveMessageMap - A map to get the potentially modified (truncated) message object.
 * @param {number} limit - The context window token limit.
 * @param {number} totalTokens - The total tokens of the effective messages.
 * @param {Array<object>} messagesWithTokens - All messages with their token counts.
 * @param {Map<string, object>} additionalDataMap - Map with file and canvas token data.
 */
function addHoverListeners(
  allMessages,
  effectiveMessageIds,
  effectiveMessageMap,
  limit,
  totalTokens,
  messagesWithTokens,
  additionalDataMap
) {
  if (totalTokens > 0 && lastTokenCount == totalTokens) {
    console.log("Same token count, skipping UI update.");
  }
  const turnElements = document.querySelectorAll(
    '[data-testid^="conversation-turn-"]'
  );
  if (!turnElements.length) {
    console.log("Elements still loading.");
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

    let extraInfoDiv = authorRoleElement.querySelector(".extra-token-info");
    if (!extraInfoDiv) {
      extraInfoDiv = document.createElement("div");
      extraInfoDiv.className = "extra-token-info";
      extraInfoDiv.style.marginTop = "4px";
      extraInfoDiv.style.fontSize = "11px";
      extraInfoDiv.style.color = "var(--text-tertiary)";
      tokenCountDiv.parentNode.insertBefore(
        extraInfoDiv,
        tokenCountDiv.nextSibling
      );
    }
    extraInfoDiv.innerHTML = "";

    if (effectiveMessageIds.has(originalMessageData.id)) {
      const effectiveMessageData = effectiveMessageMap.get(
        originalMessageData.id
      );
      const messageTokenCount = effectiveMessageData.tokens;
      if (effectiveMessageData.isTruncated) {
        cumulativeTokens = limit;
        tokenCountDiv.textContent = `${limit} tokens of ${cumulativeTokens}/${limit} tokens. (Truncated from ${messageTokenCount})`;
      } else {
        cumulativeTokens += messageTokenCount;
        maxcumulativeTokens += messageTokenCount;
        tokenCountDiv.textContent =
          messageTokenCount > 0
            ? `${messageTokenCount} of ${cumulativeTokens}/${limit} tokens.`
            : "";
      }
      turnElement.style.opacity = "1";
    } else {
      const messageTokens = messagesWithTokens.find(
        (m) => m.id === originalMessageData.id
      ).tokens;
      maxcumulativeTokens += messageTokens;
      tokenCountDiv.textContent = `(May be out of context): ${messageTokens} tokens.`;
      turnElement.style.opacity = "0.5";
    }

    const extraData = additionalDataMap.get(originalMessageData.id);
    if (extraData) {
      let extraContent = "";
      if (extraData.files) {
        extraData.files.forEach((file) => {
          extraContent += `<div>📎 ${file.name} (${file.tokens} tokens)</div>`;
        });
      }
      if (extraData.canvas) {
        extraContent += `<div>🎨 ${extraData.canvas.title} (${extraData.canvas.tokens} tokens)</div>`;
      }
      extraInfoDiv.innerHTML = extraContent;
    }
  });

  let statusDiv = document.querySelector(
    "#thread-bottom-container > div.text-token-text-secondary .tokenstatus"
  );
  if (!statusDiv) {
    statusDiv = document.createElement("div");
    statusDiv.classList.add("tokenstatus");
    statusDiv.style.display = "inline-block";
    statusDiv.style.marginLeft = "8px";
    statusDiv.style.fontSize = "12px";
    statusDiv.style.color = "var(--text-secondary)";
    statusDiv.style.fontWeight = "normal";
    const parent = document.querySelector(
      "#thread-bottom-container > div.text-token-text-secondary"
    );
    if (parent) parent.appendChild(statusDiv);
  }
  statusDiv.textContent = `Total tokens: ${maxcumulativeTokens}/${limit} tokens.`;

  lastTokenCount = document.body.querySelector(".token-count-display")
    ? totalTokens
    : 0;
}

/**
 * Removes all token count UI elements and resets message styles.
 */
function clearTokenUI() {
  console.log("Clearing token UI...");
  document
    .querySelectorAll(".token-count-display, .extra-token-info")
    .forEach((el) => el.remove());
  document
    .querySelectorAll('[data-testid^="conversation-turn-"]')
    .forEach((turn) => {
      turn.style.opacity = "1";
    });
  const statusDiv = document.querySelector("#tokenstatus");
  if (statusDiv) statusDiv.remove();
}

/**
 * Fetches the current conversation, processes it, and updates the UI.
 */
async function runTokenCheck() {
  const { contextWindow } = await chrome.storage.local.get({
    contextWindow: 8192,
  });

  if (contextWindow === 0) {
    clearTokenUI();
    return;
  }

  const pathParts = window.location.pathname.split("/");
  if (pathParts[1] !== "c" || !pathParts[2]) {
    clearTokenUI();
    return;
  }

  const conversationId = pathParts[2];

  try {
    const [conversationData, additionalDataMap] = await Promise.all([
      getConversationFromDB(conversationId),
      processBackendData(conversationId),
    ]);

    // --- STRICT CHECK ---
    // After async operations, re-check the URL to ensure the user hasn't navigated away.
    const currentConversationId = window.location.pathname.split("/")[2];
    if (conversationId !== currentConversationId) {
      console.log(
        `Stale data for ${conversationId} ignored; current chat is ${currentConversationId}.`
      );
      return; // Abort the UI update
    }

    if (conversationData && Array.isArray(conversationData.messages)) {
      const { effectiveMessages, totalTokens, messagesWithTokens } =
        getEffectiveMessages(conversationData.messages, contextWindow);
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
        messagesWithTokens,
        additionalDataMap
      );
    }
  } catch (error) {
    console.error("❌ Error during token check:", error);
  }
}

// --- THEME LOGIC ---

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
    console.error("An unexpected error occurred in applyTheme:", error);
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
new MutationObserver((mutationList) => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    lastTokenCount = 0;
    console.log("URL changed, running token check immediately.");
    runTokenCheck();
  } else {
    let skip = false;
    const ignoredClasses = new Set([
      "extra-token-info",
      "token-count-display",
      "tokenstatus",
      "@thread-xl/thread:pt-header-height",
    ]);
    mutationList.forEach((m) => {
      const classList = m.target.classList;
      console.log(classList);
      for (const cls of classList) {
        if (ignoredClasses.has(cls)) {
          skip = true;
          break;
        }
      }
    });
    if (!skip) debouncedRunTokenCheck();
  }
}).observe(document.body.querySelector("main"), {
  subtree: true,
  childList: true,
});
