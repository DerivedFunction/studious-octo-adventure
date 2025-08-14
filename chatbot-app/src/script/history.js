(() => {
  // This IIFE (Immediately Invoked Function Expression) encapsulates the entire script
  // to prevent conflicts with the ChatGPT page's own JavaScript.

  // --- State Variables ---
  let accessToken = null;
  let allConversations = []; // Store all fetched conversations for filtering
  let currentView = "history";
  let uiInjected = false;

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
   * @returns {Promise<Array>} A list of conversation items.
   */
  async function fetchConversations(isArchived = false) {
    showLoader();
    const token = await getAccessToken();
    if (!token) {
      hideLoader();
      return [];
    }

    try {
      const response = await fetch(
        `https://chatgpt.com/backend-api/conversations?offset=0&limit=100&is_archived=${isArchived}`,
        {
          // Increased limit
          headers: { authorization: `Bearer ${token}` },
        }
      );
      if (!response.ok)
        throw new Error(`API request failed. Status: ${response.status}`);
      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error(
        `❌ [History Manager] Failed to fetch conversations:`,
        error
      );
      showError(`Failed to load conversations.`);
      return [];
    } finally {
      hideLoader();
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
          body: JSON.stringify({ is_visible: false }),
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
                background-color: var(--main-surface-primary, #ffffff); color: var(--text-primary, #000000);
                border: 1px solid var(--border-medium, #e5e5e5);
                border-radius: 16px; /* Increased border-radius for a softer look */
                width: 80vw; height: 80vh; display: flex; flex-direction: column;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden;
                transform: scale(0.95);
                transition: transform 0.2s ease-in-out;
            }
            #chm-container.visible #chm-modal {
                transform: scale(1);
            }
            #chm-header {
                padding: 16px 20px; border-bottom: 1px solid var(--border-light, #f0f0f0);
                display: flex; justify-content: space-between; align-items: center;
            }
            #chm-header h1 { font-size: 1.125rem; font-weight: 600; } /* Adjusted font size */
            #chm-close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-tertiary); transition: color 0.2s; }
            #chm-close-btn:hover { color: var(--text-secondary); }
            #chm-tabs { display: flex; border-bottom: 1px solid var(--border-light); padding: 0 16px; }
            #chm-tabs button { flex-grow: 0; padding: 12px 16px; font-weight: 500; border: none; background: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--text-secondary); }
            #chm-tabs button.active { color: var(--text-primary); border-bottom-color: var(--text-primary, #000); } /* Matched active tab color */
            #chm-content { flex-grow: 1; padding: 16px 20px; overflow-y: auto; }
            .chm-action-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border-light); }
            .chm-action-bar-group { display: flex; align-items: center; gap: 12px; }
            .chm-btn { 
                padding: 8px 16px; 
                border-radius: 9999px; /* Pill shape */
                font-size: var(--text-sm, 0.875rem);
                font-weight: var(--font-weight-medium, 500);
                cursor: pointer; 
                border-width: 1px;
                border-style: solid;
                transition: background-color 0.2s, border-color 0.2s; 
            }
            .chm-btn.action-archive { 
                background-color: var(--main-surface-secondary); 
                color: var(--text-primary); 
                border-color: var(--border-medium);
            }
            .chm-btn.action-archive:hover { background-color: var(--surface-hover); }
            .chm-btn.action-delete { background-color: var(--text-danger, #ef4444); color: #fff; border: none; }
            .chm-btn.action-restore { background-color: var(--main-surface-secondary); color: var(--text-primary); border-color: var(--border-medium); }
            .chm-btn.action-delete-perm { background-color: var(--text-danger, #ef4444); color: #fff; border: none; }
            .chm-conversation-item { display: flex; align-items: center; padding: 12px; border-radius: 8px; border: 1px solid transparent; transition: background-color 0.2s, border-color 0.2s; }
            .chm-conversation-item:hover { background-color: var(--surface-hover); }
            .chm-conversation-item .title { flex-grow: 1; margin: 0 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .chm-conversation-item .time { font-size: 0.8rem; color: var(--text-tertiary); }
            #historyList, #archivedList { padding-top: 8px; }
            .chm-date-group-header { font-weight: 500; color: var(--text-secondary); padding: 16px 4px 8px 4px; font-size: 0.8rem; text-transform: uppercase; } /* Styled date headers */
            #historyList > .chm-conversation-item + .chm-conversation-item, #archivedList > .chm-conversation-item + .chm-conversation-item { margin-top: 4px; } /* Reduced space between items */
            #chm-loader { position: absolute; inset: 0; background: rgba(255,255,255,0.8); display: flex; align-items: center; justify-content: center; }
            #chm-loader div { width: 48px; height: 48px; border: 4px solid var(--border-light); border-top-color: var(--tag-blue); border-radius: 50%; animation: spin 1s linear infinite; }
            #chm-time-filter { background-color: var(--main-surface-secondary); border: 1px solid var(--border-medium); border-radius: 8px; padding: 8px; font-size: 0.875rem; color: var(--text-primary); }
            @keyframes spin { to { transform: rotate(360deg); } }
        `;

    // --- HTML Template ---
    const htmlTemplate = `
            <div id="chm-modal">
                <div id="chm-header">
                    <h1>ChatGPT History Manager</h1>
                    <button id="chm-close-btn">&times;</button>
                </div>
                <div id="chm-tabs">
                    <button id="historyTab" class="active">History</button>
                    <button id="archivedTab">Archived</button>
                </div>
                <div id="chm-content">
                    <!-- History View -->
                    <div id="historyView">
                        <div class="chm-action-bar">
                            <div class="chm-action-bar-group">
                                <label><input type="checkbox" id="selectAllHistory"> Select All</label>
                                <select id="chm-time-filter">
                                    <option value="all">All time</option>
                                    <option value="1h">Last hour</option>
                                    <option value="24h">Last 24 hours</option>
                                    <option value="7d">Last 7 days</option>
                                    <option value="30d">Last 30 days</option>
                                </select>
                            </div>
                            <div class="chm-action-bar-group">
                                <button id="archiveSelectedBtn" class="chm-btn action-archive">Archive</button>
                                <button id="deleteSelectedBtn" class="chm-btn action-delete">Delete</button>
                            </div>
                        </div>
                        <div id="historyList"></div>
                    </div>
                    <!-- Archived View -->
                    <div id="archivedView" style="display: none;">
                        <div class="chm-action-bar">
                             <div class="chm-action-bar-group">
                                <label><input type="checkbox" id="selectAllArchived"> Select All</label>
                            </div>
                            <div class="chm-action-bar-group">
                                <button id="restoreSelectedBtn" class="chm-btn action-restore">Restore</button>
                                <button id="deletePermanentBtn" class="chm-btn action-delete-perm">Delete Permanently</button>
                            </div>
                        </div>
                        <div id="archivedList"></div>
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
        // Delay adding the 'visible' class to allow the transition to play
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
      // Hide the element after the transition ends
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
        // Group older items by month and year
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
    container.innerHTML = "";
    let hasContent = false;

    for (const groupName in groupedItems) {
      const items = groupedItems[groupName];
      if (items.length > 0) {
        hasContent = true;
        const header = document.createElement("h3");
        header.className = "chm-date-group-header";
        header.textContent = groupName;
        container.appendChild(header);

        items.forEach((item) => {
          const itemEl = document.createElement("div");
          itemEl.className = "chm-conversation-item";
          itemEl.innerHTML = `
                        <input type="checkbox" data-id="${item.id}">
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
  }

  async function switchView(view) {
    currentView = view;
    const historyTab = document.getElementById("historyTab");
    const archivedTab = document.getElementById("archivedTab");
    const historyView = document.getElementById("historyView");
    const archivedView = document.getElementById("archivedView");

    if (view === "history") {
      historyTab.classList.add("active");
      archivedTab.classList.remove("active");
      historyView.style.display = "block";
      archivedView.style.display = "none";
      allConversations = await fetchConversations(false);
      applyFilterAndRender();
    } else {
      archivedTab.classList.add("active");
      historyTab.classList.remove("active");
      historyView.style.display = "none";
      archivedView.style.display = "block";
      allConversations = await fetchConversations(true);
      const grouped = groupAndSortConversations(allConversations);
      renderConversations(grouped, "archivedList");
    }
  }

  function applyFilterAndRender() {
    const range = document.getElementById("chm-time-filter").value;
    let filteredConversations = allConversations;

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
      filteredConversations = allConversations.filter(
        (c) => new Date(c.update_time) > threshold
      );
    }

    const grouped = groupAndSortConversations(filteredConversations);
    renderConversations(grouped, "historyList");
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
      const allVisibleIds = [
        ...listContainer.querySelectorAll('input[type="checkbox"]'),
      ].map((cb) => cb.dataset.id);
      if (allVisibleIds.length === 0) {
        alert("There are no conversations to act upon.");
        return;
      }
      targetIds = allVisibleIds;
      isOperatingOnAll = true;
    }

    // Case 2: Special handling for bulk delete from History tab
    if (action === "delete" && currentView === "history" && isOperatingOnAll) {
      const confirmation = confirm(
        "WARNING: This will permanently delete ALL of your conversations, including those in the archive. This action cannot be undone. Are you sure you want to proceed?"
      );
      if (confirmation) {
        showLoader();
        const success = await deleteAllConversations();
        if (success) {
          await switchView("history"); // Refresh view
        } else {
          showError("Failed to delete all conversations.");
        }
        hideLoader();
      }
      return; // End execution for this specific case
    }

    // Safety Guard for Permanent Delete: Must have specific selections.
    if (action === "deletePermanent" && isOperatingOnAll) {
      alert(
        "For safety, please select specific conversations to permanently delete. 'Delete All' is not available for this action."
      );
      return;
    }

    let message, payload;
    switch (action) {
      case "archive":
        message = isOperatingOnAll
          ? `Are you sure you want to archive all ${targetIds.length} visible conversation(s)?`
          : `Are you sure you want to archive ${targetIds.length} conversation(s)?`;
        payload = { is_archived: true };
        break;
      case "delete":
        message = isOperatingOnAll
          ? `Are you sure you want to delete all ${targetIds.length} visible conversation(s)? They will be moved to archived.`
          : `Are you sure you want to delete ${targetIds.length} conversation(s)? They will be moved to archived.`;
        payload = { is_archived: true };
        break;
      case "restore":
        message = isOperatingOnAll
          ? `Are you sure you want to restore all ${targetIds.length} conversation(s) in this view?`
          : `Are you sure you want to restore ${targetIds.length} conversation(s)?`;
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
      await switchView(currentView);
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
})();
