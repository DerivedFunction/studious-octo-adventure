import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
(() => {
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
  let ChatGPT = window.ChatGPTDataExport;
  let lastCheckState = {};

  let db; // To hold the database instance
  let apiData = null;
  const DB_NAME = "TokenManagerCacheDB";
  const DB_VERSION = 1;
  // new store name to not interfere
  const STORE_NAME = "conversationApiCache";
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
        if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
          dbInstance.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
    });
  }
  /**
   * Retrieves an item from the IndexedDB cache.
   * @param {string} id The conversation ID (key).
   * @returns {Promise<object|null>} The cached data object or null.
   */

  async function getCacheFromDB(id) {
    const db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null); // Resolve with null on error
    });
  }
  /**
   * Stores an item in the IndexedDB cache with a timestamp.
   * @param {string} id The conversation ID (key).
   * @param {object} data The data to cache.
   */

  async function setCacheInDB(id, data) {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put({ id, data, timestamp: Date.now() });
  }
  /**
   * Deletes an item from the IndexedDB cache.
   * @param {string} id The conversation ID (key).
   */

  async function deleteCacheFromDB(id) {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete(id);
  }

  // --- UI & TOKEN CALCULATION LOGIC (Ported & Refactored) ---

  /**
   * Injects CSS for the hover popup into the document head.
   */
  function injectPopupCSS() {
    const styleId = "token-popup-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        .token-status-container { position: relative; display: inline-block; }
        .token-status-container:hover .token-popup { display: block; }
        .token-popup { display: none; position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%); background-color: var(--main-surface-primary); border: 1px solid var(--border-medium); border-radius: 8px; padding: 12px; width: 375px; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.15); color: var(--text-secondary); font-size: 12px; text-align: left; }
        .token-popup h4 { margin-top: 0; margin-bottom: 8px; font-weight: bold; color: var(--text-primary); border-bottom: 1px solid var(--border-medium); padding-bottom: 4px; }
        .token-popup .token-section { margin-bottom: 8px; }
        .token-popup .token-section:last-child { margin-bottom: 0; }
        .token-popup .token-item { display: flex; align-items: center; justify-content: space-between; }
        .token-popup .token-item label { display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px; cursor: pointer; }
        .token-popup .token-item input { margin-right: 6px; }
        .token-popup .token-item span { font-weight: bold; white-space: nowrap; }
        .token-popup .token-total-line { font-weight: bold; display: flex; justify-content: space-between; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border-light); }
        .truncated-text { font-style: italic; color: var(--text-secondary); margin-left: 4px; }
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
      if (globalSystemPromptTokens > limit) {
        globalSystemPromptCost = limit;
        globalSystemPromptTruncatedFrom = globalSystemPromptTokens;
        currentTotalTokens = limit;
      } else {
        globalSystemPromptCost = globalSystemPromptTokens;
        currentTotalTokens += globalSystemPromptTokens;
      }
    }

    // 0.5. Memory
    maxPossibleTokens += memoryTokens;
    if (currentTotalTokens < limit && memoryTokens > 0) {
      const remainingSpace = limit - currentTotalTokens;
      if (memoryTokens > remainingSpace) {
        memoryCost = remainingSpace;
        memoryTruncatedFrom = memoryTokens;
        currentTotalTokens = limit;
      } else {
        memoryCost = memoryTokens;
        currentTotalTokens += memoryTokens;
      }
    }

    // 1. Custom Instructions
    if (apiData.userProfile) {
      const instrTokens =
        enc.encode(apiData.userProfile.user_profile || "").length +
        enc.encode(apiData.userProfile.user_instructions || "").length;
      maxPossibleTokens += instrTokens;
      if (currentTotalTokens < limit && instrTokens > 0) {
        const remainingSpace = limit - currentTotalTokens;
        if (instrTokens > remainingSpace) {
          instructionsCost = remainingSpace;
          instructionsTruncatedFrom = instrTokens;
          currentTotalTokens = limit;
        } else {
          instructionsCost = instrTokens;
          currentTotalTokens += instrTokens;
        }
      }
    }

    // 1.5 Tool Instructions (Hidden Tool Output)
    const totalToolInstructionTokens = [...apiData.toolMapData.values()]
      .flat()
      .reduce(
        (acc, tool) =>
          acc + enc.encode((tool.instruction || []).join("\n") || "").length,
        0
      );
    maxPossibleTokens += totalToolInstructionTokens;
    if (currentTotalTokens < limit && totalToolInstructionTokens > 0) {
      const remainingSpace = limit - currentTotalTokens;
      if (totalToolInstructionTokens > remainingSpace) {
        toolInstructionCost = remainingSpace;
        toolInstructionTruncatedFrom = totalToolInstructionTokens;
        currentTotalTokens = limit;
      } else {
        toolInstructionCost = totalToolInstructionTokens;
        currentTotalTokens += totalToolInstructionTokens;
      }
    }

    // 2. User Prompt
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

    // 3. Files & Canvases
    [...apiData.fileMapData.entries()].forEach(([messageId, files]) => {
      files.forEach((file, index) => {
        const itemId = `file-${messageId}-${index}`;
        if (checkedItems.has(itemId)) {
          const fileTokens = file.file_token_size || 0;
          maxPossibleTokens += fileTokens;
          if (currentTotalTokens < limit) {
            const remainingSpace = limit - currentTotalTokens;
            if (fileTokens > remainingSpace) {
              truncatedItems.set(itemId, remainingSpace);
              attachmentsCost += remainingSpace;
              currentTotalTokens = limit;
            } else {
              attachmentsCost += fileTokens;
              currentTotalTokens += fileTokens;
            }
          }
        }
      });
    });

    [...apiData.canvasMapData.entries()].forEach(([messageId, canvases]) => {
      canvases.forEach((canvas) => {
        const itemId = `canvas-${canvas.textdoc_id}`;
        if (checkedItems.has(itemId)) {
          const canvasTokens = enc.encode(canvas.content || "").length;
          maxPossibleTokens += canvasTokens;
          if (currentTotalTokens < limit) {
            const remainingSpace = limit - currentTotalTokens;
            if (canvasTokens > remainingSpace) {
              truncatedItems.set(itemId, remainingSpace);
              attachmentsCost += remainingSpace;
              currentTotalTokens = limit;
            } else {
              attachmentsCost += canvasTokens;
              currentTotalTokens += canvasTokens;
            }
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
    const popupFragment = document.createDocumentFragment();

    const createTokenItem = (label, value) => {
      const item = document.createElement("div");
      item.className = "token-item";
      item.innerHTML = `<span>${label}</span><span>${value}</span>`;
      return item;
    };

    popupFragment.innerHTML = "<h4>Token Breakdown (Effective/Total)</h4>";

    // Build sections
    if (
      tokenData.globalSystemPromptCost > 0 ||
      tokenData.globalSystemPromptTruncatedFrom
    ) {
      const val = tokenData.globalSystemPromptTruncatedFrom
        ? `${tokenData.globalSystemPromptCost} / ${tokenData.globalSystemPromptTruncatedFrom}`
        : tokenData.globalSystemPromptCost;
      popupFragment.appendChild(createTokenItem("Global System Prompt", val));
    }

    const memVal = tokenData.memoryTruncatedFrom
      ? `${tokenData.memoryCost} / ${tokenData.memoryTruncatedFrom}`
      : tokenData.memoryCost;
    const memoryItem = document.createElement("div");
    memoryItem.className = "token-item";
    memoryItem.innerHTML = `<label for="toggle-memory"><input type="checkbox" id="toggle-memory" ${
      isMemoryEnabled ? "checked" : ""
    }>Memory</label><span>${memVal}</span>`;
    popupFragment.appendChild(memoryItem);

    if (tokenData.instructionsCost > 0 || tokenData.instructionsTruncatedFrom) {
      const val = tokenData.instructionsTruncatedFrom
        ? `${tokenData.instructionsCost} / ${tokenData.instructionsTruncatedFrom}`
        : tokenData.instructionsCost;
      popupFragment.appendChild(createTokenItem("Custom Instructions", val));
    }

    if (
      tokenData.toolInstructionCost > 0 ||
      tokenData.toolInstructionTruncatedFrom
    ) {
      const val = tokenData.toolInstructionTruncatedFrom
        ? `${tokenData.toolInstructionCost} / ${tokenData.toolInstructionTruncatedFrom}`
        : tokenData.toolInstructionCost;
      popupFragment.appendChild(createTokenItem("Hidden Tool Output", val));
    }

    popupFragment.appendChild(document.createElement("hr"));

    const promptVal =
      tokenData.promptTruncatedFrom !== null
        ? `${tokenData.promptCost} / ${tokenData.promptTruncatedFrom}`
        : tokenData.promptCost;
    popupFragment.appendChild(createTokenItem("Current Prompt", promptVal));

    const chatVal =
      maxChatTokens > totalChatTokens
        ? `${totalChatTokens} / ${maxChatTokens}`
        : totalChatTokens;
    popupFragment.appendChild(createTokenItem("Chat History", chatVal));

    // Files and Canvases
    const filesFragment = document.createDocumentFragment();
    [...apiData.fileMapData.entries()].forEach(([messageId, files]) => {
      files.forEach((f, index) => {
        const id = `file-${messageId}-${index}`;
        const itemDiv = document.createElement("div");
        itemDiv.className = "token-item";
        const tokens = f.file_token_size || 0;
        const val = truncatedItems.has(id)
          ? `${truncatedItems.get(id)} / ${tokens}`
          : tokens;
        itemDiv.innerHTML = `<label for="${id}" title="${
          f.name
        }"><input type="checkbox" id="${id}" data-tokens="${tokens}" ${
          checkedItems.has(id) ? "checked" : ""
        }>${f.name}</label><span>${val}</span>`;
        filesFragment.appendChild(itemDiv);
      });
    });

    const canvasFragment = document.createDocumentFragment();
    [...apiData.canvasMapData.entries()].forEach(([messageId, canvases]) => {
      canvases.forEach((c) => {
        const id = `canvas-${c.textdoc_id}`;
        const itemDiv = document.createElement("div");
        itemDiv.className = "token-item";
        const tokens = enc.encode(c.content || "").length;
        const val = truncatedItems.has(id)
          ? `${truncatedItems.get(id)} / ${tokens}`
          : tokens;
        const title = c.title.replace(/_/g, " ");
        itemDiv.innerHTML = `<label for="${id}" title="${title} (v${
          c.version
        })"><input type="checkbox" id="${id}" data-tokens="${tokens}" ${
          checkedItems.has(id) ? "checked" : ""
        }>${title}</label><span>${val}</span>`;
        canvasFragment.appendChild(itemDiv);
      });
    });

    if (filesFragment.hasChildNodes()) {
      const h4 = document.createElement("h4");
      h4.textContent = "Files";
      popupFragment.appendChild(h4);
      popupFragment.appendChild(filesFragment);
    }
    if (canvasFragment.hasChildNodes()) {
      const h4 = document.createElement("h4");
      h4.textContent = "Canvas";
      popupFragment.appendChild(h4);
      popupFragment.appendChild(canvasFragment);
    }

    // Totals and Refresh
    const totalLine = document.createElement("div");
    totalLine.className = "token-total-line";
    totalLine.innerHTML = `<span>Total tokens:</span><span id="popup-total-tokens">${effectiveTotal} / ${limit}</span>`;
    popupFragment.appendChild(totalLine);

    const refreshLine = document.createElement("div");
    refreshLine.id = "refreshData";
    refreshLine.textContent = "Refresh";
    Object.assign(refreshLine.style, {
      cursor: "pointer",
      textAlign: "right",
      marginTop: "4px",
    });
    popupFragment.appendChild(refreshLine);
    popupDiv.appendChild(popupFragment);

    popupDiv.addEventListener("change", async (e) => {
      if (e.target.type !== "checkbox") return;
      const conversationId = ChatGPT.getConversationId();
      if (!conversationId) return;

      if (e.target.id === "toggle-memory") {
        await chrome.storage.local.set({
          [`memory_enabled_${conversationId}`]: e.target.checked,
        });
      } else {
        const currentChecked = Array.from(
          popupDiv.querySelectorAll(
            'input[type="checkbox"]:not(#toggle-memory):checked'
          )
        ).map((cb) => cb.id);
        await chrome.storage.local.set({
          [`checked_items_${conversationId}`]: currentChecked,
        });
      }
    });

    popupDiv.addEventListener("click", async (e) => {
      if (e.target.id === "refreshData") {
        e.target.textContent = "Refreshing...";
        lastCheckState = {};
        await deleteCacheFromDB(ChatGPT.getConversationId());
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

    const conversationId = ChatGPT.getConversationId();
    if (!conversationId) {
      clearTokenUI();
      return;
    }

    const storageKey = `checked_items_${conversationId}`;
    const memoryStorageKey = `memory_enabled_${conversationId}`;
    const {
      [storageKey]: checkedItemsRaw = [],
      [memoryStorageKey]: isMemoryEnabled = true,
    } = await chrome.storage.local.get([storageKey, memoryStorageKey]);
    const checkedItems = new Set(checkedItemsRaw);

    const promptBox = document.querySelector("[contenteditable='true']");
    const promptText = promptBox ? promptBox.textContent || "" : "";
    const turnCount = document.querySelectorAll("[data-message-id]").length;
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
        apiData = await ChatGPT.getApiData();
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

      const { memoryTokens } = isMemoryEnabled
        ? await ChatGPT.getUserMemory()
        : { memoryTokens: 0 };
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

  // --- EVENT LISTENERS & OBSERVERS ---
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local") return;
    const conversationId = ChatGPT.getConversationId();
    const checkedItemsKey = `checked_items_${conversationId}`;
    const memoryKey = `memory_enabled_${conversationId}`;

    if (
      changes.isScriptingEnabled ||
      changes.globalSystemPrompt ||
      changes.contextWindow ||
      (conversationId && (changes[checkedItemsKey] || changes[memoryKey]))
    ) {
      runTokenCheck();
    }
  });

  const debouncedRunTokenCheck = debounce(runTokenCheck, 1500);
  let lastConvoId = ChatGPT.getConversationId();
  const observer = new MutationObserver((mutationList) => {
    const cId = ChatGPT.getConversationId();
    if (cId !== lastConvoId) {
      lastConvoId = cId;
      lastCheckState = {}; // Reset state on URL change
      console.log(
        "🔄 [Token Manager] URL changed, running token check immediately."
      );
      runTokenCheck();
    } else {
      // Simplified mutation check to avoid skipping UI updates
      debouncedRunTokenCheck();
    }
  });

  const interval = setInterval(() => {
    const main = document.body.querySelector("main");
    if (main) {
      clearInterval(interval);
      observer.observe(main, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      runTokenCheck(); // Initial run
    }
  }, 500);

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
})();
