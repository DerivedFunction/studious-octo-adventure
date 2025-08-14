import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

// This encoder is now available for the entire script
const enc = new Tiktoken(o200k_base);
console.log("✅ Tokenizer initialized.");
let fetchController; // Controller to abort in-flight fetch requests
let accessToken = null; // Global variable to store the access token
let lastCheckState = { url: "", prompt: "", turns: 0, checked: "", tokens: 0 }; // Cache state to avoid redundant checks

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
  console.log("🔑 Fetching new access token...");
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
    console.error("❌ Could not retrieve access token:", error);
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
  const cacheDuration = 3 * 60 * 1000; // 3 minutes
  const maxRetries = 3; // Try to load from cache first

  try {
    const result = await chrome.storage.local.get(storageKey);
    if (result[storageKey]) {
      const cachedData = JSON.parse(result[storageKey]);
      console.log(`🗄️ Using cached backend data for ${conversationId}.`);
      return new Map(Object.entries(cachedData));
    }
  } catch (e) {
    console.error("❌ Error reading from local storage cache:", e);
  } // If no cache, proceed with fetching, including retry logic.

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (fetchController) {
      fetchController.abort();
    }
    fetchController = new AbortController();
    const signal = fetchController.signal;

    try {
      console.log(
        `🌐 Fetching data from backend-api for ${conversationId} (Attempt ${attempt})...`
      );
      const token = await getAccessToken();
      if (!token) {
        console.error("❌ Could not retrieve access token. Aborting retries.");
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
        console.log("❌ Access token expired or invalid. Refreshing...");
        accessToken = null; // Clear the global token to force a refresh
        throw new Error("❌ Authentication failed, retrying...");
      }

      if (!response.ok) {
        throw new Error(
          `❌ Backend API request failed with status: ${response.status}`
        );
      }

      const conversationApiData = await response.json();
      const additionalDataMap = new Map();
      const latestCanvasData = new Map(); // Map<textdoc_id, { version, title, tokens, attachToMessageId }>

      // Pass 1: Collect all canvas versions and identify the latest for each
      if (conversationApiData && conversationApiData.mapping) {
        for (const messageId in conversationApiData.mapping) {
          const node = conversationApiData.mapping[messageId];
          const recipient = node.message?.recipient;
          if (
            recipient === "canmore.create_textdoc" ||
            recipient === "canmore.update_textdoc"
          ) {
            if (node.children && node.children.length > 0) {
              const toolNode = conversationApiData.mapping[node.children[0]];
              if (
                toolNode?.message?.author?.role === "tool" &&
                toolNode.message.metadata.canvas
              ) {
                try {
                  const { textdoc_id, version } =
                    toolNode.message.metadata.canvas;
                  const contentNode = JSON.parse(node.message.content.parts[0]);
                  const title = contentNode.name || "Canvas";
                  const tokens = enc.encode(contentNode.content || "").length;
                  const attachToMessageId = toolNode.children?.[0];

                  if (attachToMessageId) {
                    const existing = latestCanvasData.get(textdoc_id);
                    if (!existing || existing.version < version) {
                      latestCanvasData.set(textdoc_id, {
                        version,
                        title,
                        tokens,
                        attachToMessageId,
                      });
                    }
                  }
                } catch (e) {
                  console.error("Error processing canvas data:", e);
                }
              }
            }
          }
        }

        // Pass 2: Populate additionalDataMap with latest canvas versions and other data
        latestCanvasData.forEach((data, textdoc_id) => {
          const existing = additionalDataMap.get(data.attachToMessageId) || {};
          additionalDataMap.set(data.attachToMessageId, {
            ...existing,
            canvas: {
              title: data.title,
              tokens: data.tokens,
              textdoc_id,
              version: data.version,
            },
          });
        });

        // Pass 3: Process files and custom instructions
        for (const messageId in conversationApiData.mapping) {
          const node = conversationApiData.mapping[messageId];
          if (node.message) {
            const { metadata, content } = node.message;
            let fileInfo = null;
            let customInstructionsInfo = null;
            let targetMessageId = node.message.id;

            if (metadata.attachments && metadata.attachments.length > 0) {
              fileInfo = metadata.attachments.map((file) => ({
                name: file.name,
                tokens: file.file_token_size || 0,
              }));
            }

            if (content.content_type === "user_editable_context") {
              customInstructionsInfo = {
                profile_tokens: enc.encode(content.user_profile || "").length,
                instructions_tokens: enc.encode(content.user_instructions || "")
                  .length,
              };
            }

            if (fileInfo || customInstructionsInfo) {
              const existingData = additionalDataMap.get(targetMessageId) || {};
              additionalDataMap.set(targetMessageId, {
                ...existingData,
                files: fileInfo || existingData.files,
                customInstructions:
                  customInstructionsInfo || existingData.customInstructions,
              });
            }
          }
        }
      }

      try {
        const dataToCache = Object.fromEntries(additionalDataMap);
        await chrome.storage.local.set({
          [storageKey]: JSON.stringify(dataToCache),
        });
        console.log(
          `💾 Cached backend data for ${conversationId}. It will be removed in ${
            cacheDuration / 1000
          }s.`
        );

        setTimeout(() => {
          chrome.storage.local.remove(storageKey, () => {
            console.log(`🗑️ Cache for ${conversationId} has been cleared.`);
          });
        }, cacheDuration);
      } catch (e) {
        console.error("❌ Error writing to local storage cache:", e);
      }

      console.log("✅ Backend data processed.", additionalDataMap);
      return additionalDataMap; // Success, return the data
    } catch (error) {
      if (error.name === "AbortError") {
        console.console.error("❌ Fetch aborted for previous conversation.");
        return new Map(); // Don't retry on abort
      }
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) {
        console.error("❌ All fetch attempts failed.");
        return new Map(); // Return empty map after all retries fail
      }
      await new Promise((res) => setTimeout(res, 500)); // Wait before retrying
    }
  }
  return new Map(); // Fallback return
}

/**
 * Processes the full message history, attachments, and prompt to determine what fits
 * within the defined context window limit based on user selections.
 * @param {Array<object>} allMessages - The complete list of messages from the DB.
 * @param {number} limit - The context window token limit.
 * @param {Map<string, object>} additionalDataMap - Map with file and canvas token data.
 * @param {Set<string>} checkedItems - A set of IDs for checked files/canvases.
 * @param {number} promptTokens - The token count of the current user input in the prompt box.
 * @returns {object} An object containing the effective messages and token breakdown.
 */
function getEffectiveMessages(
  allMessages,
  limit,
  additionalDataMap,
  checkedItems,
  promptTokens = 0
) {
  const messagesWithTokens = allMessages.map((msg) => ({
    ...msg,
    tokens: (msg.text || "").trim() ? enc.encode(msg.text).length : 0,
  }));

  let currentTotalTokens = 0;
  const truncatedItems = new Set();

  // --- Result variables ---
  let instructionsCost = 0;
  let instructionsTruncatedFrom = null;
  let promptCost = 0;
  let promptTruncatedFrom = null;
  let attachmentsCost = 0;
  let totalChatTokens = 0;
  const effectiveMessages = [];
  let maxPossibleTokens = promptTokens;
  messagesWithTokens.forEach((msg) => (maxPossibleTokens += msg.tokens));

  // --- 1. Custom Instructions ---
  additionalDataMap.forEach((data) => {
    if (data.customInstructions) {
      const instrTokens =
        data.customInstructions.profile_tokens +
        data.customInstructions.instructions_tokens;
      maxPossibleTokens += instrTokens;
      if (instrTokens > 0) {
        if (instrTokens > limit) {
          instructionsCost = limit;
          instructionsTruncatedFrom = instrTokens;
          currentTotalTokens = limit;
        } else {
          instructionsCost = instrTokens;
          currentTotalTokens += instrTokens;
        }
      }
    }
  });

  // --- 2. User Prompt ---
  if (currentTotalTokens < limit && promptTokens > 0) {
    const remainingSpace = limit - currentTotalTokens;
    if (promptTokens > remainingSpace) {
      promptCost = remainingSpace;
      promptTruncatedFrom = promptTokens;
      currentTotalTokens = limit;
    } else {
      promptCost = promptTokens;
      currentTotalTokens += promptTokens;
    }
  }

  // --- 3. Files & Canvases ---
  if (currentTotalTokens < limit) {
    additionalDataMap.forEach((data, msgId) => {
      if (currentTotalTokens >= limit) return;

      if (data.files) {
        data.files.forEach((file, index) => {
          if (currentTotalTokens >= limit) return;
          const itemId = `file-${msgId}-${index}`;
          if (checkedItems.has(itemId)) {
            maxPossibleTokens += file.tokens;
            const remainingSpace = limit - currentTotalTokens;
            if (file.tokens > remainingSpace) {
              truncatedItems.add(itemId);
              attachmentsCost += remainingSpace;
              currentTotalTokens = limit;
            } else {
              attachmentsCost += file.tokens;
              currentTotalTokens += file.tokens;
            }
          }
        });
      }

      if (currentTotalTokens >= limit) return;

      if (data.canvas) {
        const itemId = `canvas-${data.canvas.textdoc_id}`;
        if (checkedItems.has(itemId)) {
          maxPossibleTokens += data.canvas.tokens;
          const remainingSpace = limit - currentTotalTokens;
          if (data.canvas.tokens > remainingSpace) {
            truncatedItems.add(itemId);
            attachmentsCost += remainingSpace;
            currentTotalTokens = limit;
          } else {
            attachmentsCost += data.canvas.tokens;
            currentTotalTokens += data.canvas.tokens;
          }
        }
      }
    });
  }

  // --- 4. Chat History ---
  if (currentTotalTokens < limit) {
    const remainingForChat = limit - currentTotalTokens;
    for (let i = messagesWithTokens.length - 1; i >= 0; i--) {
      const message = messagesWithTokens[i];
      if (message.tokens === 0) continue;

      const spaceAvailable = remainingForChat - totalChatTokens;
      if (spaceAvailable <= 0) break;

      if (message.tokens <= spaceAvailable) {
        totalChatTokens += message.tokens;
        effectiveMessages.unshift(message);
      } else {
        message.isTruncated = true;
        message.truncatedTokens = spaceAvailable;
        totalChatTokens += spaceAvailable;
        effectiveMessages.unshift(message);
        break;
      }
    }
  }

  const baseTokenCost = instructionsCost + promptCost + attachmentsCost;

  return {
    effectiveMessages,
    totalChatTokens,
    messagesWithTokens,
    baseTokenCost,
    truncatedItems,
    promptCost,
    promptTruncatedFrom,
    instructionsCost,
    instructionsTruncatedFrom,
    maxPossibleTokens,
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
  style.textContent = `
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
    console.log("⌛ Elements still loading.");
    debouncedRunTokenCheck();
    return;
  }

  let cumulativeTokens = 0;
  let maxcumulativeTokens = 0;
  console.log("💻 Updating token UI...");
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
    } // Clear existing content safely

    while (extraInfoDiv.firstChild) {
      extraInfoDiv.removeChild(extraInfoDiv.firstChild);
    }

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
      const fragment = document.createDocumentFragment();
      if (extraData.files) {
        extraData.files.forEach((file) => {
          const div = document.createElement("div");
          div.textContent = `📎 ${file.name} (${file.tokens} tokens)`;
          fragment.appendChild(div);
        });
      }
      if (extraData.canvas) {
        const div = document.createElement("div");
        div.textContent = `🎨 ${extraData.canvas.title} (${extraData.canvas.tokens} tokens)`;
        fragment.appendChild(div);
      }
      extraInfoDiv.appendChild(fragment);
    }
  }); // --- Status Div with Hover Popup ---

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
      statusDiv.className = "tokenstatus"; // Applying styles via JS
      Object.assign(statusDiv.style, {
        display: "inline-block",
        marginLeft: "8px",
        fontSize: "12px",
        color: "var(--text-secondary)",
        fontWeight: "normal",
      });
      statusContainer.appendChild(statusDiv);
    }

    let popupDiv = statusContainer.querySelector(".token-popup");
    if (!popupDiv) {
      popupDiv = document.createElement("div");
      popupDiv.className = "token-popup";
      statusContainer.appendChild(popupDiv);
    } // Clear previous popup content safely

    while (popupDiv.firstChild) {
      popupDiv.removeChild(popupDiv.firstChild);
    } // Use a DocumentFragment to build the new popup content

    const popupFragment = document.createDocumentFragment();

    const createTokenItem = (labelContent, valueContent) => {
      const itemDiv = document.createElement("div");
      itemDiv.className = "token-item";
      const labelSpan = document.createElement("span");
      labelSpan.textContent = labelContent;
      const valueSpan = document.createElement("span");
      valueSpan.textContent = valueContent;
      itemDiv.appendChild(labelSpan);
      itemDiv.appendChild(valueSpan);
      return itemDiv;
    }; // -- Build Static and Conditional Sections --

    let h4 = document.createElement("h4");
    h4.textContent = "Token Breakdown";
    popupFragment.appendChild(h4);

    const promptSection = document.createElement("div");
    promptSection.className = "token-section";
    const originalPromptTokens =
      tokenData.promptTruncatedFrom !== null
        ? tokenData.promptTruncatedFrom
        : tokenData.promptCost;
    const effectivePromptTokens = tokenData.promptCost;
    
    let promptValue = originalPromptTokens;
    if (tokenData.promptTruncatedFrom !== null) {
      promptValue = `${effectivePromptTokens} / ${originalPromptTokens}`;
    }
    const promptLabel = `📝 Current Prompt ${
      tokenData.promptTruncatedFrom !== null ? "(Effective/Total)" : ""
    }`;
    promptSection.appendChild(createTokenItem(promptLabel, promptValue));
    popupFragment.appendChild(promptSection);

    const chatSection = document.createElement("div");
    chatSection.className = "token-section";
    chatSection.appendChild(
      createTokenItem(
        "💬 Chat History (Effective/Total)",
        `${totalChatTokens} / ${maxcumulativeTokens}`
      )
    );
    popupFragment.appendChild(chatSection);

    const customInstructionsSection = document.createElement("div");
    customInstructionsSection.className = "token-section";
    let hasInstructions = false;

    additionalDataMap.forEach((data) => {
      if (data.customInstructions) {
        hasInstructions = true;
        customInstructionsSection.appendChild(
          createTokenItem(
            "👤 User Profile",
            data.customInstructions.profile_tokens
          )
        );
        customInstructionsSection.appendChild(
          createTokenItem(
            "🤖 Model Instructions",
            data.customInstructions.instructions_tokens
          )
        );
      }
    });

    if (hasInstructions) {
      h4 = document.createElement("h4");
      h4.textContent = "Custom Instructions";
      if (tokenData.instructionsTruncatedFrom) {
        const truncatedSpan = document.createElement("span");
        truncatedSpan.className = "truncated-text";
        truncatedSpan.textContent = ` (Overflow: ${tokenData.instructionsCost}/${tokenData.instructionsTruncatedFrom})`;
        h4.appendChild(truncatedSpan);
      }
      popupFragment.appendChild(h4);
      popupFragment.appendChild(customInstructionsSection);
    }

    const filesFragment = document.createDocumentFragment();
    const canvasFragment = document.createDocumentFragment();

    additionalDataMap.forEach((data, msgId) => {
      if (data.files) {
        data.files.forEach((f, index) => {
          const id = `file-${msgId}-${index}`;
          const itemDiv = document.createElement("div");
          itemDiv.className = "token-item";
          const label = document.createElement("label");
          label.htmlFor = id;
          label.title = f.name;
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.id = id;
          checkbox.checked = checkedItems.has(id);
          checkbox.dataset.type = "file";
          checkbox.dataset.tokens = f.tokens;
          label.appendChild(checkbox);
          label.append(` 📎 ${f.name} `);
          if (truncatedItems.has(id)) {
            const truncatedSpan = document.createElement("span");
            truncatedSpan.className = "truncated-text";
            truncatedSpan.textContent = "(Truncated)";
            label.appendChild(truncatedSpan);
          }
          const valueSpan = document.createElement("span");
          valueSpan.textContent = f.tokens;
          itemDiv.appendChild(label);
          itemDiv.appendChild(valueSpan);
          filesFragment.appendChild(itemDiv);
        });
      }
      if (data.canvas) {
        const id = `canvas-${data.canvas.textdoc_id}`;
        const itemDiv = document.createElement("div");
        itemDiv.className = "token-item";
        const label = document.createElement("label");
        label.htmlFor = id;
        label.title = `${data.canvas.title} (v${data.canvas.version})`;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = id;
        checkbox.checked = checkedItems.has(id);
        checkbox.dataset.type = "canvas";
        checkbox.dataset.tokens = data.canvas.tokens;
        label.appendChild(checkbox);
        label.append(` 🎨 ${data.canvas.title} `);
        if (truncatedItems.has(id)) {
          const truncatedSpan = document.createElement("span");
          truncatedSpan.className = "truncated-text";
          truncatedSpan.textContent = "(Truncated)";
          label.appendChild(truncatedSpan);
        }
        const valueSpan = document.createElement("span");
        valueSpan.textContent = data.canvas.tokens;
        itemDiv.appendChild(label);
        itemDiv.appendChild(valueSpan);
        canvasFragment.appendChild(itemDiv);
      }
    });

    if (filesFragment.hasChildNodes()) {
      h4 = document.createElement("h4");
      h4.textContent = "Files";
      popupFragment.appendChild(h4);
      popupFragment.appendChild(filesFragment);
    }
    if (canvasFragment.hasChildNodes()) {
      h4 = document.createElement("h4");
      h4.textContent = "Canvas";
      popupFragment.appendChild(h4);
      popupFragment.appendChild(canvasFragment);
    } // -- Footer and Totals --

    const effectiveTotal = tokenData.baseTokenCost + totalChatTokens;

    const totalLine = document.createElement("div");
    totalLine.className = "token-total-line";
    const totalLabel = document.createElement("span");
    totalLabel.textContent = "Total tokens:";
    const totalValue = document.createElement("span");
    totalValue.id = "popup-total-tokens";
    totalValue.textContent = `${effectiveTotal} / ${limit}`;
    totalLine.appendChild(totalLabel);
    totalLine.appendChild(totalValue);
    popupFragment.appendChild(totalLine);

    const refreshLine = document.createElement("div");
    refreshLine.className = "token-total-line";
    refreshLine.id = "refreshData";
    refreshLine.textContent = "Refresh";
    Object.assign(refreshLine.style, {
      cursor: "pointer",
      flexDirection: "row-reverse",
    });
    popupFragment.appendChild(refreshLine); // Append the fully constructed fragment to the DOM

    popupDiv.appendChild(popupFragment);

    statusDiv.textContent = `Effective tokens: ${effectiveTotal}/${limit}`;

    const conversationId = window.location.pathname.split("/")[2];
    popupDiv.addEventListener("change", async (e) => {
      if (e.target.type === "checkbox") {
        if (!conversationId) return;
        const storageKey = `checked_items_${conversationId}`;
        const currentChecked = Array.from(
          popupDiv.querySelectorAll("input:checked")
        ).map((cb) => cb.id);
        await chrome.storage.local.set({ [storageKey]: currentChecked });
      }
    });

    popupDiv.addEventListener("click", async (e) => {
      if (e.target.id === "refreshData") {
        e.target.textContent = "Refreshing...";
        await chrome.storage.local.remove(`backend_data_${conversationId}`);
        debouncedRunTokenCheck();
      }
    });
  }
}

/**
 * Updates the UI element showing the token count for the prompt box.
 * @param {number} promptCost - The number of tokens for the current prompt.
 * @param {number|null} promptTruncatedFrom - The original token count if truncated.
 * @param {number} limit - The context window limit.
 */
function updatePromptTokenUI(promptCost, promptTruncatedFrom, limit) {
  const form = document.querySelector("form");
  if (!form) return;

  const parent = form.querySelector("div");
  if (!parent) return;

  let promptTokenDiv = parent.querySelector(".prompt-token-count");
  if (!promptTokenDiv) {
    promptTokenDiv = document.createElement("div");
    promptTokenDiv.className = "prompt-token-count";
    Object.assign(promptTokenDiv.style, {
      textAlign: "right",
      fontSize: "11px",
      color: "var(--text-secondary)",
      padding: "4px 12px 0 0",
      height: "20px",
      transition: "color 0.3s ease",
    });
    const buttonContainer = parent.querySelector("div:last-child");
    if (buttonContainer) {
      parent.insertBefore(promptTokenDiv, buttonContainer);
    } else {
      parent.appendChild(promptTokenDiv);
    }
  }

  const originalPromptTokens =
    promptTruncatedFrom !== null ? promptTruncatedFrom : promptCost;
  if (originalPromptTokens > 0) {
    let text = `Prompt: ${originalPromptTokens} tokens`;
    if (promptTruncatedFrom) {
      text = `Prompt: ${promptCost} / ${originalPromptTokens} tokens (Overflow)`;
      promptTokenDiv.style.color = "var(--text-danger)";
    } else {
      promptTokenDiv.style.color = "var(--text-secondary)";
    }
    promptTokenDiv.textContent = text;
  } else {
    promptTokenDiv.textContent = "";
  }
}

/**
 * Removes all token count UI elements and resets message styles.
 */
function clearTokenUI() {
  console.log("🗑️ Clearing token UI...");
  document
    .querySelectorAll(
      ".token-count-display, .extra-token-info, .token-status-container, .prompt-token-count"
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
  const { contextWindow, isScriptingEnabled } = await chrome.storage.local.get(["contextWindow", "isScriptingEnabled"]);
  console.log(contextWindow, isScriptingEnabled)
  if (contextWindow === 0 || !isScriptingEnabled) {
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

  const promptBox = document.querySelector("[contenteditable='true']");
  const promptText = promptBox ? promptBox.textContent || "" : "";
  const turnCount = document.querySelectorAll(
    '[data-testid^="conversation-turn-"]'
  ).length;
  const checkedItemsStr = JSON.stringify(Array.from(checkedItems).sort());

  const newState = {
    url: window.location.href,
    prompt: promptText,
    turns: turnCount,
    checked: checkedItemsStr,
    contextWindow,
  };

  if (
    Object.values(lastCheckState) === Object.values(newState) &&
    checkedItemsStr === lastCheckState.checked
  ) {
    return; // No meaningful change detected, skip the check
  }
  lastCheckState = newState;

  try {
    const [conversationData, additionalDataMap] = await Promise.all([
      getConversationFromDB(conversationId),
      processBackendData(conversationId),
    ]);

    const currentConversationId = window.location.pathname.split("/")[2];
    if (conversationId !== currentConversationId) {
      console.log(
        `🗑️ Stale data for ${conversationId} ignored; current chat is ${currentConversationId}.`
      );
      return;
    }

    if (conversationData && Array.isArray(conversationData.messages)) {
      const promptTokens = enc.encode(promptText).length;
      const tokenData = getEffectiveMessages(
        conversationData.messages,
        contextWindow,
        additionalDataMap,
        checkedItems,
        promptTokens
      );
      const { effectiveMessages, messagesWithTokens } = tokenData;

      const effectiveMessageIds = new Set(effectiveMessages.map((m) => m.id));
      const effectiveMessageMap = new Map(
        effectiveMessages.map((m) => [m.id, m])
      );

      const totalEffectiveTokens =
        tokenData.baseTokenCost + tokenData.totalChatTokens;
      console.log(
        `📊 TOTAL TOKENS IN CONTEXT for "${conversationData.title}": ${totalEffectiveTokens} / ${contextWindow}`
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

      updatePromptTokenUI(
        tokenData.promptCost,
        tokenData.promptTruncatedFrom,
        contextWindow
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
  if (changes.isScriptingEnabled) {
    applyTheme();
    runTokenCheck();
    return;
  }
  if (
    changes.themeObject ||
    changes.isThemeActive
  ) {
    applyTheme();
  }
  const conversationId = window.location.pathname.split("/")[2];
  const checkedItemsKey = `checked_items_${conversationId}`;
  if (changes.contextWindow || (conversationId && changes[checkedItemsKey])) {
    runTokenCheck();
  }
});

const debouncedRunTokenCheck = debounce(runTokenCheck, 3000);
debouncedRunTokenCheck();
function clearOldCache() {
  console.log("🗑️ Clearing old cache...");
  chrome.storage.local.get(null, (items) => {
    for (const key in items) {
      if (key.startsWith("backend_data_")) {
        chrome.storage.local.remove(key);
      }
    }
  });
}
clearOldCache();
let lastUrl = location.href;
new MutationObserver((mutationList) => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    lastCheckState = { url: "", prompt: "", turns: 0, checked: "", contextWindow: 0 }; // Reset state on URL change
    console.log("🔄 URL changed, running token check immediately.");
    runTokenCheck();
  } else {
    let skip = false;
    const ignoredClasses = new Set([
      "extra-token-info",
      "token-count-display",
      "token-status-container",
      "tokenstatus",
      "token-popup",
      "truncated-text",
      "token-item",
      "prompt-token-count",
      "@thread-xl/thread:pt-header-height",
      "placeholder",
    ]);
    const ignoredElementParent = [];

    mutationList.forEach((m) => {
      if (skip) return;

      const targetElement =
        m.type === "characterData" ? m.target.parentElement : m.target;

      if (!targetElement || !targetElement.classList) return;

      const classList = targetElement.classList;
      for (const cls of classList) {
        if (ignoredClasses.has(cls)) {
          skip = true;
          break;
        }
      }

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
