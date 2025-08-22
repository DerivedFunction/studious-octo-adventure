import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
window.tokenizer = (() => {
  const enc = new Tiktoken(o200k_base);
  console.log("✅ [Token Manager] Tokenizer initialized.");
  /**
   * Backend methods for ChatGPT
    @function getApiData() returns API data json of data 
    @var apiData = {
      metaData,
      userProfile,
      userMemory,
      turnMapData,
      toolMapData,
      messageMapData,
      imageMapData,
      canvasMapData,
      reasoningMapData,
      fileMapData,
    }; Each MapData has {key: turnId, value: []}
    @function  convertExport Uses apiData to convert file to export
    exportData = {
        markdown,
        jsonAPI,
        jsonCopy,
        jsonData,
        canvasMapData,
        metaData,
      };
    @function  getAccessToken,
    @function  getImageDownloadUrl
    @function  getConversationId,
    @function  getUserMemory,
    @var userMemory
    @var accessToken
    @var conversationId
    @var apiData // Finished apiData
    @var exportData // Finished exportData
   */
  let lastCheckState = {};

  let db; // To hold the database instance
  let apiData = null;
  const DB_NAME = "TokenManagerCacheDB";
  const DB_VERSION = 3; // << UPDATED DB Version
  const API_STORE_NAME = "conversationApiCache";
  const CHECKED_ITEMS_STORE_NAME = "checkedItemsCache"; // << NEW STORE for checked items

  /**
   * Opens and initializes the IndexedDB for caching.
   * @returns {Promise<IDBDatabase>} The database instance.
   */
  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = (e) => reject("IndexedDB error: " + e.target.errorCode);
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      request.onupgradeneeded = (e) => {
        const dbInstance = e.target.result;
        // Create store for API data if it doesn't exist
        if (!dbInstance.objectStoreNames.contains(API_STORE_NAME)) {
          dbInstance.createObjectStore(API_STORE_NAME, { keyPath: "id" });
        }
        // Create store for checked items if it doesn't exist
        if (!dbInstance.objectStoreNames.contains(CHECKED_ITEMS_STORE_NAME)) {
          dbInstance.createObjectStore(CHECKED_ITEMS_STORE_NAME, {
            keyPath: "id",
          });
        }
      };
    });
  }

  // --- IndexedDB Helper Functions for API Cache ---
  async function getCacheFromDB(id) {
    const db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(API_STORE_NAME, "readonly");
      const store = transaction.objectStore(API_STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async function setCacheInDB(id, data) {
    const db = await openDB();
    const transaction = db.transaction(API_STORE_NAME, "readwrite");
    const store = transaction.objectStore(API_STORE_NAME);
    store.put({ id, data, timestamp: Date.now() });
  }

  async function deleteCacheFromDB(id) {
    const db = await openDB();
    const transaction = db.transaction(API_STORE_NAME, "readwrite");
    const store = transaction.objectStore(API_STORE_NAME);
    store.delete(id);
  }

  // --- IndexedDB Helper Functions for Checked Items Cache ---
  /**
   * Retrieves the set of checked items for a conversation from IndexedDB.
   * @param {string} id The conversation ID.
   * @returns {Promise<Set<string>>} A promise that resolves with the set of checked item IDs.
   */
  async function getCheckedItemsFromDB(id) {
    const db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(CHECKED_ITEMS_STORE_NAME, "readonly");
      const store = transaction.objectStore(CHECKED_ITEMS_STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        // Return a new Set from the stored array, or an empty set if not found
        resolve(new Set(request.result?.checkedItems || []));
      };
      request.onerror = () => resolve(new Set()); // Resolve with an empty set on error
    });
  }

  /**
   * Stores the set of checked items for a conversation in IndexedDB.
   * @param {string} id The conversation ID.
   * @param {Set<string>} checkedItems The set of checked item IDs to store.
   */
  async function setCheckedItemsInDB(id, checkedItems) {
    const db = await openDB();
    const transaction = db.transaction(CHECKED_ITEMS_STORE_NAME, "readwrite");
    const store = transaction.objectStore(CHECKED_ITEMS_STORE_NAME);
    // Convert Set to an Array for storage
    store.put({ id, checkedItems: Array.from(checkedItems) });
  }

  // --- UI & TOKEN CALCULATION LOGIC (Ported & Refactored) ---

  /**
   * Injects CSS for the hover popup into the document head.
   */
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
      border-radius: 12px; 
      padding: 16px; 
      width: 400px; 
      z-index: 1000; 
      box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08); 
      color: var(--text-secondary); 
      font-size: 13px; 
      text-align: left; 
      line-height: 1.4;
    }
    .token-popup h4 { 
      margin: 0 0 12px 0; 
      font-weight: 600; 
      color: var(--text-primary); 
      border-bottom: 1px solid var(--border-light); 
      padding-bottom: 8px; 
      font-size: 14px;
    }
    .token-popup .token-section { 
      margin-bottom: 12px; 
    }
    .token-popup .token-section:last-child { 
      margin-bottom: 0; 
    }
    .token-popup .token-item { 
      display: flex; 
      align-items: center; 
      justify-content: space-between; 
      padding: 6px 0;
      min-height: 24px;
    }
    .token-popup .token-item:hover {
      background-color: var(--surface-hover);
      border-radius: 6px;
      margin: 0 -8px;
      padding: 6px 8px;
    }
    .token-popup .token-item label { 
      display: flex; 
      align-items: center; 
      white-space: nowrap; 
      overflow: hidden; 
      text-overflow: ellipsis; 
      margin-right: 12px; 
      cursor: pointer;
      flex: 1;
      font-size: 13px;
    }
    .token-popup .token-item input { 
      margin-right: 8px; 
      cursor: pointer;
      accent-color: var(--selection);
    }
    .token-popup .token-item span:last-child { 
      font-weight: 600; 
      white-space: nowrap; 
      color: var(--text-primary);
      font-size: 13px;
    }
    .token-popup .token-total-line { 
      font-weight: 600; 
      display: flex; 
      justify-content: space-between; 
      margin-top: 12px; 
      padding-top: 12px; 
      border-top: 1px solid var(--border-light);
      color: var(--text-primary);
    }
    .token-popup hr {
      border: none;
      border-top: 1px solid var(--border-light);
      margin: 12px 0;
    }
    .truncated-text { 
      font-style: italic; 
      color: var(--text-tertiary); 
      margin-left: 6px; 
    }
    .token-popup #refreshData {
      cursor: pointer;
      text-align: right;
      margin-top: 8px;
      color: var(--link);
      font-size: 12px;
      padding: 4px 0;
    }
    .token-popup #refreshData:hover {
      color: var(--link-hover);
      text-decoration: underline;
    }
  `;
    document.head.appendChild(style);
  }

  /**
   * Processes all data to determine what fits within the context window.
   * @param {object} apiData - The complete data object from ChatGPTDataExport.
   * @param {number} limit - The context window token limit.
   * @param {Set<string>} checkedItems - A set of IDs for checked files/canvases.
   * @param {number} promptTokens - The token count of the current user input.
   * @param {number} globalSystemPromptTokens - The token count of the global system prompt.
   * @param {number} memoryTokens - The token count of the user's memory.
   * @returns {object} An object containing the effective messages and token breakdown.
   */
  function getEffectiveMessages(
    apiData,
    limit,
    checkedItems,
    promptTokens = 0,
    globalSystemPromptTokens = 0,
    memoryTokens = 0
  ) {
    const allMessages = [...apiData.messageMapData.values()].flat();
    const messagesWithTokens = allMessages.map((msg) => ({
      ...msg,
      tokens: ((msg.text || "").trim() ? enc.encode(msg.text).length : 0) + 4,
    }));

    let currentTotalTokens = 0;
    const truncatedItems = new Map();

    let globalSystemPromptCost = 0,
      globalSystemPromptTruncatedFrom = null,
      memoryCost = 0,
      memoryTruncatedFrom = null,
      instructionsCost = 0,
      instructionsTruncatedFrom = null,
      toolInstructionCost = 0,
      toolInstructionTruncatedFrom = null,
      promptCost = 0,
      promptTruncatedFrom = null,
      attachmentsCost = 0,
      totalChatTokens = 0,
      maxChatTokens = 0;
    const effectiveMessages = [];
    let maxPossibleTokens = promptTokens;
    messagesWithTokens.forEach((msg) => {
      maxPossibleTokens += msg.tokens;
      maxChatTokens += msg.tokens;
    });

    // 0. Global System Prompt
    maxPossibleTokens += globalSystemPromptTokens;
    if (globalSystemPromptTokens > 0) {
      if (currentTotalTokens < limit) {
        const remainingSpace = limit - currentTotalTokens;
        if (globalSystemPromptTokens > remainingSpace) {
          globalSystemPromptCost = remainingSpace;
          globalSystemPromptTruncatedFrom = globalSystemPromptTokens;
          currentTotalTokens = limit;
        } else {
          globalSystemPromptCost = globalSystemPromptTokens;
          currentTotalTokens += globalSystemPromptTokens;
        }
      } else {
        // No space remaining
        globalSystemPromptCost = 0;
        globalSystemPromptTruncatedFrom = globalSystemPromptTokens;
      }
    }

    // 0.5. Memory
    maxPossibleTokens += memoryTokens;
    if (memoryTokens > 0) {
      if (currentTotalTokens < limit) {
        const remainingSpace = limit - currentTotalTokens;
        if (memoryTokens > remainingSpace) {
          memoryCost = remainingSpace;
          memoryTruncatedFrom = memoryTokens;
          currentTotalTokens = limit;
        } else {
          memoryCost = memoryTokens;
          currentTotalTokens += memoryTokens;
        }
      } else {
        // No space remaining
        memoryCost = 0;
        memoryTruncatedFrom = memoryTokens;
      }
    }

    // 1. Custom Instructions
    let instrTokens = 0;
    if (apiData.userProfile) {
      instrTokens =
        enc.encode(apiData.userProfile.user_profile || "").length +
        enc.encode(apiData.userProfile.user_instructions || "").length;
      maxPossibleTokens += instrTokens;
      if (instrTokens > 0) {
        if (currentTotalTokens < limit) {
          const remainingSpace = limit - currentTotalTokens;
          if (instrTokens > remainingSpace) {
            instructionsCost = remainingSpace;
            instructionsTruncatedFrom = instrTokens;
            currentTotalTokens = limit;
          } else {
            instructionsCost = instrTokens;
            currentTotalTokens += instrTokens;
          }
        } else {
          // No space remaining
          instructionsCost = 0;
          instructionsTruncatedFrom = instrTokens;
        }
      }
    }

    // 1.5 Tool Instructions (Hidden Tool Output)
    const totalToolInstructionTokens = [...apiData.toolMapData.values()]
      .flat()
      .reduce((acc, tool) => {
        const instruction = tool?.instruction;

        if (Array.isArray(instruction)) {
          return (
            acc +
            instruction.reduce(
              (sum, str) =>
                sum +
                (typeof str === "string" ? enc.encode(str.trim()).length : 0),
              0
            )
          );
        }
        if (typeof instruction === "string") {
          return acc + enc.encode(instruction.trim()).length;
        }
        return acc;
      }, 0);
    maxPossibleTokens += totalToolInstructionTokens;
    if (totalToolInstructionTokens > 0) {
      if (currentTotalTokens < limit) {
        const remainingSpace = limit - currentTotalTokens;
        if (totalToolInstructionTokens > remainingSpace) {
          toolInstructionCost = remainingSpace;
          toolInstructionTruncatedFrom = totalToolInstructionTokens;
          currentTotalTokens = limit;
        } else {
          toolInstructionCost = totalToolInstructionTokens;
          currentTotalTokens += totalToolInstructionTokens;
        }
      } else {
        // No space remaining
        toolInstructionCost = 0;
        toolInstructionTruncatedFrom = totalToolInstructionTokens;
      }
    }

    // 2. User Prompt
    if (promptTokens > 0) {
      if (currentTotalTokens < limit) {
        const remainingSpace = limit - currentTotalTokens;
        if (promptTokens > remainingSpace) {
          promptCost = remainingSpace;
          promptTruncatedFrom = promptTokens;
          currentTotalTokens = limit;
        } else {
          promptCost = promptTokens;
          currentTotalTokens += promptTokens;
        }
      } else {
        // No space remaining
        promptCost = 0;
        promptTruncatedFrom = promptTokens;
      }
    }

    // 3. Files & Canvases
    [...apiData.fileMapData.entries()].forEach(([messageId, files]) => {
      files.forEach((file, index) => {
        const itemId = `file-${file.id}-(${index})`;
        if (checkedItems.has(itemId)) {
          const fileTokens = file.file_token_size || 0;
          maxPossibleTokens += fileTokens;

          if (currentTotalTokens < limit) {
            const remainingSpace = limit - currentTotalTokens;
            if (fileTokens > remainingSpace) {
              // File is truncated - only part of it fits
              truncatedItems.set(itemId, remainingSpace);
              attachmentsCost += remainingSpace;
              currentTotalTokens = limit;
            } else {
              // File fits completely
              attachmentsCost += fileTokens;
              currentTotalTokens += fileTokens;
            }
          } else {
            // No space remaining - file gets 0 tokens but is still truncated
            truncatedItems.set(itemId, 0);
          }
        }
      });
    });

    [...apiData.canvasMapData.entries()].forEach(([messageId, canvases]) => {
      canvases.forEach((canvas) => {
        const itemId = `textdoc-${canvas.textdoc_id}-(v${canvas.version})`;
        if (checkedItems.has(itemId)) {
          const canvasTokens = enc.encode(canvas.content || "").length;
          maxPossibleTokens += canvasTokens;

          if (currentTotalTokens < limit) {
            const remainingSpace = limit - currentTotalTokens;
            if (canvasTokens > remainingSpace) {
              // Canvas is truncated - only part of it fits
              truncatedItems.set(itemId, remainingSpace);
              attachmentsCost += remainingSpace;
              currentTotalTokens = limit;
            } else {
              // Canvas fits completely
              attachmentsCost += canvasTokens;
              currentTotalTokens += canvasTokens;
            }
          } else {
            // No space remaining - canvas gets 0 tokens but is still truncated
            truncatedItems.set(itemId, 0);
          }
        }
      });
    });

    // 4. Chat History
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

    const baseTokenCost =
      globalSystemPromptCost +
      memoryCost +
      instructionsCost +
      toolInstructionCost +
      promptCost +
      attachmentsCost;

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
      toolInstructionCost,
      toolInstructionTruncatedFrom,
      globalSystemPromptCost,
      globalSystemPromptTruncatedFrom,
      memoryCost,
      memoryTruncatedFrom,
      maxPossibleTokens,
      maxChatTokens,
    };
  }

  /**
   * Updates the UI element showing the token count for the prompt box.
   * @param {number} promptCost - The number of tokens for the current prompt.
   * @param {number|null} promptTruncatedFrom - The original token count if truncated.
   */
  function updatePromptTokenUI(promptCost, promptTruncatedFrom) {
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
      promptTokenDiv.style.color = "var(--text-secondary)";
      if (promptTruncatedFrom) {
        text = `Prompt: ${promptCost} / ${originalPromptTokens} tokens (Overflow)`;
      }
      promptTokenDiv.textContent = text;
    } else {
      promptTokenDiv.textContent = "";
    }
  }

  /**
   * Attaches a token count display to each chat bubble and the summary status.
   */
  function addHoverListeners(
    allMessages,
    effectiveMessageIds,
    effectiveMessageMap,
    limit,
    tokenData,
    messagesWithTokens,
    apiData,
    checkedItems,
    isMemoryEnabled
  ) {
    injectPopupCSS();

    const { totalChatTokens, truncatedItems, maxChatTokens } = tokenData;
    const turnElements = document.querySelectorAll("[data-message-id]");
    if (!turnElements.length) {
      debouncedRunTokenCheck();
      return;
    }

    let cumulativeTokens = 0;
    console.log("💻 [Token Manager] Updating token UI...");
    const allMessagesMap = new Map(allMessages.map((m) => [m.messageId, m]));

    turnElements.forEach((turnElement) => {
      const messageId = turnElement.dataset.messageId;
      const originalMessageData = allMessagesMap.get(messageId);
      if (!originalMessageData) return;

      let tokenCountDiv = turnElement.querySelector(".token-count-display");
      if (!tokenCountDiv) {
        tokenCountDiv = document.createElement("div");
        tokenCountDiv.className = "token-count-display";
        Object.assign(tokenCountDiv.style, {
          display: "inline-block",
          marginLeft: "8px",
          fontSize: "12px",
          color: "var(--text-secondary)",
          fontWeight: "normal",
        });
        turnElement.appendChild(tokenCountDiv);
      }

      let extraInfoDiv = turnElement.querySelector(".extra-token-info");
      if (!extraInfoDiv) {
        extraInfoDiv = document.createElement("div");
        extraInfoDiv.className = "extra-token-info";
        Object.assign(extraInfoDiv.style, {
          marginTop: "4px",
          fontSize: "11px",
          color: "var(--text-tertiary)",
        });
        tokenCountDiv.parentNode.insertBefore(
          extraInfoDiv,
          tokenCountDiv.nextSibling
        );
      }
      extraInfoDiv.innerHTML = "";

      if (effectiveMessageIds.has(originalMessageData.messageId)) {
        const effectiveMessageData = effectiveMessageMap.get(
          originalMessageData.messageId
        );
        const messageTokenCount = effectiveMessageData.isTruncated
          ? effectiveMessageData.truncatedTokens
          : effectiveMessageData.tokens;
        cumulativeTokens += messageTokenCount;
        tokenCountDiv.textContent =
          messageTokenCount > 0
            ? `${messageTokenCount} of ${cumulativeTokens}/${limit} tokens. ${
                effectiveMessageData.isTruncated
                  ? `Truncated from ${effectiveMessageData.tokens}.`
                  : ""
              }`
            : `(Out of context): ${messageTokenCount} tokens`;
        turnElement.style.opacity = messageTokenCount > 0 ? "1" : "0.5";
      } else {
        const messageTokens =
          messagesWithTokens.find((m) => m.messageId === messageId)?.tokens ||
          0;
        tokenCountDiv.textContent = `(Out of context): ${messageTokens} tokens.`;
        turnElement.style.opacity = "0.5";
      }

      const files = apiData.fileMapData.get(messageId);
      const canvases = apiData.canvasMapData.get(messageId);
      if (files || canvases) {
        const fragment = document.createDocumentFragment();
        if (files) {
          files.forEach((file) => {
            const div = document.createElement("div");
            div.textContent = `${file.name} (${
              file.file_token_size || 0
            } tokens)`;
            fragment.appendChild(div);
          });
        }
        if (canvases) {
          canvases.forEach((canvas) => {
            const div = document.createElement("div");
            const canvasTokens = enc.encode(canvas.content || "").length;
            div.textContent = `${canvas.title.replace(
              /_/g,
              " "
            )} (${canvasTokens} tokens)`;
            fragment.appendChild(div);
          });
        }
        extraInfoDiv.appendChild(fragment);
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
    if (!statusContainer) return;

    const effectiveTotal = tokenData.baseTokenCost + totalChatTokens;

    statusContainer.innerHTML = `
    <div class="tokenstatus" style="display: inline-block; margin-left: 8px; font-size: 12px; color: var(--text-secondary); font-weight: normal;">
        Effective tokens: ${effectiveTotal}/${limit}
    </div>
    <div class="token-popup"></div>
`;

    const popupDiv = statusContainer.querySelector(".token-popup");

    // Create popup content with better structure
    const popupContent = document.createElement("div");

    // Header
    const header = document.createElement("h4");
    header.textContent = "Token Breakdown (Effective/Total)";
    popupContent.appendChild(header);

    // Helper function to create token items with Tailwind-like styling
    const createTokenItem = (
      label,
      value,
      isInteractive = false,
      id = null,
      checked = false,
      tokens = 0
    ) => {
      const item = document.createElement("div");
      item.className = "token-item";

      if (isInteractive && id) {
        item.innerHTML = `
      <label for="${id}" class="flex items-center cursor-pointer flex-1 text-sm" title="${label}">
        <input type="checkbox" id="${id}" data-tokens="${tokens}" ${
          checked ? "checked" : ""
        } class="mr-2 cursor-pointer">
        <span class="truncate">${label}</span>
      </label>
      <span class="font-semibold whitespace-nowrap text-sm">${value}</span>
    `;
      } else {
        item.innerHTML = `
      <span class="text-sm">${label}</span>
      <span class="font-semibold whitespace-nowrap text-sm">${value}</span>
    `;
      }
      return item;
    };

    // System components
    if (
      tokenData.globalSystemPromptCost > 0 ||
      tokenData.globalSystemPromptTruncatedFrom
    ) {
      const val = tokenData.globalSystemPromptTruncatedFrom
        ? `${tokenData.globalSystemPromptCost} / ${tokenData.globalSystemPromptTruncatedFrom}`
        : tokenData.globalSystemPromptCost.toString();
      popupContent.appendChild(createTokenItem("Global System Prompt", val));
    }

    // Memory item (interactive)
    const memVal = tokenData.memoryTruncatedFrom
      ? `${tokenData.memoryCost} / ${tokenData.memoryTruncatedFrom}`
      : tokenData.memoryCost.toString();
    const memoryItem = document.createElement("div");
    memoryItem.className = "token-item";
    memoryItem.innerHTML = `
  <label for="toggle-memory" class="flex items-center cursor-pointer flex-1 text-sm">
    <input type="checkbox" id="toggle-memory" ${
      isMemoryEnabled ? "checked" : ""
    } class="mr-2 cursor-pointer">
    <span>Memory</span>
  </label>
  <span class="font-semibold whitespace-nowrap text-sm">${memVal}</span>
`;
    popupContent.appendChild(memoryItem);

    // Custom instructions
    if (tokenData.instructionsCost > 0 || tokenData.instructionsTruncatedFrom) {
      const val = tokenData.instructionsTruncatedFrom
        ? `${tokenData.instructionsCost} / ${tokenData.instructionsTruncatedFrom}`
        : tokenData.instructionsCost.toString();
      popupContent.appendChild(createTokenItem("Custom Instructions", val));
    }

    // Tool instructions
    if (
      tokenData.toolInstructionCost > 0 ||
      tokenData.toolInstructionTruncatedFrom
    ) {
      const val = tokenData.toolInstructionTruncatedFrom
        ? `${tokenData.toolInstructionCost} / ${tokenData.toolInstructionTruncatedFrom}`
        : tokenData.toolInstructionCost.toString();
      popupContent.appendChild(createTokenItem("Hidden Tool Output", val));
    }

    // Separator
    const separator = document.createElement("hr");
    popupContent.appendChild(separator);

    // Prompt and chat
    const promptVal =
      tokenData.promptTruncatedFrom !== null
        ? `${tokenData.promptCost} / ${tokenData.promptTruncatedFrom}`
        : tokenData.promptCost.toString();
    popupContent.appendChild(createTokenItem("Current Prompt", promptVal));

    const chatVal =
      maxChatTokens > totalChatTokens
        ? `${totalChatTokens} / ${maxChatTokens}`
        : totalChatTokens.toString();
    popupContent.appendChild(createTokenItem("Chat History", chatVal));

    // Files section
    const fileItems = [];
    [...apiData.fileMapData.entries()].forEach(([messageId, files]) => {
      files.forEach((f, index) => {
        const id = `file-${f.id}-(${index})`;
        const tokens = f.file_token_size || 0;
        const val = truncatedItems.has(id)
          ? `${truncatedItems.get(id)} / ${tokens}`
          : tokens.toString();
        fileItems.push(
          createTokenItem(f.name, val, true, id, checkedItems.has(id), tokens)
        );
      });
    });

    if (fileItems.length > 0) {
      const filesHeader = document.createElement("h4");
      filesHeader.textContent = "Files";
      popupContent.appendChild(filesHeader);
      fileItems.forEach((item) => popupContent.appendChild(item));
    }

    // Canvas section
    const canvasItems = [];
    [...apiData.canvasMapData.entries()].forEach(([messageId, canvases]) => {
      canvases.forEach((c) => {
        const id = `textdoc-${c.textdoc_id}-(v${c.version})`;
        const tokens = enc.encode(c.content || "").length;
        const val = truncatedItems.has(id)
          ? `${truncatedItems.get(id)} / ${tokens}`
          : tokens.toString();
        const title = c.title.replace(/_/g, " ");
        canvasItems.push(
          createTokenItem(
            `${title} (v${c.version})`,
            val,
            true,
            id,
            checkedItems.has(id),
            tokens
          )
        );
      });
    });

    if (canvasItems.length > 0) {
      const canvasHeader = document.createElement("h4");
      canvasHeader.textContent = "Canvas";
      popupContent.appendChild(canvasHeader);
      canvasItems.forEach((item) => popupContent.appendChild(item));
    }

    // Total line
    const totalLine = document.createElement("div");
    totalLine.className = "token-total-line";
    totalLine.innerHTML = `
  <span>Total tokens:</span>
  <span id="popup-total-tokens">${effectiveTotal} / ${limit}</span>
`;
    popupContent.appendChild(totalLine);

    // Refresh button
    const refreshButton = document.createElement("div");
    refreshButton.id = "refreshData";
    refreshButton.textContent = "Refresh";
    popupContent.appendChild(refreshButton);

    // Append all content to popup
    popupDiv.appendChild(popupContent);

    popupDiv.addEventListener("change", async (e) => {
      if (e.target.type !== "checkbox") return;
      const conversationId = getConversationId();
      if (!conversationId) return;

      if (e.target.id === "toggle-memory") {
        await chrome.storage.local.set({
          [`memory_enabled`]: e.target.checked,
        });
        // Re-run check when memory is toggled
        runTokenCheck();
      } else {
        const currentChecked = new Set(
          Array.from(
            popupDiv.querySelectorAll(
              'input[type="checkbox"]:not(#toggle-memory):checked'
            )
          ).map((cb) => cb.id)
        );
        // Save to IndexedDB instead of chrome.storage
        await setCheckedItemsInDB(conversationId, currentChecked);
        // Re-run check when an item is checked/unchecked
        runTokenCheck();
      }
    });

    popupDiv.addEventListener("click", async (e) => {
      if (e.target.id === "refreshData") {
        e.target.textContent = "Refreshing...";
        lastCheckState = {};
        await deleteCacheFromDB(getConversationId());
        await chrome.storage.local.remove("memory");
        runTokenCheck();
      }
    });
  }

  /**
   * Removes all token count UI elements and resets message styles.
   */
  function clearTokenUI() {
    console.log("🗑️ [Token Manager] Clearing token UI...");
    document
      .querySelectorAll(
        ".token-count-display, .extra-token-info, .token-status-container, .prompt-token-count"
      )
      .forEach((el) => el.remove());
    document.querySelectorAll("[data-message-id]").forEach((turn) => {
      turn.style.opacity = "1";
    });
  }

  // --- MAIN EXECUTION LOGIC ---

  async function runTokenCheck() {
    const { contextWindow, isScriptingEnabled, globalSystemPrompt } =
      await chrome.storage.local.get([
        "contextWindow",
        "isScriptingEnabled",
        "globalSystemPrompt",
      ]);

    if (contextWindow === 0 || !isScriptingEnabled) {
      clearTokenUI();
      return;
    }

    const conversationId = getConversationId();
    if (!conversationId) {
      clearTokenUI();
      return;
    }

    // Get checked items from IndexedDB instead of chrome.storage
    const checkedItems = await getCheckedItemsFromDB(conversationId);

    const memoryStorageKey = `memory_enabled`;
    const { [memoryStorageKey]: isMemoryEnabled = true } =
      await chrome.storage.local.get([memoryStorageKey]);

    const promptBox = document.querySelector("[contenteditable='true']");
    const promptText = promptBox ? promptBox.textContent || "" : "";
    const turnCount = document.querySelectorAll("article").length;
    const checkedItemsStr = JSON.stringify(Array.from(checkedItems).sort());

    const newState = {
      url: window.location.href,
      prompt: promptText,
      turns: turnCount,
      checked: checkedItemsStr,
      contextWindow,
      isMemoryEnabled,
    };

    if (JSON.stringify(lastCheckState) === JSON.stringify(newState)) {
      return; // No meaningful change detected
    }
    lastCheckState = newState;

    try {
      const cacheDuration = 3 * 60 * 1000;
      const cached = await getCacheFromDB(conversationId);

      if (cached && Date.now() - cached.timestamp < cacheDuration) {
        console.log(
          `🗄️ [Token Manager] Using fresh backend data from IndexedDB for ${conversationId}.`
        );
        apiData = cached.data;
      } else {
        console.log(`🌐 [Token Manager] Fetching new API data...`);
        apiData = await ChatGPT.getApiData(null, false);
        if (apiData) {
          await setCacheInDB(conversationId, apiData);
          console.log(
            `💾 [Token Manager] Cached API data for ${conversationId}.`
          );
        }
      }

      if (!apiData) {
        throw new Error("Failed to fetch or retrieve API data.");
      }

      const memoryTokens = await getMemory();
      const promptTokens = enc.encode(promptText).length + 4;
      const globalSystemPromptTokens = enc.encode(
        globalSystemPrompt || ""
      ).length;

      const tokenData = getEffectiveMessages(
        apiData,
        contextWindow,
        checkedItems,
        promptTokens,
        globalSystemPromptTokens,
        memoryTokens
      );

      const { effectiveMessages, messagesWithTokens } = tokenData;
      const effectiveMessageIds = new Set(
        effectiveMessages.map((m) => m.messageId)
      );
      const effectiveMessageMap = new Map(
        effectiveMessages.map((m) => [m.messageId, m])
      );
      const allMessages = [...apiData.messageMapData.values()].flat();

      addHoverListeners(
        allMessages,
        effectiveMessageIds,
        effectiveMessageMap,
        contextWindow,
        tokenData,
        messagesWithTokens,
        apiData,
        checkedItems,
        isMemoryEnabled
      );

      updatePromptTokenUI(tokenData.promptCost, tokenData.promptTruncatedFrom);
    } catch (e) {
      console.error("[Token Manager] Error during token check:", e);
    }
  }

  async function getMemory() {
    const { memory, memory_enabled } = await chrome.storage.local.get([
      "memory",
      "memory_enabled",
    ]);

    if (!memory_enabled) return 0;

    const time = Date.now();
    const timestamp = memory?.time ?? 0; // fallback to 0 if undefined

    if (!memory || time > timestamp + 1000 * 60 * 30) {
      const { memoryTokens } = await ChatGPT.getUserMemory();
      const memoryData = { memoryTokens, time };
      await chrome.storage.local.set({ memory: memoryData }); // key wrapper required
      return memoryTokens;
    }
    return memory.memoryTokens;
  }

  // --- EVENT LISTENERS & OBSERVERS ---
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local") return;
    if (changes.isScriptingEnabled || changes.globalSystemPrompt) {
      runTokenCheck();
      return;
    }
    const conversationId = window.location.pathname.split("/")[2];
    const memoryKey = `memory_enabled`;
    if (changes.contextWindow || (conversationId && changes[memoryKey])) {
      runTokenCheck();
    }
  });

  const debouncedRunTokenCheck = debounce(runTokenCheck, 3000);
  let lastUrl = location.href;
  const observer = new MutationObserver((mutationList) => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      lastCheckState = {}; // Reset state on URL change
      console.log(
        "🔄 [Token Manager] URL changed, running token check immediately."
      );
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

      for (const m in mutationList) {
        if (skip) return;

        const targetElement =
          m.type === "characterData" ? m.target.parentElement : m.target;

        if (
          !targetElement ||
          !targetElement.classList ||
          targetElement.closest(".ignore-this") ||
          targetElement.closest("main")
        ) {
          skip = true;
          return;
        }
        const classList = targetElement.classList;
        for (const cls of classList) {
          if (ignoredClasses.has(cls)) {
            skip = true;
            return;
          }
        }
      }
      if (!skip) debouncedRunTokenCheck();
    }
  });
  // Run the script when the page is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", debouncedRunTokenCheck());
  } else {
    debouncedRunTokenCheck();
  }
  observer.observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // --- UTILITY FUNCTIONS ---
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
  function getConversationId() {
    return window.location.pathname.split("/")[2];
  }
  return {
    get encoder() {
      return enc;
    },
    runTokenCheck,
  }
})();
