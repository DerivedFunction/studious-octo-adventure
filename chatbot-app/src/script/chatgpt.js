import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

// This encoder is now available for the entire script
const enc = new Tiktoken(o200k_base);
console.log("✅ Tokenizer initialized.");
let fetchController; // Controller to abort in-flight fetch requests
let accessToken = null; // Global variable to store the access token
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
 * Fetches and stores the access token globally. Only fetches if the token is not already present.
 * @returns {Promise<string|null>} The access token or null if it fails.
 */
async function getAccessToken() {
  if (accessToken) {
    return accessToken;
  }
  console.log("Fetching new access token...");
  try {
    const session = await fetch("https://chatgpt.com/api/auth/session").then(
      (res) => {
        if (!res.ok) throw new Error("Failed to fetch auth session");
        return res.json();
      }
    );
    accessToken = session.accessToken;
    return accessToken;
  } catch (error) {
    console.error("Could not retrieve access token:", error);
    accessToken = null; // Reset on failure
    return null;
  }
}

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
 * Fetches detailed conversation data from the backend API, using a short-lived
 * cache and retry mechanism to ensure data is fetched reliably.
 * @param {string} conversationId The ID of the conversation to fetch.
 * @returns {Promise<Map<string, object>>} A map where keys are message IDs and values contain file/canvas info.
 */
async function processBackendData(conversationId) {
  const storageKey = `backend_data_${conversationId}`;
  const cacheDuration = 5 * 1000; // 5 seconds
  const maxRetries = 3;

  // Try to load from cache first
  try {
    const result = await chrome.storage.local.get(storageKey);
    if (result[storageKey]) {
      const cachedData = JSON.parse(result[storageKey]);
      console.log(`Using cached backend data for ${conversationId}.`);
      return new Map(Object.entries(cachedData));
    }
  } catch (e) {
    console.error("Error reading from local storage cache:", e);
  }

  // If no cache, proceed with fetching, including retry logic.
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (fetchController) {
      fetchController.abort();
    }
    fetchController = new AbortController();
    const signal = fetchController.signal;

    try {
      console.log(
        `Fetching data from backend-api for ${conversationId} (Attempt ${attempt})...`
      );
      const token = await getAccessToken();
      if (!token) {
        console.error("Could not retrieve access token. Aborting retries.");
        return new Map();
      }

      const response = await fetch(
        `https://chatgpt.com/backend-api/conversation/${conversationId}`,
        {
          headers: { accept: "*/*", authorization: `Bearer ${token}` },
          method: "GET",
          signal,
        }
      );

      if (response.status === 401 || response.status === 403) {
        console.log("Access token expired or invalid. Refreshing...");
        accessToken = null; // Clear the global token to force a refresh
        throw new Error("Authentication failed, retrying...");
      }

      if (!response.ok) {
        throw new Error(
          `Backend API request failed with status: ${response.status}`
        );
      }

      const conversationApiData = await response.json();
      const additionalDataMap = new Map();

      // Process the mapping to find file and canvas metadata
      if (conversationApiData && conversationApiData.mapping) {
        for (const messageId in conversationApiData.mapping) {
          const node = conversationApiData.mapping[messageId];
          if (node.message) {
            const { metadata, content } = node.message;
            let fileInfo = null;
            let canvasInfo = null;
            let targetMessageId = node.message.id;

            if (metadata.attachments && metadata.attachments.length > 0) {
              fileInfo = metadata.attachments.map((file) => ({
                name: file.name,
                tokens: file.file_token_size || 0,
              }));
            }

            if (
              node.message.recipient === "canmore.create_textdoc" &&
              content.parts?.[0]
            ) {
              try {
                const canvasContent = JSON.parse(content.parts[0]);
                canvasInfo = {
                  title: canvasContent.name || "Canvas",
                  tokens: enc.encode(canvasContent.content || "").length,
                };
                if (node.children?.length > 0) {
                  const toolResponseNode =
                    conversationApiData.mapping[node.children[0]];
                  if (toolResponseNode?.children?.length > 0) {
                    targetMessageId = toolResponseNode.children[0];
                  }
                }
              } catch (e) {
                console.error("Error parsing canvas content:", e);
              }
            }

            if (fileInfo || canvasInfo) {
              const existingData = additionalDataMap.get(targetMessageId) || {};
              additionalDataMap.set(targetMessageId, {
                files: fileInfo || existingData.files,
                canvas: canvasInfo || existingData.canvas,
              });
            }
          }
        }
      }

      // After successful processing, cache the result
      try {
        const dataToCache = Object.fromEntries(additionalDataMap);
        await chrome.storage.local.set({
          [storageKey]: JSON.stringify(dataToCache),
        });
        console.log(
          `Cached backend data for ${conversationId}. It will be removed in ${
            cacheDuration / 1000
          }s.`
        );

        setTimeout(() => {
          chrome.storage.local.remove(storageKey, () => {
            console.log(`Cache for ${conversationId} has been cleared.`);
          });
        }, cacheDuration);
      } catch (e) {
        console.error("Error writing to local storage cache:", e);
      }

      console.log("✅ Backend data processed.", additionalDataMap);
      return additionalDataMap; // Success, return the data
    } catch (error) {
      if (error.name === "AbortError") {
        console.log("Fetch aborted for previous conversation.");
        return new Map(); // Don't retry on abort
      }
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) {
        console.error("All fetch attempts failed.");
        return new Map(); // Return empty map after all retries fail
      }
      await new Promise((res) => setTimeout(res, 500)); // Wait before retrying
    }
  }
  return new Map(); // Fallback return
}

/**
 * Processes the full message history and attachments to determine what fits
 * within the defined context window limit based on user selections.
 * @param {Array<object>} allMessages - The complete list of messages from the DB.
 * @param {number} limit - The context window token limit.
 * @param {Map<string, object>} additionalDataMap - Map with file and canvas token data.
 * @param {Set<string>} checkedItems - A set of IDs for checked files/canvases.
 * @returns {object} An object containing the effective messages and token breakdown.
 */
function getEffectiveMessages(
  allMessages,
  limit,
  additionalDataMap,
  checkedItems
) {
  const messagesWithTokens = allMessages.map((msg) => ({
    ...msg,
    tokens: (msg.text || "").trim() ? enc.encode(msg.text).length : 0,
  }));

  let baseTokenCost = 0;
  const truncatedItems = new Set();

  // Calculate token cost of checked items first
  additionalDataMap.forEach((data, msgId) => {
    if (data.files) {
      data.files.forEach((file, index) => {
        const itemId = `file-${msgId}-${index}`;
        if (checkedItems.has(itemId)) {
          if (baseTokenCost + file.tokens > limit) {
            truncatedItems.add(itemId);
            baseTokenCost = limit;
          } else {
            baseTokenCost += file.tokens;
          }
        }
      });
    }
    if (baseTokenCost === limit) return; // Early exit if context is full

    if (data.canvas) {
      const itemId = `canvas-${msgId}`;
      if (checkedItems.has(itemId)) {
        if (baseTokenCost + data.canvas.tokens > limit) {
          truncatedItems.add(itemId);
          baseTokenCost = limit;
        } else {
          baseTokenCost += data.canvas.tokens;
        }
      }
    }
    if (baseTokenCost === limit) return; // Early exit
  });

  const remainingLimit = limit - baseTokenCost;
  let currentChatTokens = 0;
  const effectiveMessages = [];

  // Now, fit chat messages into the remaining space
  for (let i = messagesWithTokens.length - 1; i >= 0; i--) {
    const message = messagesWithTokens[i];
    if (message.tokens === 0) continue;

    if (message.tokens > remainingLimit) {
      if (i === messagesWithTokens.length - 1) {
        // Only truncate the very last message
        message.isTruncated = true;
        message.truncatedTokens = remainingLimit;
        effectiveMessages.unshift(message);
        currentChatTokens = remainingLimit;
      }
      break; // Stop adding messages
    }

    if (currentChatTokens + message.tokens <= remainingLimit) {
      currentChatTokens += message.tokens;
      effectiveMessages.unshift(message);
    } else {
      break;
    }
  }

  return {
    effectiveMessages,
    totalChatTokens: currentChatTokens,
    messagesWithTokens,
    baseTokenCost,
    truncatedItems,
  };
}

/**
 * Injects CSS for the hover popup into the document head.
 */
function injectPopupCSS() {
  const styleId = "token-popup-styles";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.innerHTML = `
        .token-status-container {
            position: relative;
            display: inline-block;
        }
        .token-status-container:hover .token-popup {
            display: block;
        }
        .token-popup {
            display: none;
            position: absolute;
            bottom: 0%;
            left: 50%;
            transform: translateX(-50%);
            background-color: var(--main-surface-primary);
            border: 1px solid var(--border-medium);
            border-radius: 8px;
            padding: 12px;
            width: 320px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            color: var(--text-secondary);
            font-size: 12px;
            text-align: left;
        }
        .token-popup h4 {
            margin-top: 0;
            margin-bottom: 8px;
            font-weight: bold;
            color: var(--text-primary);
            border-bottom: 1px solid var(--border-medium);
            padding-bottom: 4px;
        }
        .token-popup .token-section {
            margin-bottom: 8px;
        }
        .token-popup .token-section:last-child {
            margin-bottom: 0;
        }
        .token-popup .token-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .token-popup .token-item label {
            display: flex;
            align-items: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-right: 8px;
            cursor: pointer;
        }
        .token-popup .token-item input {
            margin-right: 6px;
        }
        .token-popup .token-item span {
            font-weight: bold;
            white-space: nowrap;
        }
        .token-popup .token-total-line {
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            margin-top: 4px;
            padding-top: 4px;
            border-top: 1px solid var(--border-light);
        }
        .truncated-text {
            font-style: italic;
            color: var(--text-secondary);
            margin-left: 4px;
        }
    `;
  document.head.appendChild(style);
}

/**
 * Attaches a token count display to each chat bubble and the summary status.
 * @param {Array<object>} allMessages - The complete list of messages from the DB.
 * @param {Set<string>} effectiveMessageIds - A set of IDs for messages that are within the context window.
 * @param {Map<string, object>} effectiveMessageMap - A map to get the potentially modified (truncated) message object.
 * @param {number} limit - The context window token limit.
 * @param {object} tokenData - An object with all token calculation results.
 * @param {Array<object>} messagesWithTokens - All messages with their token counts.
 * @param {Map<string, object>} additionalDataMap - Map with file and canvas token data.
 * @param {Set<string>} checkedItems - A set of IDs for currently checked items.
 */
function addHoverListeners(
  allMessages,
  effectiveMessageIds,
  effectiveMessageMap,
  limit,
  tokenData,
  messagesWithTokens,
  additionalDataMap,
  checkedItems
) {
  injectPopupCSS(); // Ensure CSS is present

  const { totalChatTokens, truncatedItems } = tokenData;

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
      const messageTokenCount = effectiveMessageData.isTruncated
        ? effectiveMessageData.truncatedTokens
        : effectiveMessageData.tokens;

      cumulativeTokens += messageTokenCount;
      maxcumulativeTokens += effectiveMessageData.tokens;
      tokenCountDiv.textContent = `${
        messageTokenCount > 0
          ? `${messageTokenCount} of ${cumulativeTokens}/${limit} tokens`
          : `(Out of context): ${messageTokenCount} tokens`
      }. ${
        effectiveMessageData.isTruncated
          ? `Truncated from ${effectiveMessageData.tokens} tokens.`
          : ""
      }`;

      turnElement.style.opacity = messageTokenCount > 0 ? "1" : "0.5";
    } else {
      const messageTokens =
        messagesWithTokens.find((m) => m.id === originalMessageData.id)
          ?.tokens || 0;
      maxcumulativeTokens += messageTokens;
      tokenCountDiv.textContent = `(Out of context): ${messageTokens} tokens.`;
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

  // --- Status Div with Hover Popup ---
  let statusContainer = document.querySelector(".token-status-container");
  const parent = document.querySelector(
    "#thread-bottom-container > div.text-token-text-secondary"
  );

  if (!statusContainer && parent) {
    statusContainer = document.createElement("div");
    statusContainer.className = "token-status-container";
    parent.appendChild(statusContainer);
  }

  if (statusContainer) {
    let statusDiv = statusContainer.querySelector(".tokenstatus");
    if (!statusDiv) {
      statusDiv = document.createElement("div");
      statusDiv.className = "tokenstatus";
      statusDiv.style.display = "inline-block";
      statusDiv.style.marginLeft = "8px";
      statusDiv.style.fontSize = "12px";
      statusDiv.style.color = "var(--text-secondary)";
      statusDiv.style.fontWeight = "normal";
      statusContainer.appendChild(statusDiv);
    }

    let popupDiv = statusContainer.querySelector(".token-popup");
    if (!popupDiv) {
      popupDiv = document.createElement("div");
      popupDiv.className = "token-popup";
      statusContainer.appendChild(popupDiv);
    }

    let fileDetailsHTML = "",
      canvasDetailsHTML = "";

    additionalDataMap.forEach((data, msgId) => {
      if (data.files) {
        data.files.forEach((f, index) => {
          const id = `file-${msgId}-${index}`;
          const isChecked = checkedItems.has(id);
          const isTruncated = truncatedItems.has(id);
          fileDetailsHTML += `<div class="token-item">
                      <label for="${id}" title="${f.name}">
                          <input type="checkbox" id="${id}" data-type="file" data-tokens="${
            f.tokens
          }" ${isChecked ? "checked" : ""}>
                          📎 ${f.name} ${
            isTruncated ? '<span class="truncated-text">(Truncated)</span>' : ""
          }
                      </label>
                      <span>${f.tokens}</span>
                  </div>`;
        });
      }
      if (data.canvas) {
        const id = `canvas-${msgId}`;
        const isChecked = checkedItems.has(id);
        const isTruncated = truncatedItems.has(id);
        canvasDetailsHTML += `<div class="token-item">
                  <label for="${id}" title="${data.canvas.title}">
                      <input type="checkbox" id="${id}" data-type="canvas" data-tokens="${
          data.canvas.tokens
        }" ${isChecked ? "checked" : ""}>
                      🎨 ${data.canvas.title} ${
          isTruncated ? '<span class="truncated-text">(Truncated)</span>' : ""
        }
                  </label>
                  <span>${data.canvas.tokens}</span>
              </div>`;
      }
    });

    const effectiveTotal = tokenData.baseTokenCost + totalChatTokens;
    const maxTotal = maxcumulativeTokens + tokenData.baseTokenCost;

    popupDiv.innerHTML = `
          <h4>Token Breakdown</h4>
          <div class="token-section">
              <div class="token-item"><span>Chat Tokens (Effective/Total)</span> <span>${totalChatTokens} / ${maxcumulativeTokens}</span></div>
          </div>
          ${
            fileDetailsHTML
              ? `<h4>Files</h4>
                ${fileDetailsHTML}`
              : ""
          }
          ${
            canvasDetailsHTML
              ? `<h4>Canvas</h4>
                ${canvasDetailsHTML}`
              : ""
          }
          <div class="token-total-line">
              <span>Selected Total:</span>
              <span id="popup-total-tokens">${effectiveTotal} / ${maxTotal}</span>
          </div>
      `;
    statusDiv.textContent = `Effective tokens: ${effectiveTotal}/${limit} tokens.`;
    popupDiv.addEventListener("change", async (e) => {
      if (e.target.type === "checkbox") {
        const conversationId = window.location.pathname.split("/")[2];
        if (!conversationId) return;

        const storageKey = `checked_items_${conversationId}`;
        const currentChecked = Array.from(
          popupDiv.querySelectorAll("input:checked")
        ).map((cb) => cb.id);

        await chrome.storage.local.set({ [storageKey]: currentChecked });
        runTokenCheck(); // Re-run the whole check to update the UI
      }
    });
  }

  lastTokenCount = document.body.querySelector(".token-count-display")
    ? totalChatTokens + tokenData.baseTokenCost
    : 0;
}

/**
 * Removes all token count UI elements and resets message styles.
 */
function clearTokenUI() {
  console.log("Clearing token UI...");
  document
    .querySelectorAll(
      ".token-count-display, .extra-token-info, .token-status-container"
    )
    .forEach((el) => el.remove());
  document
    .querySelectorAll('[data-testid^="conversation-turn-"]')
    .forEach((turn) => {
      turn.style.opacity = "1";
    });
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
  const storageKey = `checked_items_${conversationId}`;
  const { [storageKey]: checkedItemsRaw = [] } = await chrome.storage.local.get(
    storageKey
  );
  const checkedItems = new Set(checkedItemsRaw);

  try {
    const [conversationData, additionalDataMap] = await Promise.all([
      getConversationFromDB(conversationId),
      processBackendData(conversationId),
    ]); // After async operations, re-check the URL to ensure the user hasn't navigated away.

    const currentConversationId = window.location.pathname.split("/")[2];
    if (conversationId !== currentConversationId) {
      console.log(
        `Stale data for ${conversationId} ignored; current chat is ${currentConversationId}.`
      );
      return; // Abort the UI update
    }

    if (conversationData && Array.isArray(conversationData.messages)) {
      const tokenData = getEffectiveMessages(
        conversationData.messages,
        contextWindow,
        additionalDataMap,
        checkedItems
      );
      const { effectiveMessages, messagesWithTokens } = tokenData;

      const effectiveMessageIds = new Set(effectiveMessages.map((m) => m.id));
      const effectiveMessageMap = new Map(
        effectiveMessages.map((m) => [m.id, m])
      );

      console.log(
        `📊 TOTAL TOKENS IN CONTEXT for "${conversationData.title}": ${
          tokenData.totalChatTokens + tokenData.baseTokenCost
        } / ${contextWindow}`
      );
      addHoverListeners(
        conversationData.messages,
        effectiveMessageIds,
        effectiveMessageMap,
        contextWindow,
        tokenData,
        messagesWithTokens,
        additionalDataMap,
        checkedItems
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
  // Re-run if the context window or checked items change for the current convo
  const conversationId = window.location.pathname.split("/")[2];
  const checkedItemsKey = `checked_items_${conversationId}`;
  if (changes.contextWindow || (conversationId && changes[checkedItemsKey])) {
    runTokenCheck();
  }
});

const debouncedRunTokenCheck = debounce(runTokenCheck, 3000);
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
      "token-status-container",
      "tokenstatus",
      "token-popup",
      "token-item",
      "@thread-xl/thread:pt-header-height",
      "placeholder",
    ]);
    const ignoredElementParent = ["#thread-bottom"];

    mutationList.forEach((m) => {
      if (skip) return; // Get the parent element, as characterData changes target the text node itself.

      const targetElement =
        m.type === "characterData" ? m.target.parentElement : m.target;

      if (!targetElement || !targetElement.classList) return;

      const classList = targetElement.classList; // Check if the element's class is in the ignore list

      for (const cls of classList) {
        if (ignoredClasses.has(cls)) {
          skip = true;
          break;
        }
      } // Check if the element is inside an ignored parent

      if (!skip) {
        for (const selector of ignoredElementParent) {
          const parent = document.querySelector(selector);
          if (parent && parent.contains(targetElement)) {
            skip = true;
            break;
          }
        }
      }
    });

    if (!skip) debouncedRunTokenCheck();
  }
}).observe(document.body.querySelector("main"), {
  subtree: true,
  childList: true,
  characterData: true,
});
