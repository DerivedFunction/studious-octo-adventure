/**
 * @name Export as Markdown
 * @description Exports the current ChatGPT conversation, including canvas text, to a markdown file.
 * @version 1.0.0
 *
 * This script is inspired by token.js and utilizes existing functions for interacting
 * with the ChatGPT backend API and its IndexedDB to fetch all necessary conversation data.
 *
 * The export process is triggered by the keyboard shortcut: Ctrl + Shift + S.
 *
 * For now, the generated markdown content is logged to the developer console for validation.
 * The file download functionality is commented out until the output is confirmed to be correct.
 */
(() => {
  let fetchController; // Controller to abort in-flight fetch requests
  let accessToken = null; // Global variable to store the access token

  // --- IndexedDB CACHE HELPER ---
  const DB_NAME = "MarkdownExportCacheDB";
  const DB_VERSION = 1;
  const STORE_NAME = "conversationCache";
  let db; // To hold the database instance

  /**
   * Opens and initializes the IndexedDB for caching backend API responses.
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
          dbInstance.createObjectStore(STORE_NAME, {
            keyPath: "id",
          });
        }
      };
    });
  }

  /**
   * Retrieves an item from our IndexedDB cache.
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
   * Stores an item in our IndexedDB cache with a timestamp.
   * @param {string} id The conversation ID (key).
   * @param {object} data The data to cache.
   */
  async function setCacheInDB(id, data) {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put({
      id,
      data,
      timestamp: Date.now(),
    });
  }

  // --- API & DATA FETCHING ---

  /**
   * Fetches and stores the access token globally. Only fetches if the token is not already present.
   * @returns {Promise<string|null>} The access token or null if it fails.
   */
  async function getAccessToken() {
    if (accessToken) {
      return accessToken;
    }
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
      console.error("❌ [Export MD] Could not retrieve access token:", error);
      accessToken = null; // Reset on failure
      return null;
    }
  }

  /**
   * Retrieves a full conversation object from ChatGPT's internal IndexedDB.
   * This provides the main structure and text of the messages.
   * @param {string} conversationId The ID of the conversation to fetch.
   * @returns {Promise<object|null>} A promise that resolves with the conversation data.
   */
  async function getConversationFromDB(conversationId) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("ConversationsDatabase");
      request.onerror = () => reject("Error opening ChatGPT DB");
      request.onsuccess = (event) => {
        try {
          const db = event.target.result;
          const transaction = db.transaction(["conversations"], "readonly");
          const objectStore = transaction.objectStore("conversations");
          const getRequest = objectStore.get(conversationId);
          getRequest.onsuccess = () => resolve(getRequest.result);
          getRequest.onerror = () =>
            reject("Error fetching conversation from ChatGPT DB");
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  /**
   * Fetches detailed conversation data from the backend API, focusing on canvas content.
   * Uses our own IndexedDB cache to avoid redundant fetches.
   * @param {string} conversationId The ID of the conversation to fetch.
   * @returns {Promise<Map<string, object>>} A map where keys are message IDs and values contain canvas info.
   */
  async function processBackendData(conversationId) {
    // 1. Check our cache first to avoid unnecessary API calls.
    const cacheDuration = 5 * 60 * 1000; // 5 minutes
    try {
      const cached = await getCacheFromDB(conversationId);
      if (cached && Date.now() - cached.timestamp < cacheDuration) {
        console.log(
          `🗄️ [Export MD] Using fresh canvas data from cache for ${conversationId}.`
        );
        return new Map(Object.entries(cached.data));
      }
    } catch (e) {
      console.error("❌ [Export MD] Error reading from cache:", e);
    }

    // 2. If no fresh cache, fetch from the backend API.
    if (fetchController) {
      fetchController.abort();
    }
    fetchController = new AbortController();
    const signal = fetchController.signal;

    try {
      console.log(`🌐 [Export MD] Fetching backend data for canvas content...`);
      const token = await getAccessToken();
      if (!token) throw new Error("Access token not available.");

      const response = await fetch(
        `https://chatgpt.com/backend-api/conversation/${conversationId}`,
        {
          headers: {
            accept: "*/*",
            authorization: `Bearer ${token}`,
          },
          method: "GET",
          signal,
        }
      );

      if (!response.ok) {
        throw new Error(
          `Backend API request failed with status: ${response.status}`
        );
      }

      const conversationApiData = await response.json();
      const additionalDataMap = new Map();
      const latestCanvasData = new Map();

      // Pass 1: Collect all canvas versions to find the latest for each.
      if (conversationApiData && conversationApiData.mapping) {
        for (const messageId in conversationApiData.mapping) {
          const node = conversationApiData.mapping[messageId];
          const recipient = node.message?.recipient;
          // Look for tool messages that create or update canvases ('textdoc').
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

                  // Find the final assistant message this canvas belongs to.
                  let attachToMessageId = null;
                  let currentNodeId = toolNode.id;
                  let currentNode = toolNode;
                  while (
                    currentNode &&
                    currentNode.children &&
                    currentNode.children.length > 0
                  ) {
                    currentNodeId = currentNode.children[0];
                    currentNode = conversationApiData.mapping[currentNodeId];
                    if (
                      currentNode?.message?.author?.role === "assistant" &&
                      currentNode?.message?.recipient === "all"
                    ) {
                      break; // Found the final response to the user.
                    }
                  }
                  attachToMessageId = currentNodeId;

                  let title = "Canvas";
                  let content = "";

                  if (contentNode.content) {
                    // Create operation
                    content = contentNode.content || "";
                    title = contentNode.name || "Canvas";
                  } else if (contentNode.updates && contentNode.updates[0]) {
                    // Update operation
                    content = contentNode.updates[0].replacement || "";
                    const existing = latestCanvasData.get(textdoc_id);
                    if (existing) title = existing.title; // Carry over title
                  }

                  if (attachToMessageId) {
                    const existing = latestCanvasData.get(textdoc_id);
                    if (!existing || existing.version < version) {
                      latestCanvasData.set(textdoc_id, {
                        version,
                        title,
                        content, // Store the full content
                        attachToMessageId,
                      });
                    }
                  }
                } catch (e) {
                  console.error(
                    "❌ [Export MD] Error processing canvas data:",
                    e
                  );
                }
              }
            }
          }
        }
      }

      // Pass 2: Populate the final map with the latest canvas content.
      latestCanvasData.forEach((data, textdoc_id) => {
        const attachToMessageId = data.attachToMessageId;
        const existing = additionalDataMap.get(attachToMessageId) || {};
        const existingCanvases = existing.canvases || [];

        additionalDataMap.set(attachToMessageId, {
          ...existing,
          canvases: [
            ...existingCanvases,
            {
              title: data.title,
              content: data.content, // Pass the content through
              textdoc_id,
              version: data.version,
            },
          ],
        });
      });

      // 3. Cache the processed data in our IndexedDB.
      try {
        const dataToCache = Object.fromEntries(additionalDataMap);
        await setCacheInDB(conversationId, dataToCache);
        console.log(`💾 [Export MD] Cached canvas data for ${conversationId}.`);
      } catch (e) {
        console.error("❌ [Export MD] Error writing to cache:", e);
      }

      console.log("✅ [Export MD] Backend data processed successfully.");
      return additionalDataMap;
    } catch (error) {
      if (error.name === "AbortError") {
        console.log("-> [Export MD] Fetch aborted for previous request.");
      } else {
        console.error("❌ [Export MD] All fetch attempts failed:", error);
      }
      return new Map();
    }
  }

  // --- MAIN EXPORT LOGIC ---

  /**
   * Fetches conversation data, constructs a markdown string, and logs it.
   */
  async function exportToMarkdown() {
    const pathParts = window.location.pathname.split("/");
    if (pathParts[1] !== "c" || !pathParts[2]) {
      console.log("📋 [Export MD] Not a conversation page. Aborting.");
      return;
    }
    const conversationId = pathParts[2];
    console.log(
      `🚀 [Export MD] Starting export for conversation: ${conversationId}`
    );

    try {
      // Fetch base conversation and detailed canvas data concurrently.
      const [conversationData, additionalDataMap] = await Promise.all([
        getConversationFromDB(conversationId),
        processBackendData(conversationId),
      ]);

      if (!conversationData || !conversationData.messages) {
        console.error(
          "❌ [Export MD] Could not retrieve conversation messages."
        );
        return;
      }

      // Start building the markdown string.
      let markdown = `# ${conversationData.title}\n\n`;

      for (const msg of conversationData.messages) {
        if (!msg.author || !msg.text) continue;

        const role = msg.author.role === "user" ? "User" : "Assistant";
        markdown += `### ${role}\n\n${msg.text}\n\n`;

        // Check if this message has associated canvas data.
        const extraData = additionalDataMap.get(msg.id);
        if (extraData && extraData.canvases) {
          for (const canvas of extraData.canvases) {
            markdown += `#### Canvas: ${canvas.title}\n\n\`\`\`\n${canvas.content}\n\`\`\`\n\n`;
          }
        }
      }

      // --- TEST: Log the final markdown to the console ---
      console.log("👇 --- BEGIN MARKDOWN EXPORT --- 👇");
      console.log(markdown);
      console.log("👆 --- END MARKDOWN EXPORT --- 👆");

      /*
      // --- FINAL IMPLEMENTATION: Create and download the file ---
      // This part is commented out for now to allow for testing via the console.
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeTitle = conversationData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.href = url;
      a.download = `${safeTitle || 'conversation'}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`✅ [Export MD] Conversation downloaded as "${a.download}"`);
      */
    } catch (error) {
      console.error(
        "❌ [Export MD] An error occurred during the export process:",
        error
      );
    }
  }

  // --- EVENT LISTENER ---

  /**
   * Listens for the Ctrl + Shift + S keyboard shortcut to trigger the export.
   */
  document.addEventListener("keydown", (event) => {
    // Check for Ctrl + Shift + S (or Cmd + Shift + S on macOS)
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault(); // Prevent the browser's default "Save As" dialog
      exportToMarkdown();
    }
  });

  console.log(
    "✅ [Export MD] Script loaded. Press Ctrl+Shift+S to export conversation."
  );
})();
