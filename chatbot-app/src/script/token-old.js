import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
(() => {
  // This encoder is now available for the entire script
  const enc = new Tiktoken(o200k_base);
  console.log("✅ [Token Manager] Tokenizer initialized.");
  let fetchController; // Controller to abort in-flight fetch requests
  let accessToken = null; // Global variable to store the access token
  let lastCheckState = {}; /* eslint-disable no-undef */ // Cache state to avoid redundant checks // --- IndexedDB CACHE HELPER ---

  const DB_NAME = "TokenManagerCacheDB";
  const DB_VERSION = 2;
  const STORE_NAME = "conversationCache";
  let db; // To hold the database instance
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
  } // --- UTILITY FUNCTIONS ---
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
  } // --- TOKEN COUNTING LOGIC ---
  /**
   * Fetches and stores the access token globally. Only fetches if the token is not already present.
   * @returns {Promise<string|null>} The access token or null if it fails.
   */

  async function getAccessToken() {
    if (accessToken) {
      return accessToken;
    }
    console.log("🔑 [Token Manager] Fetching new access token...");
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
      console.error(
        "❌ [Token Manager] Could not retrieve access token:",
        error
      );
      accessToken = null; // Reset on failure
      return null;
    }
  }
  /**
   * Fetches the number of tokens used by the memory feature.
   * @returns {Promise<number>} The number of tokens used by memory.
   */

  async function getMemoryTokens() {
    console.log("🧠 [Token Manager] Fetching memory tokens...");
    try {
      const token = await getAccessToken();
      if (!token)
        throw new Error("Access token not available for memory fetch.");

      const response = await fetch(
        "https://chatgpt.com/backend-api/memories?include_memory_entries=true",
        {
          headers: {
            accept: "*/*",
            authorization: `Bearer ${token}`,
          },
          method: "GET",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Memory API request failed with status: ${response.status}`
        );
      }

      const data = await response.json();
      const memoryTokens = data.memory_num_tokens || 0;
      console.log(`🧠 [Token Manager] Memory tokens fetched: ${memoryTokens}`);
      return memoryTokens;
    } catch (error) {
      console.error(
        "❌ [Token Manager] Could not retrieve memory tokens:",
        error
      );
      return 0; // Return 0 on failure to avoid breaking the main flow
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
   * Fetches detailed conversation data from the backend API, using an IndexedDB
   * cache to avoid redundant fetches.
   * @param {string} conversationId The ID of the conversation to fetch.
   * @returns {Promise<Map<string, object>>} A map where keys are message IDs and values contain file/canvas info.
   */

  async function processBackendData(conversationId) {
    const cacheDuration = 3 * 60 * 1000; // 3 minutes
    const maxRetries = 3; // 1. Check IndexedDB for fresh cached data first.
    try {
      const cached = await getCacheFromDB(conversationId);
      if (cached && Date.now() - cached.timestamp < cacheDuration) {
        console.log(
          `🗄️ [Token Manager] Using fresh backend data from IndexedDB for ${conversationId}.`
        );
        return new Map(Object.entries(cached.data));
      }
    } catch (e) {
      console.error(
        "❌ [Token Manager] Error reading from IndexedDB cache:",
        e
      );
    } // 2. If no fresh cache, proceed with fetching.

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
          console.error(
            "❌ Could not retrieve access token. Aborting retries."
          );
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
          console.log(
            "❌ [Token Manager] Access token expired or invalid. Refreshing..."
          );
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
        let toolInstructionTokens = 0; // Pass 1: Collect all canvas versions and identify the latest for each

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
                    const { textdoc_id, version, is_failure } =
                      toolNode.message.metadata.canvas;
                    if (is_failure) continue;
                    const contentNode = JSON.parse(
                      node.message.content.parts?.[0] ||
                        node.message.content?.text
                    );
                    // --- START: Logic to find the correct final message to attach the canvas to ---

                    let attachToMessageId = null;
                    let currentNodeId = toolNode.id;
                    let currentNode = toolNode; // Traverse the chain of children until we find the final assistant message to the user.

                    while (
                      currentNode &&
                      currentNode.children &&
                      currentNode.children.length > 0
                    ) {
                      currentNodeId = currentNode.children[0];
                      currentNode = conversationApiData.mapping[currentNodeId]; // The final message is from the assistant to 'all' recipients.
                      if (
                        currentNode?.message?.author?.role === "assistant" &&
                        currentNode?.message?.recipient === "all"
                      ) {
                        break;
                      }
                    }
                    attachToMessageId = currentNodeId; // --- END: New logic ---
                    let title = null;
                    let content = "";

                    if (contentNode.content) {
                      // Create operation
                      content = contentNode.content || "";
                      title = contentNode.name;
                    } else if (contentNode.updates && contentNode.updates[0]) {
                      // Update operation
                      content = contentNode.updates[0].replacement || "";
                      const existing = latestCanvasData.get(textdoc_id);
                      if (existing) {
                        title = existing.title; // Carry over title from previous version
                      }
                    }

                    const tokens = enc.encode(content).length;

                    if (attachToMessageId) {
                      const existing = latestCanvasData.get(textdoc_id);
                      if (title && (!existing || existing.version < version)) {
                        latestCanvasData.set(textdoc_id, {
                          version,
                          title,
                          tokens,
                          attachToMessageId,
                        });
                      }
                    }
                  } catch (e) {
                    console.error(
                      "❌ [Token Manager] Error processing canvas data:",
                      e
                    );
                  }
                }
              }
            }
          } // Pass 2: Populate additionalDataMap with latest canvas versions and other data

          latestCanvasData.forEach((data, textdoc_id) => {
            const attachToMessageId = data.attachToMessageId;
            const existing = additionalDataMap.get(attachToMessageId) || {};
            const existingCanvases = existing.canvases || []; // Get existing canvases or initialize an empty array

            additionalDataMap.set(attachToMessageId, {
              ...existing,
              canvases: [
                // Use a 'canvases' array
                ...existingCanvases,
                {
                  title: data.title,
                  tokens: data.tokens,
                  textdoc_id,
                  version: data.version,
                },
              ],
            });
          }); // Pass 3: Process files, custom instructions, and hidden tool messages

          for (const messageId in conversationApiData.mapping) {
            const node = conversationApiData.mapping[messageId];
            if (node.message) {
              const { metadata, content, author } = node.message;
              let fileInfo = null;
              let customInstructionsInfo = null;
              let targetMessageId = node.message.id;

              if (
                author &&
                author.role === "tool" &&
                content &&
                content.content_type === "text" &&
                content.parts[0]
              ) {
                toolInstructionTokens += enc.encode(content.parts[0]).length;
              }

              if (metadata.attachments && metadata.attachments.length > 0) {
                fileInfo = metadata.attachments.map((file) => ({
                  name: file.name,
                  tokens: file.file_token_size || 0,
                }));
              }

              if (content.content_type === "user_editable_context") {
                customInstructionsInfo = {
                  profile_tokens: enc.encode(content.user_profile || "").length,
                  instructions_tokens: enc.encode(
                    content.user_instructions || ""
                  ).length,
                };
              }

              if (fileInfo || customInstructionsInfo) {
                const existingData =
                  additionalDataMap.get(targetMessageId) || {};
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

        if (toolInstructionTokens > 0) {
          // Find the root node's first child to attach the tool instruction cost
          const rootNode = conversationApiData.mapping["client-created-root"];
          if (rootNode && rootNode.children.length > 0) {
            const firstMessageId = rootNode.children[0];
            const existingData = additionalDataMap.get(firstMessageId) || {};
            additionalDataMap.set(firstMessageId, {
              ...existingData,
              toolInstructions: { tokens: toolInstructionTokens },
            });
          }
        } // 3. After successful fetch, cache the data in IndexedDB.

        try {
          const dataToCache = Object.fromEntries(additionalDataMap);
          await setCacheInDB(conversationId, dataToCache);
          console.log(
            `💾 [Token Manager] Cached backend data for ${conversationId} in IndexedDB.`
          );
        } catch (e) {
          console.error(
            "❌ [Token Manager] Error writing to IndexedDB cache:",
            e
          );
        }

        console.log(
          "✅ [Token Manager] Backend data processed.",
          additionalDataMap
        );
        return additionalDataMap; // Success, return the data
      } catch (error) {
        if (error.name === "AbortError") {
          console.log(
            "❌ [Token Manager] Fetch aborted for previous conversation."
          );
          return new Map(); // Don't retry on abort
        }
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
        if (attempt === maxRetries) {
          console.error("❌ [Token Manager] All fetch attempts failed.");
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
   * @param {number} globalSystemPromptTokens - The token count of the global system prompt.
   * @param {number} memoryTokens - The token count of the user's memory.
   * @returns {object} An object containing the effective messages and token breakdown.
   */

  function getEffectiveMessages(
    allMessages,
    limit,
    additionalDataMap,
    checkedItems,
    promptTokens = 0,
    globalSystemPromptTokens = 0,
    memoryTokens = 0
  ) {
    const messagesWithTokens = allMessages.map((msg) => ({
      ...msg,
      tokens: ((msg.text || "").trim() ? enc.encode(msg.text).length : 0) + 4,
    }));

    let currentTotalTokens = 0;
    const truncatedItems = new Map(); // Store truncated item IDs and their effective token count // --- Result variables ---

    let globalSystemPromptCost = 0;
    let globalSystemPromptTruncatedFrom = null;
    let memoryCost = 0;
    let memoryTruncatedFrom = null;
    let instructionsCost = 0;
    let instructionsTruncatedFrom = null;
    let toolInstructionCost = 0;
    let toolInstructionTruncatedFrom = null;
    let promptCost = 0;
    let promptTruncatedFrom = null;
    let attachmentsCost = 0;
    let totalChatTokens = 0;
    let maxChatTokens = 0;
    const effectiveMessages = [];
    let maxPossibleTokens = promptTokens;
    messagesWithTokens.forEach((msg) => {
      maxPossibleTokens += msg.tokens;
      maxChatTokens += msg.tokens;
    }); // --- 0. Global System Prompt ---

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
    } // --- 0.5. Memory ---

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
    } // --- 1. Custom Instructions ---

    additionalDataMap.forEach((data) => {
      if (data.customInstructions) {
        const instrTokens =
          data.customInstructions.profile_tokens +
          data.customInstructions.instructions_tokens;
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
    }); // --- 1.5 Tool Instructions ---

    let totalToolInstructionTokens = 0;
    additionalDataMap.forEach((data) => {
      if (data.toolInstructions) {
        totalToolInstructionTokens += data.toolInstructions.tokens;
      }
    });
    maxPossibleTokens += totalToolInstructionTokens;
    if (totalToolInstructionTokens > 0) {
      const remainingSpace = limit - currentTotalTokens;
      if (totalToolInstructionTokens > remainingSpace) {
        toolInstructionCost = remainingSpace;
        toolInstructionTruncatedFrom = totalToolInstructionTokens;
        currentTotalTokens = limit;
      } else {
        toolInstructionCost = totalToolInstructionTokens;
        currentTotalTokens += totalToolInstructionTokens;
      }
    } // --- 2. User Prompt ---
    if (promptTokens > 0) {
      const remainingSpace = limit - currentTotalTokens;
      if (promptTokens > remainingSpace) {
        promptCost = remainingSpace;
        promptTruncatedFrom = promptTokens;
        currentTotalTokens = limit;
      } else {
        promptCost = promptTokens;
        currentTotalTokens += promptTokens;
      }
    } // --- 3. Files & Canvases ---

    additionalDataMap.forEach((data, msgId) => {
      if (data.files) {
        data.files.forEach((file, index) => {
          const itemId = `file-${msgId}-${index}`;
          if (checkedItems.has(itemId)) {
            maxPossibleTokens += file.tokens;
            const remainingSpace = limit - currentTotalTokens;
            if (file.tokens > remainingSpace) {
              truncatedItems.set(itemId, remainingSpace); // Store effective tokens
              attachmentsCost += remainingSpace;
              currentTotalTokens = limit;
            } else {
              attachmentsCost += file.tokens;
              currentTotalTokens += file.tokens;
            }
          }
        });
      }
      if (data.canvases) {
        // Check for the 'canvases' array
        data.canvases.forEach((canvas) => {
          // Loop through each canvas
          const itemId = `canvas-${canvas.textdoc_id}`;
          if (checkedItems.has(itemId)) {
            maxPossibleTokens += canvas.tokens;
            const remainingSpace = limit - currentTotalTokens;
            if (canvas.tokens > remainingSpace) {
              truncatedItems.set(itemId, remainingSpace); // Store effective tokens
              attachmentsCost += remainingSpace;
              currentTotalTokens = limit;
            } else {
              attachmentsCost += canvas.tokens;
              currentTotalTokens += canvas.tokens;
            }
          }
        });
      }
    }); // --- 4. Chat History ---
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
            width: 375px;
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
   * @param {boolean} isMemoryEnabled - Whether memory is enabled for this chat.
   */

  function addHoverListeners(
    allMessages,
    effectiveMessageIds,
    effectiveMessageMap,
    limit,
    tokenData,
    messagesWithTokens,
    additionalDataMap,
    checkedItems,
    isMemoryEnabled
  ) {
    injectPopupCSS(); // Ensure CSS is present

    const { totalChatTokens, truncatedItems, maxChatTokens } = tokenData;

    const turnElements = document.querySelectorAll("[data-message-id]");
    if (!turnElements.length) {
      console.log("⌛ [Token Manager] Elements still loading.");
      debouncedRunTokenCheck();
      return;
    }

    let cumulativeTokens = 0;
    console.log("💻 [Token Manager] Updating token UI...");

    const allMessagesMap = new Map(allMessages.map((m) => [m.id, m]));

    turnElements.forEach((turnElement) => {
      const messageId = turnElement.dataset.messageId;
      const originalMessageData = allMessagesMap.get(messageId);

      if (!originalMessageData) return;

      let tokenCountDiv = turnElement.querySelector(".token-count-display");
      if (!tokenCountDiv) {
        tokenCountDiv = document.createElement("div");
        tokenCountDiv.className = "token-count-display";
        tokenCountDiv.style.display = "inline-block";
        tokenCountDiv.style.marginLeft = "8px";
        tokenCountDiv.style.fontSize = "12px";
        tokenCountDiv.style.color = "var(--text-secondary)";
        tokenCountDiv.style.fontWeight = "normal";
        turnElement.appendChild(tokenCountDiv);
      }

      let extraInfoDiv = turnElement.querySelector(".extra-token-info");
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
        tokenCountDiv.textContent = `(Out of context): ${messageTokens} tokens.`;
        turnElement.style.opacity = "0.5";
      }

      const extraData = additionalDataMap.get(originalMessageData.id);
      if (extraData) {
        const fragment = document.createDocumentFragment();
        if (extraData.files) {
          extraData.files.forEach((file) => {
            const div = document.createElement("div");
            div.textContent = `${file.name} (${file.tokens} tokens)`;
            fragment.appendChild(div);
          });
        }
        if (extraData.canvases && extraData.canvases.length > 0) {
          extraData.canvases.forEach((canvas) => {
            const div = document.createElement("div");
            div.textContent = `${canvas.title.replace(/_/g, " ")} (${
              canvas.tokens
            } tokens)`;
            fragment.appendChild(div);
          });
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
      h4.textContent = "Token Breakdown (Effective/Total)";
      popupFragment.appendChild(h4);

      if (
        tokenData.globalSystemPromptCost > 0 ||
        tokenData.globalSystemPromptTruncatedFrom
      ) {
        const globalPromptSection = document.createElement("div");
        globalPromptSection.className = "token-section";
        const originalTokens =
          tokenData.globalSystemPromptTruncatedFrom ??
          tokenData.globalSystemPromptCost;
        let promptValue = originalTokens;
        if (tokenData.globalSystemPromptTruncatedFrom) {
          promptValue = `${tokenData.globalSystemPromptCost} / ${originalTokens}`;
        }
        const promptLabel = `Global System Prompt `;
        globalPromptSection.appendChild(
          createTokenItem(promptLabel, promptValue)
        );
        popupFragment.appendChild(globalPromptSection);
      }

      const memorySection = document.createElement("div");
      memorySection.className = "token-item";
      const memoryLabel = document.createElement("label");
      memoryLabel.htmlFor = "toggle-memory";
      const memoryCheckbox = document.createElement("input");
      memoryCheckbox.type = "checkbox";
      memoryCheckbox.id = "toggle-memory";
      memoryCheckbox.checked = isMemoryEnabled;
      memoryLabel.appendChild(memoryCheckbox);
      memoryLabel.append("Memory");

      const memoryValueSpan = document.createElement("span");
      const originalTokens =
        tokenData.memoryTruncatedFrom ?? tokenData.memoryCost;
      if (tokenData.memoryTruncatedFrom) {
        memoryValueSpan.textContent = `${tokenData.memoryCost} / ${originalTokens}`;
      } else {
        memoryValueSpan.textContent = originalTokens;
      }

      memorySection.appendChild(memoryLabel);
      memorySection.appendChild(memoryValueSpan);
      popupFragment.appendChild(memorySection); // This section is now consolidated and uses effective/total logic

      if (
        tokenData.instructionsCost > 0 ||
        tokenData.instructionsTruncatedFrom
      ) {
        h4 = document.createElement("h4");
        h4.textContent = "Custom Instructions";
        popupFragment.appendChild(h4);

        const instructionsSection = document.createElement("div");
        instructionsSection.className = "token-section";

        const originalInstructionTokens =
          tokenData.instructionsTruncatedFrom ?? tokenData.instructionsCost;
        let instructionValue = originalInstructionTokens;

        if (tokenData.instructionsTruncatedFrom) {
          instructionValue = `${tokenData.instructionsCost} / ${originalInstructionTokens}`;
        }

        instructionsSection.appendChild(
          createTokenItem("Instructions", instructionValue)
        );
        popupFragment.appendChild(instructionsSection);
      }

      if (
        tokenData.toolInstructionCost > 0 ||
        tokenData.toolInstructionTruncatedFrom
      ) {
        h4 = document.createElement("h4");
        h4.textContent = "Tool Responses";
        popupFragment.appendChild(h4);

        const toolSection = document.createElement("div");
        toolSection.className = "token-section";
        const originalToolTokens =
          tokenData.toolInstructionTruncatedFrom ??
          tokenData.toolInstructionCost;
        let toolValue = originalToolTokens;
        if (tokenData.toolInstructionTruncatedFrom) {
          toolValue = `${tokenData.toolInstructionCost} / ${originalToolTokens}`;
        }
        toolSection.appendChild(
          createTokenItem("Hidden Tool Output", toolValue)
        );
        popupFragment.appendChild(toolSection);
      }
      h4 = document.createElement("h4");
      h4.textContent = `Chat`;
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
      const promptLabel = `Current Prompt`;
      promptSection.appendChild(createTokenItem(promptLabel, promptValue));
      popupFragment.appendChild(promptSection);

      const chatSection = document.createElement("div");
      chatSection.className = "token-section";
      const chatOverflow = maxChatTokens > totalChatTokens;
      chatSection.appendChild(
        createTokenItem(
          `Chat History`,
          `${
            chatOverflow
              ? `${totalChatTokens} / ${maxChatTokens}`
              : totalChatTokens
          } `
        )
      );
      popupFragment.appendChild(chatSection);

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
            label.append(`${f.name}`);
            const valueSpan = document.createElement("span"); // New logic for effective/total display
            if (truncatedItems.has(id)) {
              const effectiveTokens = truncatedItems.get(id);
              valueSpan.textContent = `${effectiveTokens} / ${f.tokens}`;
            } else {
              valueSpan.textContent = f.tokens;
            }
            itemDiv.appendChild(label);
            itemDiv.appendChild(valueSpan);
            filesFragment.appendChild(itemDiv);
          });
        }
        if (data.canvases) {
          data.canvases.forEach((canvas) => {
            const id = `canvas-${canvas.textdoc_id}`;
            const itemDiv = document.createElement("div");
            itemDiv.className = "token-item";
            const label = document.createElement("label");
            label.htmlFor = id;
            label.title = `${canvas.title} (v${canvas.version})`;
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.id = id;
            checkbox.checked = checkedItems.has(id);
            checkbox.dataset.type = "canvas";
            checkbox.dataset.tokens = canvas.tokens;
            label.appendChild(checkbox);
            label.append(`${canvas.title.replace(/_/g, " ")} `);
            const valueSpan = document.createElement("span"); // New logic for effective/total display
            if (truncatedItems.has(id)) {
              const effectiveTokens = truncatedItems.get(id);
              valueSpan.textContent = `${effectiveTokens} / ${canvas.tokens}`;
            } else {
              valueSpan.textContent = canvas.tokens;
            }
            itemDiv.appendChild(label);
            itemDiv.appendChild(valueSpan);
            canvasFragment.appendChild(itemDiv);
          });
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
          if (e.target.id === "toggle-memory") {
            const memoryStorageKey = `memory_enabled_${conversationId}`;
            await chrome.storage.local.set({
              [memoryStorageKey]: e.target.checked,
            });
          } else {
            const storageKey = `checked_items_${conversationId}`;
            const currentChecked = Array.from(
              popupDiv.querySelectorAll(
                'input[type="checkbox"]:not(#toggle-memory):checked'
              )
            ).map((cb) => cb.id);
            await chrome.storage.local.set({ [storageKey]: currentChecked });
          }
        }
      });

      popupDiv.addEventListener("click", async (e) => {
        if (e.target.id === "refreshData") {
          e.target.textContent = "Refreshing...";
          lastCheckState = {}; // UPDATED: Delete from IndexedDB instead of storage.local
          await deleteCacheFromDB(conversationId);
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
  /**
   * Fetches the current conversation, processes it, and updates the UI.
   */

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

    const pathParts = window.location.pathname.split("/");
    if (pathParts[1] !== "c" || !pathParts[2]) {
      clearTokenUI();
      return;
    }

    const conversationId = pathParts[2];
    const storageKey = `checked_items_${conversationId}`;
    const memoryStorageKey = `memory_enabled_${conversationId}`;
    const {
      [storageKey]: checkedItemsRaw = [],
      [memoryStorageKey]: isMemoryEnabled = true, // Default to true
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
      return; // No meaningful change detected, skip the check
    }
    lastCheckState = newState;

    try {
      const [conversationData, additionalDataMap, memoryTokens] =
        await Promise.all([
          getConversationFromDB(conversationId),
          processBackendData(conversationId),
          isMemoryEnabled ? getMemoryTokens() : Promise.resolve(0), // Fetch conditionally
        ]);

      const currentConversationId = window.location.pathname.split("/")[2];
      if (conversationId !== currentConversationId) {
        console.log(
          `🗑️ Stale data for ${conversationId} ignored; current chat is ${currentConversationId}.`
        );
        return;
      }

      if (conversationData && Array.isArray(conversationData.messages)) {
        const promptTokens = enc.encode(promptText).length + 4;
        const globalSystemPromptTokens = enc.encode(
          globalSystemPrompt || ""
        ).length;
        const tokenData = getEffectiveMessages(
          conversationData.messages,
          contextWindow,
          additionalDataMap,
          checkedItems,
          promptTokens,
          globalSystemPromptTokens,
          memoryTokens
        );
        const { effectiveMessages, messagesWithTokens } = tokenData;

        const effectiveMessageIds = new Set(effectiveMessages.map((m) => m.id));
        const effectiveMessageMap = new Map(
          effectiveMessages.map((m) => [m.id, m])
        );

        const totalEffectiveTokens =
          tokenData.baseTokenCost + tokenData.totalChatTokens;
        console.log(
          `📊 [Token Manager] TOTAL TOKENS IN CONTEXT for "${conversationData.title}": ${totalEffectiveTokens} / ${contextWindow}`
        );

        addHoverListeners(
          conversationData.messages,
          effectiveMessageIds,
          effectiveMessageMap,
          contextWindow,
          tokenData,
          messagesWithTokens,
          additionalDataMap,
          checkedItems,
          isMemoryEnabled
        );

        updatePromptTokenUI(
          tokenData.promptCost,
          tokenData.promptTruncatedFrom,
          contextWindow
        );
      }
    } catch (error) {
      console.error("❌ [Token Manager] Error during token check:", error);
    }
  }

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local") return;
    if (changes.isScriptingEnabled || changes.globalSystemPrompt) {
      runTokenCheck();
      return;
    }
    const conversationId = window.location.pathname.split("/")[2];
    const checkedItemsKey = `checked_items_${conversationId}`;
    const memoryKey = `memory_enabled_${conversationId}`;
    if (
      changes.contextWindow ||
      (conversationId && (changes[checkedItemsKey] || changes[memoryKey]))
    ) {
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
  });
  // Run the script when the page is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", debouncedRunTokenCheck());
  } else {
    debouncedRunTokenCheck();
  }
  const interval = setInterval(() => {
    const main = document.body.querySelector("main");
    if (main) {
      clearInterval(interval);
      observer.observe(main, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }, 1000);
})();
