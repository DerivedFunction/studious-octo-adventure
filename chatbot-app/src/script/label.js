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
   * Injects the CSS styles into the page immediately.
   */
  function injectStyles() {
    if (document.getElementById("le-styles")) return; // Already injected

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
      .le-label-pill-clickable {
        cursor: pointer;
        transition: all 0.2s ease;
        padding: 8px 12px;
        font-size: 0.85rem;
        gap: 6px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .le-label-pill-clickable:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }
      .le-label-count {
        background-color: rgba(255,255,255,0.25);
        padding: 2px 6px;
        border-radius: 12px;
        font-size: 0.7rem;
        font-weight: 600;
        margin-left: 4px;
      }
      .le-available-labels-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;
        max-width: 600px;
        margin: 0 auto;
      }
      .le-label-pill.in-search { cursor: pointer; }
      .le-label-pills-container { display: flex; gap: 6px; flex-wrap: wrap; }
      .le-sidebar-btn {
        color: var(--text-secondary); margin-left: auto; padding: 4px;
        border-radius: 4px; transition: background-color 0.2s, color 0.2s;
      }
      .le-sidebar-btn:hover { background-color: var(--surface-hover); color: var(--text-primary); }
      .le-popover {
        position: fixed; 
        z-index: 10001; 
        background: var(--main-surface-primary);
        border: 1px solid var(--border-medium); 
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3); 
        padding: 16px; 
        width: 300px;
        max-height: 400px;
        overflow-y: auto;
        transform: translate(-50%, -50%);
        top: 50%;
        left: 50%;
      }
      .le-popover-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: rgba(0, 0, 0, 0.4);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
      }
      .le-popover-backdrop.visible {
        opacity: 1;
      }
      .le-popover-section { margin-bottom: 16px; }
      .le-popover-section:last-child { margin-bottom: 0; }
      .le-popover-section h4 { 
        font-size: 0.85rem; 
        font-weight: 600; 
        margin-bottom: 12px; 
        color: var(--text-secondary); 
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .le-popover-labels-list { max-height: 200px; overflow-y: auto; }
      .le-popover-label-item { 
        display: flex; 
        align-items: center; 
        gap: 12px; 
        padding: 8px 0; 
        border-bottom: 1px solid var(--border-light);
      }
      .le-popover-label-item:last-child {
        border-bottom: none;
      }
      .le-popover-label-item label { 
        flex-grow: 1; 
        cursor: pointer;
        font-size: 0.9rem;
      }
      .le-popover-label-item input[type="checkbox"] {
        margin-right: 8px;
        cursor: pointer;
      }
      .le-popover-new-label-input { 
        width: 100%; 
        padding: 10px; 
        border: 1px solid var(--border-medium);
        border-radius: 6px;
        background: var(--main-surface-secondary);
        color: var(--text-primary);
        font-size: 0.9rem;
      }
      .le-popover-new-label-input:focus {
        outline: none;
        border-color: var(--accent-primary, #10a37f);
      }
      .le-popover-close-btn {
        position: absolute;
        top: 8px;
        right: 12px;
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: var(--text-tertiary);
        transition: color 0.2s;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .le-popover-close-btn:hover {
        color: var(--text-secondary);
      }
      /* --- NEW STYLES FOR COLOR PICKER --- */
      .le-color-swatch-label {
        position: relative;
        display: block;
        width: 20px;
        height: 20px;
        cursor: pointer;
        border-radius: 50%;
        margin-left: auto; /* Pushes it to the right */
      }
      .le-color-picker-input {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        opacity: 0; /* Hide the input but keep it functional */
        cursor: pointer;
      }
      .le-color-swatch {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        border: 1px solid var(--border-light);
        pointer-events: none; /* Clicks go through to the input */
      }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.id = "le-styles";
    styleSheet.innerText = cssTemplate;
    document.head.appendChild(styleSheet);
  }

  /**
   * Creates and injects the modal HTML into the page.
   */
  function injectModal() {
    if (appState.uiInjected) return;

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

    const container = document.createElement("div");
    container.id = "le-modal-container";
    container.className = "le-modal-container";
    container.innerHTML = modalTemplate;
    document.body.appendChild(container);

    appState.uiInjected = true;
    addModalEventListeners();
  }

  /**
   * Injects the label icon button into a sidebar chat link.
   * @param {HTMLElement} chatElement - The <a> tag of the conversation.
   */
  async function injectSidebarUI(chatElement) {
    if (chatElement.dataset.leInjected) return;
    chatElement.dataset.leInjected = "true";

    const conversationId = chatElement.href.split("/").pop();
    const titleContainer = chatElement.querySelector("div.truncate");
    if (!titleContainer) return;

    // Create and inject the label icon button
    const labelButton = document.createElement("button");
    labelButton.className = "le-sidebar-btn";
    labelButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`;

    labelButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showLabelAssignmentPopover(conversationId);
    });

    // Append button to the same container as the title
    titleContainer.parentElement.style.display = "flex"; // Ensure flex layout
    titleContainer.parentElement.appendChild(labelButton);
  }

  // --- 3. EVENT HANDLERS & DYNAMIC UI ---

  /**
   * Shows the centered popover for assigning/creating labels.
   * @param {string} conversationId - The ID of the conversation.
   */
  function showLabelAssignmentPopover(conversationId) {
    // Close any existing popover
    closeLabelAssignmentPopover();

    // Create backdrop
    const backdrop = document.createElement("div");
    backdrop.id = "le-popover-backdrop";
    backdrop.className = "le-popover-backdrop";

    // Create popover
    const popover = document.createElement("div");
    popover.id = "le-popover";
    popover.className = "le-popover";

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
          <label class="le-color-swatch-label" title="Change label color">
            <input type="color" class="le-color-picker-input" data-label-id="${id}" value="${color}">
            <span class="le-color-swatch" style="background-color:${color};"></span>
          </label>
        </div>
      `
      )
      .join("");

    popover.innerHTML = `
      <button class="le-popover-close-btn">&times;</button>
      <div class="le-popover-section">
        <h4>Apply Labels</h4>
        <div class="le-popover-labels-list">${
          labelsListHTML ||
          '<p style="font-size: 0.85rem; color: var(--text-tertiary); text-align: center; padding: 1rem;">No labels created yet.</p>'
        }</div>
      </div>
      <div class="le-popover-section">
        <h4>Create New Label</h4>
        <input type="text" id="le-new-label-input" placeholder="Enter label name..." class="le-popover-new-label-input">
      </div>
    `;

    // Append to backdrop, then backdrop to body
    backdrop.appendChild(popover);
    document.body.appendChild(backdrop);

    // Show with animation
    setTimeout(() => backdrop.classList.add("visible"), 10);

    // --- Popover Event Listeners ---

    // Close button
    popover
      .querySelector(".le-popover-close-btn")
      .addEventListener("click", closeLabelAssignmentPopover);

    // Close on backdrop click
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeLabelAssignmentPopover();
    });

    // Prevent popover clicks from closing
    popover.addEventListener("click", (e) => e.stopPropagation());

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
      });
    });

    // --- NEW: Handle color changes ---
    popover.querySelectorAll(".le-color-picker-input").forEach((picker) => {
      picker.addEventListener("input", async (e) => {
        const labelId = e.target.dataset.labelId;
        const newColor = e.target.value;

        // Update the UI swatch immediately for real-time feedback
        const swatch = e.target.nextElementSibling;
        if (swatch) {
          swatch.style.backgroundColor = newColor;
        }

        // Update the state and save
        if (appState.data.labels[labelId]) {
          appState.data.labels[labelId].color = newColor;
          await saveStoredData(appState.data);
        }
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
        closeLabelAssignmentPopover(); // Close and reopen to refresh the list
        showLabelAssignmentPopover(conversationId);
      }
    });

    // Focus the input for immediate typing
    setTimeout(() => newLabelInput.focus(), 100);
  }

  /**
   * Closes the label assignment popover
   */
  function closeLabelAssignmentPopover() {
    const backdrop = document.getElementById("le-popover-backdrop");
    if (backdrop) {
      backdrop.classList.remove("visible");
      setTimeout(() => backdrop.remove(), 200);
    }
  }

  /**
   * Toggles the main search modal's visibility.
   * @param {boolean} show - Whether to show or hide the modal.
   */
  function toggleModalVisibility(show) {
    if (!appState.uiInjected) {
      if (show) injectModal();
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

    // Initial call to show available labels
    setTimeout(() => showAvailableLabels(), 100);

    searchInput.addEventListener("keyup", handleSearch);
  }

  /**
   * Handles the search logic and renders the filtered results.
   */
  async function handleSearch() {
    const searchInput = document.getElementById("le-search-input");
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
      // Show available labels when search is empty
      showAvailableLabels();
      return;
    }

    const allConversations = await fetchAllConversations();
    const { labels, chatLabels } = appState.data;

    const matchingLabelIds = Object.entries(labels)
      .filter(([, { name }]) => name.toLowerCase().includes(query))
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
   * Shows all available labels as clickable pills when search is empty.
   */
  function showAvailableLabels() {
    const contentArea = document.getElementById("le-content");
    const { labels, chatLabels } = appState.data;

    const labelEntries = Object.entries(labels);

    if (labelEntries.length === 0) {
      contentArea.innerHTML = `
        <div style="text-align: center; color: var(--text-tertiary); padding: 2rem;">
          <p style="margin-bottom: 1rem;">No labels created yet.</p>
          <p style="font-size: 0.9rem;">Click the tag icon next to any conversation to create your first label!</p>
        </div>
      `;
      return;
    }

    // Count conversations for each label
    const labelCounts = {};
    Object.entries(chatLabels).forEach(([, labelIds]) => {
      labelIds.forEach((labelId) => {
        labelCounts[labelId] = (labelCounts[labelId] || 0) + 1;
      });
    });

    const pillsHTML = labelEntries
      .map(([id, { name, color }]) => {
        return `
          <div class="le-label-pill le-label-pill-clickable" 
               style="background-color:${color};" 
               data-label-name="${name}"
               title="Click to search for conversations with '${name}' label">
            ${name}
          </div>
        `;
      })
      .join("");

    contentArea.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem;">
        <h3 style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 1rem; font-weight: 500;">
          Available Labels
        </h3>
        <div class="le-available-labels-grid">
          ${pillsHTML}
        </div>
        <p style="color: var(--text-tertiary); font-size: 0.85rem; margin-top: 1.5rem;">
          Click on a label to search for conversations, or start typing to filter.
        </p>
      </div>
    `;

    // Add click handlers to the pills
    contentArea.querySelectorAll(".le-label-pill-clickable").forEach((pill) => {
      pill.addEventListener("click", () => {
        const labelName = pill.dataset.labelName;
        const searchInput = document.getElementById("le-search-input");
        searchInput.value = labelName;
        handleSearch(); // Trigger search with the clicked label
      });
    });
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

  // --- 4. SIDEBAR BUTTON INJECTION ---

  /**
   * Injects a button into the sidebar using a MutationObserver to robustly handle
   * cases where the sidebar is rendered, removed, or re-rendered dynamically.
   */
  function injectSidebarButton() {
    waitForAsideAndObserve();

    const injectionLogic = () => {
      // 1. Check if the button already exists to prevent duplicates.
      if (document.getElementById("le-sidebar-btn")) {
        return true; // Already injected
      }

      // 2. Find the target navigation area in the sidebar.
      const sidebarNav = document.querySelector("aside");
      if (!sidebarNav) {
        return false; // Target not found, do nothing yet.
      }

      console.log("🚀 [Label Explorer] Injecting sidebar button...");

      // 3. Define the SVG icon for the button.
      const labelIconSVG = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
          <line x1="7" y1="7" x2="7.01" y2="7"></line>
        </svg>
      `;

      // 4. Create the full button element from an HTML string.
      const buttonWrapper = document.createElement("div");
      buttonWrapper.innerHTML = `
        <div id="le-sidebar-btn" tabindex="0" class="group __menu-item hoverable cursor-pointer">
            <div class="flex min-w-0 items-center gap-1.5">
                <div class="flex items-center justify-center icon">${labelIconSVG}</div>
                <div class="flex min-w-0 grow items-center gap-2.5">
                    <div class="truncate">Label Manager</div>
                </div>
            </div>
            <div class="trailing highlight text-token-text-tertiary">
                <div class="touch:hidden">
                    <div class="inline-flex whitespace-pre *:inline-flex *:font-sans *:not-last:after:px-0.5 *:not-last:after:content-['+']">
                        <kbd aria-label="Control"><span class="min-w-[1em]">Ctrl</span></kbd>
                        <kbd><span class="min-w-[1em]">L</span></kbd>
                    </div>
                </div>
            </div>
        </div>
      `;
      const buttonElement = buttonWrapper.firstElementChild;

      // 5. Add the click listener to open your UI.
      buttonElement.addEventListener("click", (e) => {
        e.preventDefault();
        toggleModalVisibility(true);
      });

      // 6. Append the button and confirm success.
      sidebarNav.appendChild(buttonElement);
      console.log("✅ [Label Explorer] Sidebar button injected successfully.");
      return true;
    };

    // --- Observer Setup ---

    // Create an observer to watch for changes in the DOM.
    const observer = new MutationObserver(() => {
      // When any change happens, try to inject the button.
      // The logic inside handles checking if it's already there.
      injectionLogic();
    });

    function waitForAsideAndObserve() {
      const interval = setInterval(() => {
        const aside = document.body.querySelector("aside");
        if (aside) {
          clearInterval(interval);
          // Start observing the aside for additions/removals of child elements.
          observer.observe(aside, {
            childList: true,
            subtree: true,
          });
          // Run injection logic right away once aside is found.
          injectionLogic();
        }
      }, 2000); // check every 2s
    }
  }

  // --- 5. INITIALIZATION & OBSERVERS ---

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

    // Inject styles immediately when script loads
    injectStyles();

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

    // Close popover on escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeLabelAssignmentPopover();
      }
    });

    initializeSidebarObserver();
    injectSidebarButton();
  }

  // Run the script
  main();
})();
