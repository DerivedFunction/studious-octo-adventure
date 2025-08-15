(() => {
  // This IIFE encapsulates the entire script to prevent conflicts.
  console.log(
    "🚀 [Label Explorer] Content script loaded. Press Ctrl+L to open."
  );

  // --- Configuration & State ---
  const STORAGE_KEY = "chatgptLabelExplorerData";
  let appState = {
    data: { labels: {}, chatLabels: {} },
    uiInjected: false,
    accessToken: null,
  };

  // --- 1. CORE LOGIC & DATA MANAGEMENT ---

  /**
   * Fetches data from chrome.storage.local or returns a default structure.
   * @returns {Promise<object>} The stored data.
   */
  async function getStoredData() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const data = result[STORAGE_KEY];
      if (data && data.labels && data.chatLabels) {
        return data;
      }
    } catch (e) {
      console.error("[Label Explorer] Error reading from storage:", e);
    }
    // Return a default empty structure if data is invalid or not found
    return { labels: {}, chatLabels: {} };
  }

  /**
   * Saves the provided data object to chrome.storage.local.
   * @param {object} data - The data to save.
   */
  async function saveStoredData(data) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (e) {
      console.error("[Label Explorer] Error saving to storage:", e);
    }
  }

  /**
   * Fetches and caches the ChatGPT access token.
   * @returns {Promise<string|null>} The access token.
   */
  async function getAccessToken() {
    if (appState.accessToken) return appState.accessToken;
    try {
      const response = await fetch("https://chatgpt.com/api/auth/session");
      if (!response.ok)
        throw new Error(`Auth fetch failed: ${response.status}`);
      const session = await response.json();
      if (!session.accessToken) throw new Error("Access token not found.");
      appState.accessToken = session.accessToken;
      return appState.accessToken;
    } catch (error) {
      console.error("[Label Explorer] Could not retrieve access token:", error);
      return null;
    }
  }

  /**
   * Fetches all conversations from the ChatGPT API.
   * @returns {Promise<Array>} A list of conversation items.
   */
  async function fetchAllConversations() {
    const token = await getAccessToken();
    if (!token) return [];
    try {
      // Note: In a real-world scenario, you might need to handle pagination if limit is capped.
      const response = await fetch(
        `https://chatgpt.com/backend-api/conversations?offset=0&limit=100&order=updated`,
        {
          headers: { authorization: `Bearer ${token}` },
        }
      );
      if (!response.ok)
        throw new Error(`API request failed: ${response.status}`);
      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error("[Label Explorer] Failed to fetch conversations:", error);
      return [];
    }
  }

  // --- 2. UI, STYLES, AND INJECTION ---

  /**
   * Creates and injects all UI elements (CSS, Modal) into the page.
   */
  function injectUI() {
    if (appState.uiInjected) return;

    // --- CSS Template ---
    const cssTemplate = `
      .le-modal-container {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background-color: rgba(0, 0, 0, 0.6); z-index: 10000;
        display: flex; align-items: center; justify-content: center; font-family: inherit;
        opacity: 0; transition: opacity 0.2s ease-in-out;
      }
      .le-modal-container.visible { opacity: 1; }
      .le-modal {
        background-color: var(--main-surface-primary); color: var(--text-primary);
        border: 1px solid var(--border-medium); border-radius: 16px;
        width: 80vw; max-width: 800px; height: 80vh; display: flex; flex-direction: column;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden;
        transform: scale(0.95); transition: transform 0.2s ease-in-out;
      }
      .le-modal-container.visible .le-modal { transform: scale(1); }
      .le-header { padding: 16px 20px; border-bottom: 1px solid var(--border-light); }
      .le-search-bar {
        display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
        background-color: var(--main-surface-secondary); border-radius: 8px; padding: 4px;
      }
      .le-search-bar input {
        flex-grow: 1; background: transparent; border: none; outline: none;
        color: var(--text-primary); font-size: 1rem; padding: 8px; min-width: 150px;
      }
      .le-content { flex-grow: 1; overflow-y: auto; padding: 8px 20px; }
      .le-conversation-item {
        display: flex; align-items: center; padding: 12px 8px; border-radius: 8px;
        transition: background-color 0.2s; cursor: pointer;
      }
      .le-conversation-item:hover { background-color: var(--surface-hover); }
      .le-conversation-item .title { flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .le-label-pill {
        display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem;
        padding: 2px 8px; border-radius: 999px; color: white;
      }
      .le-label-pill.in-search { cursor: pointer; }
      .le-label-pills-container { display: flex; gap: 6px; flex-wrap: wrap; }
      .le-sidebar-pills-container { margin-top: 4px; padding-left: 36px; }
      .le-sidebar-btn {
        color: var(--text-secondary); margin-left: auto; padding: 4px;
        border-radius: 4px; transition: background-color 0.2s, color 0.2s;
      }
      .le-sidebar-btn:hover { background-color: var(--surface-hover); color: var(--text-primary); }
      .le-popover {
        position: absolute; z-index: 10001; background: var(--main-surface-primary);
        border: 1px solid var(--border-medium); border-radius: 8px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2); padding: 12px; width: 250px;
      }
      .le-popover-section { margin-bottom: 12px; }
      .le-popover-section h4 { font-size: 0.8rem; font-weight: 500; margin-bottom: 8px; color: var(--text-secondary); }
      .le-popover-labels-list { max-height: 150px; overflow-y: auto; }
      .le-popover-label-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
      .le-popover-label-item label { flex-grow: 1; }
      .le-popover-new-label-input { width: 100%; }
    `;

    // --- HTML Template for Modal ---
    const modalTemplate = `
      <div id="le-modal" class="le-modal">
        <div class="le-header">
          <div id="le-search-bar" class="le-search-bar">
            <input type="text" id="le-search-input" placeholder="Search by labels...">
          </div>
        </div>
        <div id="le-content" class="le-content">
          <p style="text-align: center; color: var(--text-tertiary); padding: 1rem;">
            Start typing to search for conversations by label.
          </p>
        </div>
      </div>
    `;

    const styleSheet = document.createElement("style");
    styleSheet.id = "le-styles";
    styleSheet.innerText = cssTemplate;
    document.head.appendChild(styleSheet);

    const container = document.createElement("div");
    container.id = "le-modal-container";
    container.className = "le-modal-container";
    container.innerHTML = modalTemplate;
    document.body.appendChild(container);

    appState.uiInjected = true;
    addModalEventListeners();
  }

  /**
   * Injects the label icon and pills container into a sidebar chat link.
   * @param {HTMLElement} chatElement - The <a> tag of the conversation.
   */
  async function injectSidebarUI(chatElement) {
    if (chatElement.dataset.leInjected) return;
    chatElement.dataset.leInjected = "true";

    const conversationId = chatElement.href.split("/").pop();
    const titleContainer = chatElement.querySelector("div.truncate");
    if (!titleContainer) return;

    // 1. Create and inject label pills container
    let pillsContainer = chatElement.parentElement.querySelector(
      ".le-sidebar-pills-container"
    );
    if (!pillsContainer) {
      pillsContainer = document.createElement("div");
      pillsContainer.className = "le-sidebar-pills-container";
      // Insert after the main link container
      chatElement.parentElement.insertBefore(
        pillsContainer,
        chatElement.nextSibling
      );
    }
    updateVisibleLabels(pillsContainer, conversationId);

    // 2. Create and inject the label icon button
    const labelButton = document.createElement("button");
    labelButton.className = "le-sidebar-btn";
    labelButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`;

    labelButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showLabelAssignmentPopover(labelButton, conversationId);
    });

    // Append button to the same container as the title
    titleContainer.parentElement.style.display = "flex"; // Ensure flex layout
    titleContainer.parentElement.appendChild(labelButton);
  }

  /**
   * Updates the visible label pills for a given conversation in the sidebar.
   * @param {HTMLElement} pillsContainer - The container to render pills into.
   * @param {string} conversationId - The ID of the conversation.
   */
  async function updateVisibleLabels(pillsContainer, conversationId) {
    pillsContainer.innerHTML = "";
    const { labels, chatLabels } = appState.data;
    const assignedLabelIds = chatLabels[conversationId] || [];

    if (assignedLabelIds.length > 0) {
      const fragment = document.createDocumentFragment();
      assignedLabelIds.forEach((labelId) => {
        const label = labels[labelId];
        if (label) {
          const pill = document.createElement("div");
          pill.className = "le-label-pill";
          pill.style.backgroundColor = label.color;
          pill.textContent = label.name;
          fragment.appendChild(pill);
        }
      });
      pillsContainer.appendChild(fragment);
    }
  }

  // --- 3. EVENT HANDLERS & DYNAMIC UI ---

  /**
   * Shows the popover for assigning/creating labels.
   * @param {HTMLElement} targetElement - The element to position the popover near.
   * @param {string} conversationId - The ID of the conversation.
   */
  function showLabelAssignmentPopover(targetElement, conversationId) {
    // Close any existing popover
    document.getElementById("le-popover")?.remove();

    const rect = targetElement.getBoundingClientRect();
    const popover = document.createElement("div");
    popover.id = "le-popover";
    popover.className = "le-popover";
    popover.style.top = `${rect.bottom + 5}px`;
    popover.style.right = `${window.innerWidth - rect.right - rect.width}px`;

    const { labels, chatLabels } = appState.data;
    const assignedLabelIds = new Set(chatLabels[conversationId] || []);

    let labelsListHTML = Object.entries(labels)
      .map(
        ([id, { name, color }]) => `
      <div class="le-popover-label-item">
        <input type="checkbox" id="le-cb-${id}" data-label-id="${id}" ${
          assignedLabelIds.has(id) ? "checked" : ""
        }>
        <label for="le-cb-${id}">${name}</label>
        <div class="le-label-pill" style="background-color:${color}; width: 12px; height: 12px; padding: 0;"></div>
      </div>
    `
      )
      .join("");

    popover.innerHTML = `
      <div class="le-popover-section">
        <h4>APPLY LABELS</h4>
        <div class="le-popover-labels-list">${
          labelsListHTML ||
          '<p style="font-size: 0.8rem; color: var(--text-tertiary);">No labels created yet.</p>'
        }</div>
      </div>
      <div class="le-popover-section">
        <h4>CREATE NEW</h4>
        <input type="text" id="le-new-label-input" placeholder="New label name..." class="le-popover-new-label-input" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid var(--border-medium); background: var(--main-surface-secondary);">
      </div>
    `;

    document.body.appendChild(popover);

    // --- Popover Event Listeners ---
    popover.addEventListener("click", (e) => e.stopPropagation()); // Prevent closing when clicking inside
    document.addEventListener("click", () => popover.remove(), { once: true });

    // Handle checkbox changes
    popover.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", async () => {
        const labelId = cb.dataset.labelId;
        const currentChatLabels =
          appState.data.chatLabels[conversationId] || [];
        if (cb.checked) {
          if (!currentChatLabels.includes(labelId)) {
            appState.data.chatLabels[conversationId] = [
              ...currentChatLabels,
              labelId,
            ];
          }
        } else {
          appState.data.chatLabels[conversationId] = currentChatLabels.filter(
            (id) => id !== labelId
          );
        }
        await saveStoredData(appState.data);
        const pillsContainer = targetElement
          .closest('div[class*="relative"]')
          .querySelector(".le-sidebar-pills-container");
        if (pillsContainer) updateVisibleLabels(pillsContainer, conversationId);
      });
    });

    // Handle new label creation
    const newLabelInput = document.getElementById("le-new-label-input");
    newLabelInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && newLabelInput.value.trim()) {
        const newName = newLabelInput.value.trim();
        const newId = `l-${Date.now()}`;
        const newColor = `hsl(${Math.random() * 360}, 70%, 50%)`;
        appState.data.labels[newId] = { name: newName, color: newColor };
        await saveStoredData(appState.data);
        popover.remove(); // Close and reopen to refresh the list
        showLabelAssignmentPopover(targetElement, conversationId);
      }
    });
  }

  /**
   * Toggles the main search modal's visibility.
   * @param {boolean} show - Whether to show or hide the modal.
   */
  function toggleModalVisibility(show) {
    if (!appState.uiInjected) {
      if (show) injectUI();
      else return;
    }
    const container = document.getElementById("le-modal-container");
    if (show) {
      container.style.display = "flex";
      setTimeout(() => container.classList.add("visible"), 10);
      document.getElementById("le-search-input").focus();
    } else {
      container.classList.remove("visible");
      setTimeout(() => (container.style.display = "none"), 200);
    }
  }

  /**
   * Adds all event listeners for the main search modal.
   */
  function addModalEventListeners() {
    const container = document.getElementById("le-modal-container");
    const searchInput = document.getElementById("le-search-input");

    container.addEventListener("click", (e) => {
      if (e.target.id === "le-modal-container") toggleModalVisibility(false);
    });

    searchInput.addEventListener("keyup", handleSearch);
  }

  /**
   * Handles the search logic and renders the filtered results.
   */
  async function handleSearch() {
    const searchInput = document.getElementById("le-search-input");
    const searchBar = document.getElementById("le-search-bar");
    const contentArea = document.getElementById("le-content");
    const query = searchInput.value.toLowerCase().trim();

    // Simple search: find conversations that have labels containing the query text.
    // A more advanced search would use pills like Gmail.

    if (!query) {
      contentArea.innerHTML = `<p style="text-align: center; color: var(--text-tertiary); padding: 1rem;">Start typing to search for conversations by label.</p>`;
      return;
    }

    const allConversations = await fetchAllConversations();
    const { labels, chatLabels } = appState.data;

    const matchingLabelIds = Object.entries(labels)
      .filter(([id, { name }]) => name.toLowerCase().includes(query))
      .map(([id]) => id);

    const filteredConversations = allConversations.filter((convo) => {
      const assignedLabels = chatLabels[convo.id] || [];
      return assignedLabels.some((labelId) =>
        matchingLabelIds.includes(labelId)
      );
    });

    renderSearchResults(filteredConversations);
  }

  /**
   * Renders the search results in the modal content area.
   * @param {Array} conversations - The list of conversations to render.
   */
  function renderSearchResults(conversations) {
    const contentArea = document.getElementById("le-content");
    const { labels, chatLabels } = appState.data;

    if (conversations.length === 0) {
      contentArea.innerHTML = `<p style="text-align: center; color: var(--text-tertiary); padding: 1rem;">No conversations found with matching labels.</p>`;
      return;
    }

    contentArea.innerHTML = "";
    const fragment = document.createDocumentFragment();
    conversations.forEach((convo) => {
      const itemEl = document.createElement("a");
      itemEl.className = "le-conversation-item";
      itemEl.href = `/c/${convo.id}`;
      itemEl.target = "_blank"; // Open in new tab for convenience

      const assignedLabelIds = chatLabels[convo.id] || [];
      const pillsHTML = assignedLabelIds
        .map((id) => {
          const label = labels[id];
          return label
            ? `<div class="le-label-pill" style="background-color:${label.color};">${label.name}</div>`
            : "";
        })
        .join("");

      itemEl.innerHTML = `
        <span class="title">${convo.title}</span>
        <div class="le-label-pills-container">${pillsHTML}</div>
      `;
      fragment.appendChild(itemEl);
    });
    contentArea.appendChild(fragment);
  }

  // --- 4. INITIALIZATION & OBSERVERS ---

  /**
   * Sets up the MutationObserver to watch for new chats in the sidebar.
   */
  function initializeSidebarObserver() {
    const observer = new MutationObserver((mutations) => {
      // Use a Set to avoid processing the same element multiple times
      const newChatLinks = new Set();
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            // ELEMENT_NODE
            if (node.matches('a[href^="/c/"]')) {
              newChatLinks.add(node);
            }
            node
              .querySelectorAll('a[href^="/c/"]')
              .forEach((link) => newChatLinks.add(link));
          }
        });
      });
      newChatLinks.forEach(injectSidebarUI);
    });

    const navElement = document.querySelector("nav");
    if (navElement) {
      observer.observe(navElement, { childList: true, subtree: true });
      // Initial run for already present chats
      navElement.querySelectorAll('a[href^="/c/"]').forEach(injectSidebarUI);
    } else {
      // If nav isn't ready, retry
      setTimeout(initializeSidebarObserver, 1000);
    }
  }

  /**
   * Main entry point for the script.
   */
  async function main() {
    appState.data = await getStoredData();

    // Hotkey to open the modal
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const isVisible = document
          .getElementById("le-modal-container")
          ?.classList.contains("visible");
        toggleModalVisibility(!isVisible);
      }
    });

    initializeSidebarObserver();
  }

  // Run the script
  main();
})();
