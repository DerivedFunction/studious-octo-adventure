(() => {
  let accessToken = null;
  let allConversations = [];
  let currentView = "history";
  let uiInjected = false;
  let historyOffset = 0;
  let archivedOffset = 0;
  let historyTotal = 0;
  let archivedTotal = 0;
  let isLoadingMore = false;

  const HISTORY_CACHE_KEY = "chm_history_cache";
  const ARCHIVED_CACHE_KEY = "chm_archived_cache";

  clearCache();

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
   * @param {number} offset - The starting point for fetching conversations.
   * @returns {Promise<object>} An object containing conversation items and total count.
   */
  async function fetchConversations(isArchived = false, offset = 0) {
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

  /**
   * Creates and injects the UI and CSS into the page.
   */
  function injectUI() {
    if (uiInjected) return;

    // Helper function to create elements with attributes and children
    function createElement(tag, attributes, children = []) {
      const el = document.createElement(tag);
      for (const key in attributes) {
        if (key === "className") {
          el.className = attributes[key];
        } else if (key === "style") {
          Object.assign(el.style, attributes[key]);
        } else {
          el.setAttribute(key, attributes[key]);
        }
      }
      children.forEach((child) => {
        if (typeof child === "string") {
          el.appendChild(document.createTextNode(child));
        } else {
          el.appendChild(child);
        }
      });
      return el;
    }

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

    const styleSheet = document.createElement("style");
    styleSheet.textContent = cssTemplate;
    document.head.appendChild(styleSheet);

    // Programmatically create all UI elements
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
          createElement("div", { className: "chm-action-bar" }, [
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
              createElement("select", { id: "chm-time-filter" }, [
                createElement("option", { value: "all" }, ["All time"]),
                createElement("option", { value: "1h" }, ["Last hour"]),
                createElement("option", { value: "24h" }, ["Last 24 hours"]),
                createElement("option", { value: "7d" }, ["Last 7 days"]),
                createElement("option", { value: "30d" }, ["Last 30 days"]),
              ]),
            ]),
          ]),
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
              ["Delete Permanently"]
            ),
          ]
        ),
      ]),
      createElement("div", { id: "chm-loader", style: { display: "none" } }, [
        createElement("div", {}),
      ]),
    ]);

    const container = createElement("div", { id: "chm-container" }, [modal]);
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
      clearCache();
      setTimeout(() => {
        container.style.display = "none";
      }, 200);
    }
  }

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

  function renderConversations(groupedItems, containerId) {
    const container = document.getElementById(containerId);
    let hasContent = allConversations.length > 0;

    const existingLoadMoreBtn = container.querySelector(".chm-load-more-btn");
    if (existingLoadMoreBtn) {
      existingLoadMoreBtn.remove();
    }

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const fragment = document.createDocumentFragment();

    for (const groupName in groupedItems) {
      const items = groupedItems[groupName];
      if (items.length > 0) {
        const header = document.createElement("h3");
        header.className = "chm-date-group-header";
        header.textContent = groupName;
        fragment.appendChild(header);

        items.forEach((item) => {
          const itemEl = document.createElement("div");
          itemEl.className = "chm-conversation-item";

          const itemFragment = document.createDocumentFragment();

          const label = document.createElement("label");
          label.className = "chm-checkbox-label";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.dataset.id = item.id;

          const customCheckbox = document.createElement("span");
          customCheckbox.className = "chm-custom-checkbox";

          label.appendChild(checkbox);
          label.appendChild(customCheckbox);

          const titleSpan = document.createElement("span");
          titleSpan.className = "title";
          titleSpan.textContent = item.title;

          const timeSpan = document.createElement("span");
          timeSpan.className = "time";
          timeSpan.textContent = new Date(item.update_time).toLocaleTimeString(
            [],
            {
              hour: "numeric",
              minute: "2-digit",
            }
          );

          itemFragment.appendChild(label);
          itemFragment.appendChild(titleSpan);
          itemFragment.appendChild(timeSpan);

          itemEl.appendChild(itemFragment);
          fragment.appendChild(itemEl);
        });
      }
    }
    container.appendChild(fragment);

    if (!hasContent) {
      const p = document.createElement("p");
      p.style.color = "var(--text-tertiary)";
      p.style.textAlign = "center";
      p.style.padding = "1rem";
      p.textContent = "No conversations found.";
      container.appendChild(p);
    }

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
   * Handles loading more conversations for the current view.
   */
  async function loadMoreConversations() {
    if (isLoadingMore) return;
    isLoadingMore = true;

    applyFilterAndRender();

    const isArchived = currentView === "archived";
    const offset = isArchived ? archivedOffset : historyOffset;

    const { items, total } = await fetchConversations(isArchived, offset);

    if (items.length > 0) {
      allConversations.push(...items);
      if (isArchived) {
        archivedOffset += items.length;
        archivedTotal = total;
      } else {
        historyOffset += items.length;
        historyTotal = total;
      }
      await cacheConversations();
    }

    isLoadingMore = false;
    applyFilterAndRender();
  }

  /**
   * Caches the current `allConversations` list to local storage.
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
    await chrome.storage.local.set({
      [cacheKey]: dataToCache,
    });
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
      allConversations = [];
      if (view === "history") {
        historyOffset = 0;
        historyTotal = 0;
      } else {
        archivedOffset = 0;
        archivedTotal = 0;
      }
      await loadMoreConversations();
    }
    hideLoader();
  }

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

    if (targetIds.length === 0) {
      alert("Please select at least one conversation.");
      return;
    }

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

      clearCache();

      await switchView(currentView);
      hideLoader();
    }
  }

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
   * Clears the conversation cache from local storage.
   */
  function clearCache() {
    chrome.storage.local.remove([HISTORY_CACHE_KEY, ARCHIVED_CACHE_KEY], () => {
      console.log("🧹 [History Manager] Local cache cleared.");
    });
  }

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
        return true;
      }
      const sidebarNav = document.querySelector("aside");
      if (!sidebarNav) {
        return false;
      }

      console.log("🚀 [History Manager] Injecting sidebar button...");

      // Helper function for creating namespaced SVG elements
      function createSvgElement(tag, attributes) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const key in attributes) {
          el.setAttribute(key, attributes[key]);
        }
        return el;
      }

      // Create SVG icon programmatically
      const svgIcon = createSvgElement("svg", {
        xmlns: "http://www.w3.org/2000/svg",
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
      svgIcon.appendChild(createSvgElement("path", { d: "M3 3v5h5" }));
      svgIcon.appendChild(createSvgElement("path", { d: "M12 7v5l4 2" }));

      // Create button structure programmatically
      const buttonElement = document.createElement("div");
      buttonElement.id = "chm-sidebar-btn";
      buttonElement.tabIndex = 0;
      buttonElement.className = "group __menu-item hoverable cursor-pointer";

      const contentWrapper = document.createElement("div");
      contentWrapper.className = "flex min-w-0 items-center gap-1.5";

      const iconWrapper = document.createElement("div");
      iconWrapper.className = "flex items-center justify-center icon";
      iconWrapper.appendChild(svgIcon);

      const textWrapper = document.createElement("div");
      textWrapper.className = "flex min-w-0 grow items-center gap-2.5";
      const text = document.createElement("div");
      text.className = "truncate";
      text.textContent = "History Manager";
      textWrapper.appendChild(text);

      contentWrapper.appendChild(iconWrapper);
      contentWrapper.appendChild(textWrapper);

      const trailingWrapper = document.createElement("div");
      trailingWrapper.className = "trailing highlight text-token-text-tertiary";
      const shortcutWrapper = document.createElement("div");
      shortcutWrapper.className = "touch:hidden";
      const shortcutInner = document.createElement("div");
      shortcutInner.className =
        "inline-flex whitespace-pre *:inline-flex *:font-sans *:not-last:after:px-0.5 *:not-last:after:content-['+']";

      const kbdCtrl = document.createElement("kbd");
      kbdCtrl.setAttribute("aria-label", "Control");
      const spanCtrl = document.createElement("span");
      spanCtrl.className = "min-w-[1em]";
      spanCtrl.textContent = "Ctrl";
      kbdCtrl.appendChild(spanCtrl);

      const kbdH = document.createElement("kbd");
      const spanH = document.createElement("span");
      spanH.className = "min-w-[1em]";
      spanH.textContent = "H";
      kbdH.appendChild(spanH);

      shortcutInner.appendChild(kbdCtrl);
      shortcutInner.appendChild(kbdH);
      shortcutWrapper.appendChild(shortcutInner);
      trailingWrapper.appendChild(shortcutWrapper);

      buttonElement.appendChild(contentWrapper);
      buttonElement.appendChild(trailingWrapper);

      buttonElement.addEventListener("click", (e) => {
        e.preventDefault();
        toggleUiVisibility(true);
      });

      sidebarNav.appendChild(buttonElement);
      console.log("✅ [History Manager] Sidebar button injected successfully.");
      return true;
    };

    const observer = new MutationObserver(() => {
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
