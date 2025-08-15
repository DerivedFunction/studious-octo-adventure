(() => {
  // Global state variables
  let accessToken = null;
  let allConversations = []; // This now holds only the conversations for the *current* view
  let currentView = "history";
  let uiInjected = false;

  // --- IndexedDB Cache Manager ---
  // This object handles all interactions with the local database.
  const cacheManager = {
    DB_NAME: "ConversationManagerDB",
    DB_VERSION: 3, // Incremented version to force schema upgrade for all users
    CONVERSATION_STORE: "conversations",
    METADATA_STORE: "metadata",
    CACHE_EXPIRATION_MS: 60 * 1000, // 1 minute
    db: null,

    /**
     * Opens and initializes the IndexedDB database.
     * @returns {Promise<IDBDatabase>} The database instance.
     */
    async openDB() {
      if (this.db) return this.db;
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
        request.onerror = (e) =>
          reject("IndexedDB error: " + e.target.errorCode);
        request.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };
        // This function runs only when the DB_VERSION changes or DB is first created.
        request.onupgradeneeded = (e) => {
          console.log("[History Manager] Upgrading IndexedDB schema...");
          const dbInstance = e.target.result;
          const transaction = e.target.transaction;

          // --- Conversation Store Setup ---
          let conversationStore;
          // Create store if it doesn't exist
          if (!dbInstance.objectStoreNames.contains(this.CONVERSATION_STORE)) {
            conversationStore = dbInstance.createObjectStore(
              this.CONVERSATION_STORE,
              { keyPath: "id" }
            );
          } else {
            // Otherwise, get a reference to the existing store
            conversationStore = transaction.objectStore(
              this.CONVERSATION_STORE
            );
          }

          // Defensively check for and create the index. This is the key fix.
          if (!conversationStore.indexNames.contains("is_archived_idx")) {
            conversationStore.createIndex("is_archived_idx", "is_archive", {
              unique: false,
            });
            console.log("[History Manager] Created 'is_archived_idx' index.");
          }

          // --- Metadata Store Setup ---
          if (!dbInstance.objectStoreNames.contains(this.METADATA_STORE)) {
            dbInstance.createObjectStore(this.METADATA_STORE, {
              keyPath: "key",
            });
          }
        };
      });
    },

    /**
     * Retrieves a metadata value (e.g., last sync timestamp).
     * @param {string} key The key for the metadata entry.
     * @returns {Promise<any|null>} The metadata value or null.
     */
    async getMetadata(key) {
      const db = await this.openDB();
      return new Promise((resolve) => {
        const transaction = db.transaction(this.METADATA_STORE, "readonly");
        const store = transaction.objectStore(this.METADATA_STORE);
        const request = store.get(key);
        request.onsuccess = () =>
          resolve(request.result ? request.result.value : null);
        request.onerror = () => resolve(null);
      });
    },

    /**
     * Stores a metadata value.
     * @param {string} key The key for the metadata entry.
     * @param {any} value The value to store.
     */
    async setMetadata(key, value) {
      const db = await this.openDB();
      const transaction = db.transaction(this.METADATA_STORE, "readwrite");
      const store = transaction.objectStore(this.METADATA_STORE);
      store.put({ key, value });
    },

    /**
     * Retrieves all conversations for a specific view (history or archived).
     * @param {boolean} isArchived - True to get archived, false for history.
     * @returns {Promise<Array>} An array of conversation objects.
     */
    async getConversations(isArchived) {
      const db = await this.openDB();
      return new Promise((resolve) => {
        const transaction = db.transaction(this.CONVERSATION_STORE, "readonly");
        const store = transaction.objectStore(this.CONVERSATION_STORE);
        const index = store.index("is_archived_idx");
        // FIX: Use a number (0 or 1) as the key, which is a universally valid key type.
        const key = isArchived ? 1 : 0;
        const request = index.getAll(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
      });
    },

    /**
     * Adds or updates a batch of conversations in the database.
     * @param {Array<object>} conversations - The conversations to add/update.
     */
    async bulkAddConversations(conversations) {
      const db = await this.openDB();
      const transaction = db.transaction(this.CONVERSATION_STORE, "readwrite");
      const store = transaction.objectStore(this.CONVERSATION_STORE);
      conversations.forEach((convo) => store.put(convo));
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },

    /**
     * Updates a single conversation in the database with new properties.
     * @param {string} id - The ID of the conversation to update.
     * @param {object} changes - An object with properties to update (e.g., { is_archive: 1 }).
     */
    async updateConversation(id, changes) {
      const db = await this.openDB();
      const transaction = db.transaction(this.CONVERSATION_STORE, "readwrite");
      const store = transaction.objectStore(this.CONVERSATION_STORE);
      const request = store.get(id);
      request.onsuccess = () => {
        const conversation = request.result;
        if (conversation) {
          Object.assign(conversation, changes);
          store.put(conversation);
        }
      };
    },

    /**
     * Deletes multiple conversations from the database by their IDs.
     * @param {Array<string>} ids - An array of conversation IDs to delete.
     */
    async deleteConversations(ids) {
      const db = await this.openDB();
      const transaction = db.transaction(this.CONVERSATION_STORE, "readwrite");
      const store = transaction.objectStore(this.CONVERSATION_STORE);
      ids.forEach((id) => store.delete(id));
    },

    /**
     * Clears all conversations from the database. Used during a full sync.
     */
    async clearConversations() {
      const db = await this.openDB();
      const transaction = db.transaction(this.CONVERSATION_STORE, "readwrite");
      transaction.objectStore(this.CONVERSATION_STORE).clear();
    },
  };
  // --- End of Cache Manager ---

  /**
   * Fetches and stores the access token.
   * @returns {Promise<string|null>} The access token or null if it fails.
   */
  async function getAccessToken() {
    if (accessToken) return accessToken;
    console.log("🔑 [History Manager] Fetching new access token...");
    try {
      const response = await fetch("https://chatgpt.com/api/auth/session");
      if (!response.ok) throw new Error(`Status: ${response.status}`);
      const session = await response.json();
      if (!session.accessToken) throw new Error("Access token not found.");
      accessToken = session.accessToken;
      return accessToken;
    } catch (error) {
      console.error(
        "❌ [History Manager] Could not retrieve access token:",
        error
      );
      showError("Could not get access token. Please log into ChatGPT.");
      return null;
    }
  }

  /**
   * Fetches ALL conversations (paged) from the server to fully sync the local cache.
   * This is the main data fetching function called on refresh or when cache is stale.
   * Full load continues to load all conversations, while only loads the first iteration.
   *
   */
  async function syncAllConversationsWithServer(fullLoad = 999) {
    showLoader(
      `${
        fullLoad === 0
          ? "Loading"
          : `${
              fullLoad === 999
                ? "Syncing full history..."
                : "Syncing partial history. Click refresh to fetch all"
            }`
      }`
    );
    const token = await getAccessToken();
    if (!token) {
      hideLoader();
      showError("Could not sync. Invalid access token.");
      return;
    }

    try {
      let allItems = [];

      // Fetch both active and archived conversations
      for (const isArchived of [false, true]) {
        let offset = 0;
        let hasMore = true;

        let iterationCount = 0;

        while (hasMore && iterationCount < fullLoad) {
          const response = await fetch(
            `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=100&is_archived=${isArchived}`,
            { headers: { authorization: `Bearer ${token}` } }
          );

          if (!response.ok) {
            throw new Error(
              `API request failed with status ${response.status}`
            );
          }

          const data = await response.json();
          const items = data.items || [];

          // Store the archive status as a number (1 for true, 0 for false) for robust indexing.
          items.forEach((item) => (item.is_archive = isArchived ? 1 : 0));
          allItems.push(...items);

          offset += items.length;
          hasMore = items.length > 0 && offset < data.total;
          iterationCount++;
        }
      }

      console.log(
        `[History Manager] Fetched a total of ${allItems.length} conversations. Updating cache.`
      );

      // Perform a clean sync: clear old data, add new data, and set the timestamp
      if (fullLoad === 999) await cacheManager.clearConversations();
      await cacheManager.bulkAddConversations(allItems);
      if (fullLoad > 0)
        await cacheManager.setMetadata("lastSyncTimestamp", Date.now());

      // Refresh the current view with the newly synced data
      await loadConversationsForView(currentView);
      console.log("✅ [History Manager] Cache sync complete.");
    } catch (error) {
      console.error(
        "❌ [History Manager] Failed to sync conversations:",
        error
      );
      showError("Failed to sync conversations. Please try again.");
    } finally {
      hideLoader();
    }
  }

  /**
   * Updates a single conversation's properties on the server.
   * @param {string} conversationId - The ID of the conversation.
   * @param {object} payload - The data to send in the PATCH request body.
   * @returns {Promise<boolean>} True on success, false on failure.
   */
  async function updateConversation(conversationId, payload) {
    const token = await getAccessToken();
    if (!token) return false;
    try {
      const response = await fetch(
        `https://chatgpt.com/backend-api/conversation/${conversationId}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          method: "PATCH",
        }
      );
      return response.ok;
    } catch (error) {
      console.error(
        `❌ [History Manager] Failed to update conversation ${conversationId}:`,
        error
      );
      return false;
    }
  }
  /**
   * Helper function to create SVG elements.
   * @param {string} tag - The SVG tag (e.g., 'svg', 'path').
   * @param {object} attributes - An object of SVG attributes.
   * @returns {SVGElement} The created SVG element.
   */
  function createSvgElement(tag, attributes = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const key in attributes) {
      el.setAttribute(key, attributes[key]);
    }
    return el;
  }

  // Helper function to create elements with attributes and children
  function createElement(tag, attributes = {}, children = []) {
    const el = document.createElement(tag);
    for (const key in attributes) {
      if (key === "className") {
        el.className = attributes[key];
      } else if (key === "style") {
        Object.assign(el.style, attributes[key]);
      } else if (key.startsWith("data-")) {
        el.dataset[key.substring(5)] = attributes[key];
      } else if (key.startsWith("checked")) {
        // add the attribute if it is true, else don't add it
        if (attributes[key]) {
          el.setAttribute(key, "");
        }
      } else {
        el.setAttribute(key, attributes[key]);
      }
    }
    children.forEach((child) => {
      if (typeof child === "string") {
        el.appendChild(document.createTextNode(child));
      } else if (child) {
        el.appendChild(child);
      }
    });
    return el;
  }
  /**
   * Creates and injects the UI and CSS into the page.
   */
  function injectUI() {
    if (uiInjected) return;

    const cssTemplate = `
        #chm-container { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; font-family: inherit; opacity: 0; transition: opacity 0.2s ease-in-out; }
        #chm-container.visible { opacity: 1; }
        #chm-modal { position: relative; background-color: var(--main-surface-primary, #ffffff); color: var(--text-primary, #000000); border: 1px solid var(--border-medium, #e5e5e5); border-radius: 16px; width: 80vw; height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden; transform: scale(0.95); transition: transform 0.2s ease-in-out; contain: layout style paint; }
        #chm-container.visible #chm-modal { transform: scale(1); }
        #chm-close-btn { position: absolute; top: 8px; right: 16px; z-index: 10; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-tertiary); transition: color 0.2s; }
        #chm-close-btn:hover { color: var(--text-secondary); }
        #chm-tabs { display: flex; border-bottom: 1px solid var(--border-light); padding-top: 8px; padding-left: 16px; padding-right: 16px;}
        #chm-tabs button { flex-grow: 0; padding: 12px 16px; font-weight: 500; border: none; background: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--text-secondary); }
        #chm-tabs button.active { color: var(--text-primary); border-bottom-color: var(--text-primary, #000); }
        #chm-content { flex-grow: 1; padding: 16px 24px; overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; contain: layout style paint; }
        .chm-action-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .chm-action-bar-group { display: flex; align-items: center; gap: 12px; }
        .chm-btn { padding: 8px 16px; border-radius: 100px; font-size: var(--text-sm, 0.875rem); font-weight: var(--font-weight-medium, 500); cursor: pointer; border-width: 1px; border-style: solid; transition: background-color 0.2s, border-color 0.2s; }
        .chm-btn.action-secondary { background-color: var(--main-surface-secondary); color: var(--text-primary); border-color: var(--border-medium); }
        .chm-btn.action-secondary:hover { background-color: var(--surface-hover); }
        .chm-btn.action-delete, .chm-btn.action-delete-perm { background-color: var(--text-danger, #ef4444); color: #fff; border-color: transparent; }
        .chm-conversation-item { display: flex; align-items: center; padding: 8px 12px; border-radius: 8px; border: 1px solid transparent; transition: background-color 0.2s, border-color 0.2s; }
        .chm-conversation-item:hover { background-color: var(--surface-hover); }
        .chm-conversation-item .title { flex-grow: 1; margin: 0 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chm-conversation-item .time { font-size: 0.8rem; color: var(--text-tertiary); }
        #historyList, #archivedList { padding-top: 8px; overscroll-behavior: contain; contain: layout style; }
        .chm-date-group-header { font-weight: 500; color: var(--text-secondary); padding: 12px 4px 4px 4px; font-size: 0.8rem; text-transform: uppercase; }
        #historyList > .chm-conversation-item + .chm-conversation-item, #archivedList > .chm-conversation-item + .chm-conversation-item { margin-top: 4px; }
        #chm-footer { display: flex; justify-content: flex-end; align-items: center; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--border-light); }
        #chm-footer > div { display: flex; gap: 12px; }
        #chm-loader { position: absolute; inset: 0; background: rgba(var(--main-surface-primary-rgb, 255, 255, 255), 0.8); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-primary); }
        #chm-loader div { width: 24px; height: 24px; border: 4px solid var(--border-light); border-top-color: var(--text-primary); border-radius: 50%; animation: spin 1s linear infinite; }
        #chm-time-filter { background-color: var(--main-surface-secondary); border: 1px solid var(--border-medium); border-radius: 8px; padding: 8px; font-size: 0.875rem; color: var(--text-primary); }
        @keyframes spin { to { transform: rotate(360deg); } }
        .chm-checkbox-label { display: flex; align-items: center; cursor: pointer; user-select: none; gap: 8px; }
        .chm-checkbox-label input[type="checkbox"] { position: absolute; opacity: 0; height: 0; width: 0; }
        .chm-custom-checkbox { position: relative; display: inline-block; width: 18px; height: 18px; background-color: transparent; border: 1px solid var(--text-tertiary, #8e8ea0); border-radius: 4px; transition: all 0.2s ease; }
        .chm-checkbox-label:hover .chm-custom-checkbox { border-color: var(--text-secondary, #6b6b7b); }
        .chm-checkbox-label input[type="checkbox"]:checked + .chm-custom-checkbox { background-color: var(--accent-primary, #10a37f); border-color: var(--accent-primary, #10a37f); }
        .chm-custom-checkbox::after { content: ''; position: absolute; display: none; left: 6px; top: 2px; width: 4px; height: 9px; border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg); }
        .chm-checkbox-label input[type="checkbox"]:checked + .chm-custom-checkbox::after { display: block; }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.textContent = cssTemplate;
    document.head.appendChild(styleSheet);

    // Create action bar with refresh button and status
    const historyActionBar = createElement(
      "div",
      { className: "chm-action-bar" },
      [
        createElement("div", { className: "chm-action-bar-group" }, [
          createElement(
            "label",
            { for: "selectAllHistory", className: "chm-checkbox-label" },
            [
              createElement("input", {
                type: "checkbox",
                id: "selectAllHistory",
              }),
              createElement("span", { className: "chm-custom-checkbox" }),
              createElement("span", {}, ["Select All"]),
            ]
          ),
          createElement("span", {}, ["Time Range: "]),
          createElement("select", { id: "chm-time-filter" }, [
            createElement("option", { value: "15m" }, ["Last 15 min"]),
            createElement("option", { value: "1h" }, ["Last hour"]),
            createElement("option", { value: "24h" }, ["Last 24 hours"]),
            createElement("option", { value: "7d" }, ["Last 7 days"]),
            createElement("option", { value: "30d" }, ["Last 30 days"]),
            createElement("option", { value: "all" }, ["All time"]),
          ]),
        ]),
        createElement("div", { className: "chm-action-bar-group" }, [
          createElement("span", {
            id: "chm-last-updated",
            style: {
              fontSize: "0.8rem",
              color: "var(--text-tertiary)",
              marginRight: "12px",
            },
          }),
          createElement(
            "button",
            { id: "chm-refresh-btn", className: "chm-btn action-secondary" },
            ["Refresh"]
          ),
        ]),
      ]
    );

    const modal = createElement("div", { id: "chm-modal" }, [
      createElement("button", { id: "chm-close-btn" }, ["×"]),
      createElement("div", { id: "chm-tabs" }, [
        createElement("button", { id: "historyTab", className: "active" }, [
          "History",
        ]),
        createElement("button", { id: "archivedTab" }, ["Archived"]),
      ]),
      createElement("div", { id: "chm-content" }, [
        createElement("div", { id: "historyView" }, [
          historyActionBar,
          createElement("div", { id: "historyList" }),
        ]),
        createElement(
          "div",
          { id: "archivedView", style: { display: "none" } },
          [
            createElement("div", { className: "chm-action-bar" }, [
              createElement("div", { className: "chm-action-bar-group" }, [
                createElement(
                  "label",
                  { for: "selectAllArchived", className: "chm-checkbox-label" },
                  [
                    createElement("input", {
                      type: "checkbox",
                      id: "selectAllArchived",
                    }),
                    createElement("span", { className: "chm-custom-checkbox" }),
                    createElement("span", {}, ["Select All"]),
                  ]
                ),
              ]),
            ]),
            createElement("div", { id: "archivedList" }),
          ]
        ),
      ]),
      createElement("div", { id: "chm-footer" }, [
        createElement("div", { id: "history-actions" }, [
          createElement(
            "button",
            { id: "archiveSelectedBtn", className: "chm-btn action-secondary" },
            ["Archive"]
          ),
          createElement(
            "button",
            { id: "deleteSelectedBtn", className: "chm-btn action-delete" },
            ["Delete"]
          ),
        ]),
        createElement(
          "div",
          { id: "archived-actions", style: { display: "none" } },
          [
            createElement(
              "button",
              {
                id: "restoreSelectedBtn",
                className: "chm-btn action-secondary",
              },
              ["Restore"]
            ),
            createElement(
              "button",
              {
                id: "deletePermanentBtn",
                className: "chm-btn action-delete-perm",
              },
              ["Delete"]
            ),
          ]
        ),
      ]),
      createElement("div", { id: "chm-loader", style: { display: "none" } }, [
        createElement("div", {}),
        createElement("span", { id: "chm-loader-text" }),
      ]),
    ]);

    const container = createElement("div", { id: "chm-container" }, [modal]);
    document.body.appendChild(container);
    uiInjected = true;
    addEventListeners();
  }

  /**
   * Adds event listeners to the UI elements.
   */
  function addEventListeners() {
    document.getElementById("chm-container").addEventListener("click", (e) => {
      if (e.target.id === "chm-container") toggleUiVisibility(false);
    });
    document
      .getElementById("chm-close-btn")
      .addEventListener("click", () => toggleUiVisibility(false));
    document
      .getElementById("historyTab")
      .addEventListener("click", () => switchView("history"));
    document
      .getElementById("archivedTab")
      .addEventListener("click", () => switchView("archived"));
    document
      .getElementById("archiveSelectedBtn")
      .addEventListener("click", () => handleBulkAction("archive"));
    document
      .getElementById("deleteSelectedBtn")
      .addEventListener("click", () => handleBulkAction("delete"));
    document
      .getElementById("restoreSelectedBtn")
      .addEventListener("click", () => handleBulkAction("restore"));
    document
      .getElementById("deletePermanentBtn")
      .addEventListener("click", () => handleBulkAction("delete"));
    document
      .getElementById("chm-time-filter")
      .addEventListener("change", () => {
        applyFilterAndRender();
        document.getElementById("selectAllHistory").checked = false;
      });
    document
      .getElementById("selectAllHistory")
      .addEventListener("change", (e) => {
        document
          .querySelectorAll('#historyList input[type="checkbox"]')
          .forEach((cb) => (cb.checked = e.target.checked));
      });
    document
      .getElementById("selectAllArchived")
      .addEventListener("change", (e) => {
        document
          .querySelectorAll('#archivedList input[type="checkbox"]')
          .forEach((cb) => (cb.checked = e.target.checked));
      });
    // Add listener for the new refresh button
    document.getElementById("chm-refresh-btn").addEventListener("click", () => {
      syncAllConversationsWithServer();
    });
  }

  /**
   * Toggles the main UI visibility.
   */
  function toggleUiVisibility(show) {
    if (!uiInjected && show) {
      injectUI();
      setTimeout(() => {
        document.getElementById("chm-container").classList.add("visible");
        // On first open, trigger the view switch logic which will check cache
        switchView(currentView);
      }, 10);
      return;
    }

    const container = document.getElementById("chm-container");
    if (show) {
      container.style.display = "flex";
      setTimeout(() => {
        container.classList.add("visible");
        // On subsequent opens, also check cache
        switchView(currentView);
      }, 10);
    } else {
      container.classList.remove("visible");
      // The cache is no longer cleared on close, ensuring persistence
      setTimeout(() => {
        container.style.display = "none";
      }, 200);
    }
  }

  /**
   * Groups conversations by date for rendering.
   * @param {Array<object>} items - The conversations to group.
   * @returns {object} An object with keys as date groups and values as arrays of conversations.
   */
  function groupAndSortConversations(items) {
    items.sort((a, b) => new Date(b.update_time) - new Date(a.update_time));
    const groups = {
      Today: [],
      Yesterday: [],
      "Previous 7 Days": [],
      "This Month": [],
    };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    for (const item of items) {
      const itemDate = new Date(item.update_time);
      if (itemDate >= today) {
        groups["Today"].push(item);
      } else if (itemDate >= yesterday) {
        groups["Yesterday"].push(item);
      } else if (itemDate >= sevenDaysAgo) {
        groups["Previous 7 Days"].push(item);
      } else if (itemDate >= thisMonth) {
        groups["This Month"].push(item);
      } else {
        const monthYear = itemDate.toLocaleString("default", {
          month: "long",
          year: "numeric",
        });
        if (!groups[monthYear]) {
          groups[monthYear] = [];
        }
        groups[monthYear].push(item);
      }
    }
    return groups;
  }

  /**
   * Renders conversations into the specified container.
   * @param {object} groupedItems - The grouped conversation data.
   * @param {string} containerId - The ID of the list element ('historyList' or 'archivedList').
   */
  function renderConversations(groupedItems, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = ""; // Clear previous content

    const fragment = document.createDocumentFragment();
    let hasContent = false;

    for (const groupName in groupedItems) {
      const items = groupedItems[groupName];
      if (items.length > 0) {
        hasContent = true;
        const header = document.createElement("h3");
        header.className = "chm-date-group-header";
        header.textContent = groupName;
        fragment.appendChild(header);

        items.forEach((item) => {
          const itemEl = document.createElement("div");
          itemEl.className = "chm-conversation-item";
          itemEl.innerHTML = `
            <label class="chm-checkbox-label">
              <input type="checkbox" data-id="${item.id}">
              <span class="chm-custom-checkbox"></span>
            </label>
            <span class="title"><a href='$./c/${item.id}' target='_blank'>${
            item.title || "Untitled"
          }</a></span>
            <span class="time">${new Date(item.update_time).toLocaleTimeString(
              [],
              { hour: "numeric", minute: "2-digit" }
            )}</span>
          `;
          fragment.appendChild(itemEl);
        });
      }
    }

    container.appendChild(fragment);

    if (!hasContent) {
      container.innerHTML = `<p style="text-align: center; padding: 1rem; color: var(--text-tertiary);">No conversations found.</p>`;
    }
  }

  /**
   * Updates the "Last Updated" text in the UI.
   */
  async function updateLastUpdatedStatus() {
    const statusEl = document.getElementById("chm-last-updated");
    if (!statusEl) return;
    const lastSync = await cacheManager.getMetadata("lastSyncTimestamp");
    if (lastSync) {
      statusEl.textContent = `Last updated: ${new Date(
        lastSync
      ).toLocaleString()}`;
    } else {
      statusEl.textContent = "Not synced yet.";
    }
  }

  /**
   * Loads conversation data for the specified view from the local cache.
   * @param {string} view - 'history' or 'archived'.
   */
  async function loadConversationsForView(view) {
    showLoader("Loading from cache...");
    try {
      const isArchived = view === "archived";
      const conversations = await cacheManager.getConversations(isArchived);
      allConversations = conversations; // Update global state for the current view
      applyFilterAndRender();
      await updateLastUpdatedStatus();
    } catch (error) {
      console.error(
        "❌ [History Manager] Failed to load conversations from DB:",
        error
      );
      showError("Could not load conversations from cache.");
    } finally {
      hideLoader();
    }
  }

  /**
   * Main view-switching logic. Checks cache freshness before loading.
   * @param {string} view - 'history' or 'archived'.
   */
  async function switchView(view) {
    currentView = view;
    // Switch UI elements (tabs, views, action buttons)
    document
      .getElementById("historyTab")
      .classList.toggle("active", view === "history");
    document
      .getElementById("archivedTab")
      .classList.toggle("active", view === "archived");
    document.getElementById("historyView").style.display =
      view === "history" ? "block" : "none";
    document.getElementById("archivedView").style.display =
      view === "archived" ? "block" : "none";
    document.getElementById("history-actions").style.display =
      view === "history" ? "flex" : "none";
    document.getElementById("archived-actions").style.display =
      view === "archived" ? "flex" : "none";
    document.getElementById("selectAllHistory").checked = false;
    document.getElementById("selectAllArchived").checked = false;

    const lastSync = await cacheManager.getMetadata("lastSyncTimestamp");
    // If there's no cache or it's older than the expiration time, force a sync
    if (!lastSync || Date.now() - lastSync > cacheManager.CACHE_EXPIRATION_MS) {
      console.log(
        `[History Manager] Cache is stale or missing. Forcing minor sync.`
      );
      await syncAllConversationsWithServer(1);
    } else {
      console.log(`[History Manager] Cache is fresh. Loading from IndexedDB.`);
      await syncAllConversationsWithServer(0);
      await loadConversationsForView(view);
    }
  }

  /**
   * Applies the time filter (if active) and re-renders the current view's conversations.
   */
  function applyFilterAndRender() {
    const isArchived = currentView === "archived";
    const listId = isArchived ? "archivedList" : "historyList";
    let conversationsToRender = allConversations;

    if (!isArchived) {
      const range = document.getElementById("chm-time-filter").value;
      if (range !== "all") {
        const now = new Date();
        let threshold = new Date(now);
        switch (range) {
          case "15m":
            threshold.setMinutes(now.getMinutes() - 15);
            break;
          case "1h":
            threshold.setHours(now.getHours() - 1);
            break;
          case "24h":
            threshold.setHours(now.getHours() - 24);
            break;
          case "7d":
            threshold.setDate(now.getDate() - 7);
            break;
          case "30d":
            threshold.setDate(now.getDate() - 30);
            break;
        }
        conversationsToRender = allConversations.filter(
          (c) => new Date(c.update_time) > threshold
        );
      }
    }

    const grouped = groupAndSortConversations(conversationsToRender);
    renderConversations(grouped, listId);
  }

  /**
   * Handles bulk actions by updating the server, then updating IndexedDB locally.
   * @param {string} action - 'archive', 'delete', 'restore', or 'deletePermanent'.
   */
  async function handleBulkAction(action) {
    const listId = currentView === "history" ? "historyList" : "archivedList";
    const targetIds = [
      ...document.querySelectorAll(`#${listId} input[type="checkbox"]:checked`),
    ].map((cb) => cb.dataset.id);

    if (targetIds.length === 0) {
      alert("Please select at least one conversation.");
      return;
    }

    let message, payload;
    switch (action) {
      case "archive":
        message = `Archive ${targetIds.length} conversation(s)?`;
        payload = { is_archived: true };
        break;
      case "restore":
        message = `Restore ${targetIds.length} conversation(s)?`;
        payload = { is_archived: false };
        break;
      case "delete":
        message = `PERMANENTLY delete ${targetIds.length} conversation(s)? This is irreversible.`;
        payload = { is_visible: false };
        break;
    }

    if (confirm(message)) {
      showLoader(`Processing ${targetIds.length} items...`);
      const promises = targetIds.map((id) => updateConversation(id, payload));
      const results = await Promise.allSettled(promises);

      const successfulIds = results
        .map((res, i) =>
          res.status === "fulfilled" && res.value ? targetIds[i] : null
        )
        .filter(Boolean);

      if (successfulIds.length > 0) {
        console.log(
          `[History Manager] Successfully processed ${successfulIds.length} items. Updating local cache.`
        );
        // Update IndexedDB directly instead of clearing the whole cache
        switch (action) {
          case "archive":
            // FIX: Use number 1 for true when updating the local cache.
            await Promise.all(
              successfulIds.map((id) =>
                cacheManager.updateConversation(id, { is_archive: 1 })
              )
            );
            break;
          case "restore":
            // FIX: Use number 0 for false when updating the local cache.
            await Promise.all(
              successfulIds.map((id) =>
                cacheManager.updateConversation(id, { is_archive: 0 })
              )
            );
            break;
          case "delete":
            await cacheManager.deleteConversations(successfulIds);
            break;
        }
      }

      // Refresh the current view from the updated local cache (which is very fast)
      await loadConversationsForView(currentView);
      hideLoader();
    }
  }

  function showLoader(text = "") {
    if (!uiInjected) return;
    const loader = document.getElementById("chm-loader");
    const loaderText = document.getElementById("chm-loader-text");
    loaderText.textContent = text;
    loader.style.display = "flex";
  }

  function hideLoader() {
    if (uiInjected)
      document.getElementById("chm-loader").style.display = "none";
  }
  function showError(message) {
    alert(`[History Manager Error] ${message}`);
  }

  // --- Keyboard Shortcut (Ctrl+H) ---
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      const container = document.getElementById("chm-container");
      const isVisible = container && container.style.display !== "none";
      toggleUiVisibility(!isVisible);
    }
  });

  /**
   * Injects a button into the sidebar using a MutationObserver to handle dynamic rendering.
   */
  function injectSidebarButton() {
    const injectionLogic = () => {
      if (document.getElementById("chm-sidebar-btn")) return true;
      const sidebarNav = document.querySelector("aside");
      if (!sidebarNav) return false;

      console.log("🚀 [History Manager] Injecting sidebar button...");
      const svgIcon = createSvgElement("svg", {
        width: "20",
        height: "20",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        class: "icon",
      });
      svgIcon.appendChild(
        createSvgElement("path", {
          d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
        })
      );
      svgIcon.appendChild(
        createSvgElement("path", {
          d: "M3 3v5h5",
        })
      );
      svgIcon.appendChild(
        createSvgElement("path", {
          d: "M12 7v5l4 2",
        })
      );
      const buttonElement = createElement(
        "div",
        {
          id: "chm-sidebar-btn",
          tabindex: "0",
          className: "group __menu-item hoverable cursor-pointer",
        },
        [
          createElement(
            "div",
            { className: "flex min-w-0 items-center gap-1.5" },
            [
              createElement(
                "div",
                { className: "flex items-center justify-center icon" },
                [svgIcon]
              ),
              createElement(
                "div",
                { className: "flex min-w-0 grow items-center gap-2.5" },
                [
                  createElement("div", { className: "truncate" }, [
                    "History Manager",
                  ]),
                ]
              ),
            ]
          ),
          createElement(
            "div",
            { className: "trailing highlight text-token-text-tertiary" },
            [
              createElement("div", { className: "touch:hidden" }, [
                createElement(
                  "div",
                  {
                    className:
                      "inline-flex whitespace-pre *:inline-flex *:font-sans *:not-last:after:px-0.5 *:not-last:after:content-['+']",
                  },
                  [
                    createElement("kbd", { "aria-label": "Control" }, [
                      createElement("span", { className: "min-w-[1em]" }, [
                        "Ctrl",
                      ]),
                    ]),
                    createElement("kbd", {}, [
                      createElement("span", { className: "min-w-[1em]" }, [
                        "H",
                      ]),
                    ]),
                  ]
                ),
              ]),
            ]
          ),
        ]
      );

      buttonElement.addEventListener("click", (e) => {
        e.preventDefault();
        toggleUiVisibility(true);
      });

      // Find a good place to inject the button, e.g., before the labels
      const leMenu = sidebarNav.querySelector("#chm-sidebar-btn");
      if (leMenu) {
        leMenu.parentElement.before(buttonElement);
      } else {
        sidebarNav.appendChild(buttonElement);
      }
      console.log("✅ [History Manager] Sidebar button injected successfully.");
      return true;
    };

    const observer = new MutationObserver(() => {
      injectionLogic();
    });

    const interval = setInterval(() => {
      const aside = document.body.querySelector("aside");
      if (aside) {
        clearInterval(interval);
        observer.observe(aside, { childList: true, subtree: true });
        injectionLogic();
      }
    }, 1000);
  }

  injectSidebarButton();
  console.log(
    "✅ [History Manager] Content script loaded. Press Ctrl+H to open."
  );
})();
