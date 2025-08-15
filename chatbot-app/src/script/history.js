(() => {
  // This IIFE (Immediately Invoked Function Expression) encapsulates the entire script
  // to prevent conflicts with the ChatGPT page's own JavaScript.

  // --- State Variables ---
  let accessToken = null;
  let allConversations = []; // Store all fetched conversations for the current view
  let currentView = "history";
  let uiInjected = false;
  // ADDED: State for pagination
  let historyOffset = 0;
  let archivedOffset = 0;
  let historyTotal = 0;
  let archivedTotal = 0;
  let isLoadingMore = false;

  // ADDED: Constants for caching
  const HISTORY_CACHE_KEY = "chm_history_cache";
  const ARCHIVED_CACHE_KEY = "chm_archived_cache";

  // ADDED: Clear cache on initial load to ensure freshness
  clearCache();

  // --- API Functions ---

  /**
   * Fetches and stores the access token. Caches the token after the first fetch.
   * @returns {Promise<string|null>} The access token or null if it fails.
   */
  async function getAccessToken() {
    if (accessToken) {
      return accessToken;
    }
    console.log("🔑 [History Manager] Fetching new access token...");
    try {
      const response = await fetch("https://chatgpt.com/api/auth/session");
      if (!response.ok)
        throw new Error(
          `Failed to fetch auth session. Status: ${response.status}`
        );
      const session = await response.json();
      if (!session.accessToken)
        throw new Error("Access token not found in session response.");
      accessToken = session.accessToken;
      console.log("✅ [History Manager] Access token retrieved successfully.");
      return accessToken;
    } catch (error) {
      console.error(
        "❌ [History Manager] Could not retrieve access token:",
        error
      );
      showError(
        "Could not get access token. Please make sure you are logged into ChatGPT."
      );
      accessToken = null;
      return null;
    }
  }

  /**
   * Fetches conversations from the ChatGPT API.
   * @param {boolean} isArchived - Whether to fetch archived conversations.
   * @param {number} offset - The starting point for fetching conversations. // CHANGED
   * @returns {Promise<object>} An object containing conversation items and total count. // CHANGED
   */
  async function fetchConversations(isArchived = false, offset = 0) {
    // This function no longer shows the main loader, as it's used for loading more as well
    const token = await getAccessToken();
    if (!token) {
      return { items: [], total: 0 };
    }

    try {
      const response = await fetch(
        `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=100&is_archived=${isArchived}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
          },
        }
      );
      if (!response.ok)
        throw new Error(`API request failed. Status: ${response.status}`);
      const data = await response.json();
      // CHANGED: Return both items and total for pagination logic
      return { items: data.items || [], total: data.total || 0 };
    } catch (error) {
      console.error(
        `❌ [History Manager] Failed to fetch conversations:`,
        error
      );
      showError(`Failed to load conversations.`);
      return { items: [], total: 0 };
    }
  }

  /**
   * Updates a conversation's properties (archive, delete, restore).
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
   * Deletes ALL conversations, including archived ones. This is a destructive action.
   * @returns {Promise<boolean>} True on success, false on failure.
   */
  async function deleteAllConversations() {
    const token = await getAccessToken();
    if (!token) return false;

    try {
      const response = await fetch(
        `https://chatgpt.com/backend-api/conversations`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            is_visible: false,
          }),
          method: "PATCH",
        }
      );
      return response.ok;
    } catch (error) {
      console.error(
        `❌ [History Manager] Failed to delete all conversations:`,
        error
      );
      return false;
    }
  }

  // --- UI Creation and Injection ---

  /**
   * Creates and injects the UI and CSS into the page.
   */
  function injectUI() {
    if (uiInjected) return;

    // --- CSS Template ---
    const cssTemplate = `
              #chm-container {
                  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                  background-color: rgba(0, 0, 0, 0.6); z-index: 9999;
                  display: flex; align-items: center; justify-content: center; font-family: inherit;
                  opacity: 0; transition: opacity 0.2s ease-in-out;
              }
              #chm-container.visible {
                  opacity: 1;
              }
              #chm-modal {
                  position: relative;
                  background-color: var(--main-surface-primary, #ffffff); color: var(--text-primary, #000000);
                  border: 1px solid var(--border-medium, #e5e5e5);
                  border-radius: 16px;
                  width: 80vw; height: 80vh; display: flex; flex-direction: column;
                  box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden;
                  transform: scale(0.95);
                  transition: transform 0.2s ease-in-out;
              }
              #chm-container.visible #chm-modal {
                  transform: scale(1);
              }
              #chm-close-btn { 
                  position: absolute;
                  top: 8px;
                  right: 16px;
                  z-index: 10;
                  background: none; 
                  border: none; 
                  font-size: 1.5rem; 
                  cursor: pointer; 
                  color: var(--text-tertiary); 
                  transition: color 0.2s; 
              }
              #chm-close-btn:hover { color: var(--text-secondary); }
              #chm-tabs { display: flex; border-bottom: 1px solid var(--border-light); padding-top: 8px; padding-left: 16px; padding-right: 16px;}
              #chm-tabs button { flex-grow: 0; padding: 12px 16px; font-weight: 500; border: none; background: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--text-secondary); }
              #chm-tabs button.active { color: var(--text-primary); border-bottom-color: var(--text-primary, #000); }
              #chm-content { 
                  flex-grow: 1; 
                  padding: 16px 24px;
                  overflow-y: auto; 
              }
              .chm-action-bar { 
                  display: flex; 
                  justify-content: space-between; 
                  align-items: center; 
                  margin-bottom: 16px; 
              }
              .chm-action-bar-group { display: flex; align-items: center; gap: 12px; }
              .chm-btn { 
                  padding: 8px 16px; 
                  border-radius: 100px; 
                  font-size: var(--text-sm, 0.875rem);
                  font-weight: var(--font-weight-medium, 500);
                  cursor: pointer; 
                  border-width: 1px;
                  border-style: solid;
                  transition: background-color 0.2s, border-color 0.2s; 
              }
              
                  .chm-btn.action-secondary:hover { background-color: var(--surface-hover); }
              .chm-btn.action-delete, .chm-btn.action-delete-perm { background-color: var(--text-danger, #ef4444); color: #fff; border-color: transparent; }
              /* ADDED: Style for the "Load More" button */
              .chm-load-more-btn { 
                  display: block; 
                  margin: 16px auto; 
                  background-color: var(--main-surface-secondary); 
                  color: var(--text-primary);
                  border-color: var(--border-medium);
              }
              .chm-load-more-btn:hover { background-color: var(--surface-hover); }
              .chm-conversation-item { 
                  display: flex; 
                  align-items: center; 
                  padding: 8px 12px;
                  border-radius: 8px; 
                  border: 1px solid transparent; 
                  transition: background-color 0.2s, border-color 0.2s; 
              }
              .chm-conversation-item:hover { background-color: var(--surface-hover); }
              .chm-conversation-item .title { flex-grow: 1; margin: 0 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
              .chm-conversation-item .time { font-size: 0.8rem; color: var(--text-tertiary); }
              #historyList, #archivedList { padding-top: 8px; }
              .chm-date-group-header { 
                  font-weight: 500; 
                  color: var(--text-secondary); 
                  padding: 12px 4px 4px 4px;
                  font-size: 0.8rem; 
                  text-transform: uppercase; 
              }
              #historyList > .chm-conversation-item + .chm-conversation-item, #archivedList > .chm-conversation-item + .chm-conversation-item { margin-top: 4px; }
              #chm-footer {
                  display: flex;
                  justify-content: flex-end;
                  align-items: center;
                  gap: 12px;
                  padding: 16px 24px;
                  border-top: 1px solid var(--border-light);
              }
              #chm-footer > div {
                  display: flex;
                  gap: 12px;
              }
              #chm-loader { position: absolute; inset: 0; background: var(--main-surface-primary); display: flex; align-items: center; justify-content: center; }
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

    // --- HTML Template ---
    const htmlTemplate = `
        <div id="chm-modal">
            <button id="chm-close-btn">&times;</button>
            <div id="chm-tabs">
                <button id="historyTab" class="active">History</button>
                <button id="archivedTab">Archived</button>
            </div>
            <div id="chm-content">
                <div id="historyView">
                    <div class="chm-action-bar">
                        <div class="chm-action-bar-group">
                            <label for="selectAllHistory" class="chm-checkbox-label">
                                <input type="checkbox" id="selectAllHistory">
                                <span class="chm-custom-checkbox"></span>
                                <span>Select All</span>
                            </label>
                            <select id="chm-time-filter">
                                <option value="all">All time</option>
                                <option value="1h">Last hour</option>
                                <option value="24h">Last 24 hours</option>
                                <option value="7d">Last 7 days</option>
                                <option value="30d">Last 30 days</option>
                            </select>
                        </div>
                    </div>
                    <div id="historyList"></div>
                </div>
                <div id="archivedView" style="display: none;">
                    <div class="chm-action-bar">
                            <div class="chm-action-bar-group">
                             <label for="selectAllArchived" class="chm-checkbox-label">
                                <input type="checkbox" id="selectAllArchived">
                                <span class="chm-custom-checkbox"></span>
                                <span>Select All</span>
                            </label>
                        </div>
                    </div>
                    <div id="archivedList"></div>
                </div>
            </div>
            <div id="chm-footer">
                <div id="history-actions">
                       <button id="archiveSelectedBtn" class="chm-btn action-secondary">Archive</button>
                       <button id="deleteSelectedBtn" class="chm-btn action-delete">Delete</button>
                </div>
                <div id="archived-actions" style="display: none;">
                    <button id="restoreSelectedBtn" class="chm-btn action-secondary">Restore</button>
                    <button id="deletePermanentBtn" class="chm-btn action-delete-perm">Delete Permanently</button>
                </div>
                
            </div>
            <div id="chm-loader" style="display: none;"><div></div></div>
        </div>
      `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = cssTemplate;
    document.head.appendChild(styleSheet);
    const container = document.createElement("div");
    container.id = "chm-container";
    container.innerHTML = htmlTemplate;
    document.body.appendChild(container);
    uiInjected = true;
    addEventListeners();
  }

  /**
   * Adds event listeners to the UI elements after they are injected.
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
      .addEventListener("click", () => handleBulkAction("deletePermanent"));
    document
      .getElementById("chm-time-filter")
      .addEventListener("change", applyFilterAndRender);
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
  }

  // --- UI Logic and Event Handlers ---

  function toggleUiVisibility(show) {
    if (!uiInjected) {
      if (show) {
        injectUI();
        setTimeout(() => {
          document.getElementById("chm-container").classList.add("visible");
          switchView("history");
        }, 10);
      }
      return;
    }
    const container = document.getElementById("chm-container");
    if (show) {
      container.style.display = "flex";
      setTimeout(() => {
        container.classList.add("visible");
        switchView(currentView);
      }, 10);
    } else {
      container.classList.remove("visible");
      // ADDED: Clear cache when the popup is closed
      clearCache();
      setTimeout(() => {
        container.style.display = "none";
      }, 200);
    }
  }

  function groupAndSortConversations(items) {
    // Sort by update_time descending
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

  function renderConversations(groupedItems, containerId) {
    const container = document.getElementById(containerId);
    // CHANGED: Don't clear innerHTML if we are loading more.
    // We will clear it manually before the first render.
    let hasContent = allConversations.length > 0;

    // Remove any existing "Load More" button before re-rendering
    const existingLoadMoreBtn = container.querySelector(".chm-load-more-btn");
    if (existingLoadMoreBtn) {
      existingLoadMoreBtn.remove();
    }

    // Clear the container only if it's the first page load for this view
    if (
      (containerId === "historyList" && historyOffset === 100) ||
      (containerId === "archivedList" && archivedOffset === 100)
    ) {
      container.innerHTML = "";
    }

    // If it's the very first load, the container will be empty.
    // If we are loading more, we just append new groups.
    // This logic is simplified by re-grouping and re-rendering the whole list.
    container.innerHTML = "";

    for (const groupName in groupedItems) {
      const items = groupedItems[groupName];
      if (items.length > 0) {
        const header = document.createElement("h3");
        header.className = "chm-date-group-header";
        header.textContent = groupName;
        container.appendChild(header);

        items.forEach((item) => {
          const itemEl = document.createElement("div");
          itemEl.className = "chm-conversation-item";
          itemEl.innerHTML = `
                          <label class="chm-checkbox-label">
                              <input type="checkbox" data-id="${item.id}">
                              <span class="chm-custom-checkbox"></span>
                          </label>
                          <span class="title">${item.title}</span>
                          <span class="time">${new Date(
                            item.update_time
                          ).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}</span>
                      `;
          container.appendChild(itemEl);
        });
      }
    }

    if (!hasContent) {
      container.innerHTML = `<p style="color: var(--text-tertiary); text-align: center; padding: 1rem;">No conversations found.</p>`;
    }

    // ADDED: "Load More" button logic
    const total = currentView === "history" ? historyTotal : archivedTotal;
    if (allConversations.length < total) {
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.textContent = isLoadingMore
        ? "Loading..."
        : `Load More (${allConversations.length} / ${total})`;
      loadMoreBtn.className = "chm-btn chm-load-more-btn";
      loadMoreBtn.disabled = isLoadingMore;
      loadMoreBtn.addEventListener("click", loadMoreConversations);
      container.appendChild(loadMoreBtn);
    }
  }

  /**
   * ADDED: Handles loading more conversations for the current view.
   */
  async function loadMoreConversations() {
    if (isLoadingMore) return;
    isLoadingMore = true;

    // Update button state
    applyFilterAndRender();

    const isArchived = currentView === "archived";
    const offset = isArchived ? archivedOffset : historyOffset;

    const { items, total } = await fetchConversations(isArchived, offset);

    if (items.length > 0) {
      allConversations.push(...items);
      // Update state for the next load
      if (isArchived) {
        archivedOffset += items.length;
        archivedTotal = total;
      } else {
        historyOffset += items.length;
        historyTotal = total;
      }
      // Cache the newly expanded list
      await cacheConversations();
    }

    isLoadingMore = false;
    applyFilterAndRender();
  }

  /**
   * ADDED: Caches the current `allConversations` list to local storage.
   */
  async function cacheConversations() {
    const cacheKey =
      currentView === "history" ? HISTORY_CACHE_KEY : ARCHIVED_CACHE_KEY;
    const dataToCache = {
      conversations: allConversations,
      offset: currentView === "history" ? historyOffset : archivedOffset,
      total: currentView === "history" ? historyTotal : archivedTotal,
      timestamp: Date.now(),
    };
    await chrome.storage.local.set({ [cacheKey]: dataToCache });
    console.log(
      `💾 [History Manager] Cached ${allConversations.length} conversations for ${currentView} view.`
    );
  }

  async function switchView(view) {
    currentView = view;
    const historyTab = document.getElementById("historyTab");
    const archivedTab = document.getElementById("archivedTab");
    const historyView = document.getElementById("historyView");
    const archivedView = document.getElementById("archivedView");
    const historyActions = document.getElementById("history-actions");
    const archivedActions = document.getElementById("archived-actions");

    // Reset selection when switching views
    document.getElementById("selectAllHistory").checked = false;
    document.getElementById("selectAllArchived").checked = false;

    if (view === "history") {
      historyTab.classList.add("active");
      archivedTab.classList.remove("active");
      historyView.style.display = "block";
      archivedView.style.display = "none";
      historyActions.style.display = "flex";
      archivedActions.style.display = "none";
    } else {
      archivedTab.classList.add("active");
      historyTab.classList.remove("active");
      historyView.style.display = "none";
      archivedView.style.display = "block";
      historyActions.style.display = "none";
      archivedActions.style.display = "flex";
    }

    // CHANGED: Caching and loading logic
    showLoader();
    const cacheKey =
      view === "history" ? HISTORY_CACHE_KEY : ARCHIVED_CACHE_KEY;
    const result = await chrome.storage.local.get(cacheKey);
    const cachedData = result[cacheKey];

    if (cachedData) {
      console.log(
        `🚀 [History Manager] Loading ${view} conversations from cache.`
      );
      allConversations = cachedData.conversations;
      if (view === "history") {
        historyOffset = cachedData.offset;
        historyTotal = cachedData.total;
      } else {
        archivedOffset = cachedData.offset;
        archivedTotal = cachedData.total;
      }
      applyFilterAndRender();
      hideLoader();
    } else {
      console.log(`🌐 [History Manager] Fetching fresh ${view} conversations.`);
      // Reset state for a fresh load
      allConversations = [];
      if (view === "history") {
        historyOffset = 0;
        historyTotal = 0;
      } else {
        archivedOffset = 0;
        archivedTotal = 0;
      }
      // loadMore will fetch, set state, cache, and render
      await loadMoreConversations();
    }
    hideLoader();
  }

  function applyFilterAndRender() {
    const isArchived = currentView === "archived";
    const listId = isArchived ? "archivedList" : "historyList";
    let conversationsToRender = allConversations;

    // Filtering only applies to the history view
    if (!isArchived) {
      const range = document.getElementById("chm-time-filter").value;
      if (range !== "all") {
        const now = new Date();
        let threshold = new Date(now);
        switch (range) {
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

  async function handleBulkAction(action) {
    const listId = currentView === "history" ? "historyList" : "archivedList";
    const listContainer = document.getElementById(listId);
    let selectedIds = [
      ...listContainer.querySelectorAll('input[type="checkbox"]:checked'),
    ].map((cb) => cb.dataset.id);

    let targetIds = selectedIds;
    let isOperatingOnAll = false;

    if (targetIds.length === 0) {
      alert("Please select at least one conversation.");
      return;
    }

    // Special handling for bulk delete is now just a normal operation on selected items
    // The "delete all" function is separate.

    let message, payload;
    switch (action) {
      case "archive":
        message = `Are you sure you want to archive ${targetIds.length} conversation(s)?`;
        payload = { is_archived: true };
        break;
      case "delete":
        message = `Are you sure you want to delete ${targetIds.length} conversation(s)? This will permanently delete them.`;
        payload = { is_visible: false };
        break;
      case "restore":
        message = `Are you sure you want to restore ${targetIds.length} conversation(s)?`;
        payload = { is_archived: false };
        break;
      case "deletePermanent":
        message = `This is IRREVERSIBLE. Permanently delete ${targetIds.length} conversation(s)?`;
        payload = { is_visible: false };
        break;
    }

    if (confirm(message)) {
      showLoader();
      const promises = targetIds.map((id) => updateConversation(id, payload));
      await Promise.all(promises);

      // ADDED: Clear cache after a successful bulk action
      clearCache();

      await switchView(currentView); // This will now force a fresh reload from the API
      hideLoader();
    }
  }

  // --- Utility Functions ---
  function showLoader() {
    if (uiInjected)
      document.getElementById("chm-loader").style.display = "flex";
  }

  function hideLoader() {
    if (uiInjected)
      document.getElementById("chm-loader").style.display = "none";
  }

  function showError(message) {
    alert(`[History Manager Error] ${message}`);
  }

  /**
   * ADDED: Clears the conversation cache from local storage.
   */
  function clearCache() {
    // This API is asynchronous but we often don't need to wait for it.
    chrome.storage.local.remove([HISTORY_CACHE_KEY, ARCHIVED_CACHE_KEY], () => {
      console.log("🧹 [History Manager] Local cache cleared.");
    });
  }

  // --- Entry Point ---
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      const container = document.getElementById("chm-container");
      const isVisible = container && container.style.display !== "none";
      toggleUiVisibility(!isVisible);
    }
  });
  console.log(
    "✅ [History Manager] Content script loaded. Press Ctrl+H to open."
  );

  injectSidebarButton();
  /**
   * Injects a button into the sidebar using a MutationObserver to robustly handle
   * cases where the sidebar is rendered, removed, or re-rendered dynamically.
   */
  function injectSidebarButton() {
    waitForAsideAndObserve();

    const injectionLogic = () => {
      if (document.getElementById("chm-sidebar-btn")) {
        return true; // Already injected
      }
      const sidebarNav = document.querySelector("aside");
      if (!sidebarNav) {
        return false; // Target not found
      }

      console.log("🚀 [History Manager] Injecting sidebar button...");

      const historyIconSVG = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </svg>
      `;

      const buttonWrapper = document.createElement("div");
      buttonWrapper.innerHTML = `
        <div id="chm-sidebar-btn" tabindex="0" class="group __menu-item hoverable cursor-pointer">
            <div class="flex min-w-0 items-center gap-1.5">
                <div class="flex items-center justify-center icon">${historyIconSVG}</div>
                <div class="flex min-w-0 grow items-center gap-2.5">
                    <div class="truncate">History Manager</div>
                </div>
            </div>
            <div class="trailing highlight text-token-text-tertiary">
                <div class="touch:hidden">
                    <div class="inline-flex whitespace-pre *:inline-flex *:font-sans *:not-last:after:px-0.5 *:not-last:after:content-['+']">
                        <kbd aria-label="Control"><span class="min-w-[1em]">Ctrl</span></kbd>
                        <kbd><span class="min-w-[1em]">H</span></kbd>
                    </div>
                </div>
            </div>
        </div>
      `;
      const buttonElement = buttonWrapper.firstElementChild;

      buttonElement.addEventListener("click", (e) => {
        e.preventDefault();
        toggleUiVisibility(true);
      });

      sidebarNav.appendChild(buttonElement);
      console.log("✅ [History Manager] Sidebar button injected successfully.");
      return true;
    };

    const observer = new MutationObserver((mutations) => {
      injectionLogic();
    });

    function waitForAsideAndObserve() {
      const interval = setInterval(() => {
        const aside = document.body.querySelector("aside");
        if (aside) {
          clearInterval(interval);
          observer.observe(aside, {
            childList: true,
            subtree: true,
          });
          injectionLogic();
        }
      }, 2000);
    }
  }
})();
