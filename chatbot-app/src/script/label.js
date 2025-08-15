(() => {
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
   * Fetches ALL conversations, handling pagination and returning partial results on failure.
   * @returns {Promise<Array>} A list of all successfully fetched conversation items.
   */
  async function fetchAllConversations() {
    const token = await getAccessToken();
    if (!token) return [];

    let allItems = [];
    let offset = 0;
    let total = Number.MAX_SAFE_INTEGER;
    const limit = 100;

    console.log("🔄 [Label Explorer] Starting to fetch all conversations...");

    while (allItems.length < total) {
      try {
        const response = await fetch(
          `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`,
          {
            headers: { authorization: `Bearer ${token}` },
          }
        );

        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        const currentItems = data.items || [];
        total = data.total || 0;

        if (currentItems.length === 0) {
          break;
        }

        allItems.push(...currentItems);
        offset += currentItems.length;
      } catch (error) {
        console.error(
          `[Label Explorer] Failed on page at offset ${offset}. Returning the ${allItems.length} items fetched so far.`,
          error
        );
        break;
      }
    }

    console.log(
      `✅ [Label Explorer] Fetched ${allItems.length} of ${total} conversations (may be partial).`
    );
    return allItems;
  }

  // --- 2. UI, STYLES, AND INJECTION ---

  /**
   * Helper function to create DOM elements with attributes and children.
   * @param {string} tag - The HTML tag for the element.
   * @param {object} attributes - An object of attributes to set on the element.
   * @param {Array<HTMLElement|string>} children - An array of child elements or text strings.
   * @returns {HTMLElement} The created element.
   */
  function createElement(tag, attributes = {}, children = []) {
    const el = document.createElement(tag);
    for (const key in attributes) {
      if (key === "className") {
        el.className = attributes[key];
      } else if (key === "style") {
        Object.assign(el.style, attributes[key]);
      } else if (key.startsWith("data-")) {
        el.dataset[key.substring(5)] = attributes[key];
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

  /**
   * Injects the CSS styles into the page immediately.
   */
  function injectStyles() {
    if (document.getElementById("le-styles")) return;

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
      .le-conversation-item .title { flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary); text-decoration: none; }
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
        background: none; border: none; cursor: pointer; display: flex; align-items: center;
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
      .le-popover-backdrop.visible { opacity: 1; }
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
      .le-popover-label-item:last-child { border-bottom: none; }
      .le-popover-label-item label { flex-grow: 1; cursor: pointer; font-size: 0.9rem; }
      .le-popover-label-item input[type="checkbox"] { margin-right: 8px; cursor: pointer; }
      .le-popover-new-label-input { 
        width: 100%; 
        padding: 10px; 
        border: 1px solid var(--border-medium);
        border-radius: 6px;
        background: var(--main-surface-secondary);
        color: var(--text-primary);
        font-size: 0.9rem;
        box-sizing: border-box;
      }
      .le-popover-new-label-input:focus { outline: none; border-color: var(--accent-primary, #10a37f); }
      .le-popover-close-btn {
        position: absolute; top: 8px; right: 12px; background: none; border: none;
        font-size: 1.5rem; cursor: pointer; color: var(--text-tertiary);
        transition: color 0.2s; width: 24px; height: 24px;
        display: flex; align-items: center; justify-content: center;
      }
      .le-popover-close-btn:hover { color: var(--text-secondary); }
      .le-color-swatch-label {
        position: relative; display: flex; width: 100%; height: 20px;
        cursor: pointer; flex-direction: row-reverse; align-items: center;
        margin-left: auto;
      }
      .le-color-picker-input {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        opacity: 0; cursor: pointer;
      }
      .le-color-swatch {
        display: block; width: 25px; height: 25px; border-radius: 50%;
        border: 1px solid var(--border-light); pointer-events: none;
      }
    `;

    const styleSheet = createElement("style", { id: "le-styles" });
    styleSheet.textContent = cssTemplate;
    document.head.appendChild(styleSheet);
  }

  /**
   * Creates and injects the modal HTML into the page.
   */
  function injectModal() {
    if (appState.uiInjected) return;

    const modal = createElement(
      "div",
      { id: "le-modal", className: "le-modal" },
      [
        createElement("div", { className: "le-header" }, [
          createElement(
            "div",
            { id: "le-search-bar", className: "le-search-bar" },
            [
              createElement("input", {
                type: "text",
                id: "le-search-input",
                placeholder: "Search by labels...",
              }),
            ]
          ),
        ]),
        createElement("div", { id: "le-content", className: "le-content" }, [
          createElement(
            "p",
            {
              style: {
                textAlign: "center",
                color: "var(--text-tertiary)",
                padding: "1rem",
              },
            },
            ["Start typing to search for conversations by label."]
          ),
        ]),
      ]
    );

    const container = createElement(
      "div",
      { id: "le-modal-container", className: "le-modal-container" },
      [modal]
    );
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

    const svgIcon = createSvgElement("svg", {
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    svgIcon.appendChild(
      createSvgElement("path", {
        d: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z",
      })
    );
    svgIcon.appendChild(
      createSvgElement("line", { x1: "7", y1: "7", x2: "7.01", y2: "7" })
    );

    const labelButton = createElement(
      "button",
      { className: "le-sidebar-btn" },
      [svgIcon]
    );

    labelButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showLabelAssignmentPopover(conversationId);
    });

    titleContainer.parentElement.style.display = "flex";
    titleContainer.parentElement.appendChild(labelButton);
  }

  // --- 3. EVENT HANDLERS & DYNAMIC UI ---

  /**
   * Shows the centered popover for assigning/creating labels.
   * @param {string} conversationId - The ID of the conversation.
   */
  function showLabelAssignmentPopover(conversationId) {
    closeLabelAssignmentPopover();

    const { labels, chatLabels } = appState.data;
    const assignedLabelIds = new Set(chatLabels[conversationId] || []);

    const labelItems = Object.entries(labels).map(([id, { name, color }]) => {
      return createElement("div", { className: "le-popover-label-item" }, [
        createElement("input", {
          type: "checkbox",
          id: `le-cb-${id}`,
          "data-labelId": id,
          checked: assignedLabelIds.has(id) ? true : undefined,
        }),
        createElement("label", { for: `le-cb-${id}` }, [name]),
        createElement(
          "label",
          { className: "le-color-swatch-label", title: "Change label color" },
          [
            createElement("input", {
              type: "color",
              className: "le-color-picker-input",
              "data-labelId": id,
              value: color,
            }),
            createElement("span", {
              className: "le-color-swatch",
              style: { backgroundColor: color },
            }),
          ]
        ),
      ]);
    });

    const popover = createElement(
      "div",
      { id: "le-popover", className: "le-popover" },
      [
        createElement("button", { className: "le-popover-close-btn" }, ["×"]),
        createElement("div", { className: "le-popover-section" }, [
          createElement("h4", {}, ["Apply Labels"]),
          createElement(
            "div",
            { className: "le-popover-labels-list" },
            labelItems.length > 0
              ? labelItems
              : [
                  createElement(
                    "p",
                    {
                      style: {
                        fontSize: "0.85rem",
                        color: "var(--text-tertiary)",
                        textAlign: "center",
                        padding: "1rem",
                      },
                    },
                    ["No labels created yet."]
                  ),
                ]
          ),
        ]),
        createElement("div", { className: "le-popover-section" }, [
          createElement("h4", {}, ["Create New Label"]),
          createElement("input", {
            type: "text",
            id: "le-new-label-input",
            placeholder: "Enter label name...",
            className: "le-popover-new-label-input",
          }),
        ]),
      ]
    );

    const backdrop = createElement(
      "div",
      { id: "le-popover-backdrop", className: "le-popover-backdrop" },
      [popover]
    );
    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.classList.add("visible"), 10);

    // Popover Event Listeners
    popover
      .querySelector(".le-popover-close-btn")
      .addEventListener("click", closeLabelAssignmentPopover);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeLabelAssignmentPopover();
    });
    popover.addEventListener("click", (e) => e.stopPropagation());

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

    popover.querySelectorAll(".le-color-picker-input").forEach((picker) => {
      picker.addEventListener("input", async (e) => {
        const labelId = e.target.dataset.labelId;
        const newColor = e.target.value;
        const swatch = e.target.nextElementSibling;
        if (swatch) swatch.style.backgroundColor = newColor;
        if (appState.data.labels[labelId]) {
          appState.data.labels[labelId].color = newColor;
          await saveStoredData(appState.data);
        }
      });
    });

    const newLabelInput = document.getElementById("le-new-label-input");
    newLabelInput.addEventListener("keydown", async (e) => {
      function hslToHex(h, s, l) {
        l /= 100;
        const a = (s * Math.min(l, 1 - l)) / 100;
        const f = (n) => {
          const k = (n + h / 30) % 12;
          const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
          return Math.round(255 * color)
            .toString(16)
            .padStart(2, "0");
        };
        return `#${f(0)}${f(8)}${f(4)}`;
      }
      if (e.key === "Enter" && newLabelInput.value.trim()) {
        const newName = newLabelInput.value.trim();
        const newId = `l-${Date.now()}`;
        const randomHue = Math.random() * 360;
        const newColor = hslToHex(randomHue, 70, 50);
        appState.data.labels[newId] = { name: newName, color: newColor };
        await saveStoredData(appState.data);
        showLabelAssignmentPopover(conversationId); // Re-render the popover
      }
    });

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
      const input = document.getElementById("le-search-input");
      input.value = "";
      input.focus();
      showAvailableLabels();
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
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
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
    contentArea.innerHTML = ""; // Clear previous content
    const { labels } = appState.data;
    const labelEntries = Object.entries(labels);

    if (labelEntries.length === 0) {
      const noLabelsMessage = createElement(
        "div",
        {
          style: {
            textAlign: "center",
            color: "var(--text-tertiary)",
            padding: "2rem",
          },
        },
        [
          createElement("p", { style: { marginBottom: "1rem" } }, [
            "No labels created yet.",
          ]),
          createElement("p", { style: { fontSize: "0.9rem" } }, [
            "Click the tag icon next to any conversation to create your first label!",
          ]),
        ]
      );
      contentArea.appendChild(noLabelsMessage);
      return;
    }

    const pills = labelEntries.map(([id, { name, color }]) => {
      const pill = createElement(
        "div",
        {
          className: "le-label-pill le-label-pill-clickable",
          style: { backgroundColor: color },
          "data-labelId": id,
          "data-labelName": name,
          title: "Single-click to search. Double-click to delete.",
        },
        [name]
      );

      pill.addEventListener("click", () => {
        const searchInput = document.getElementById("le-search-input");
        searchInput.value = name;
        handleSearch();
      });
      pill.addEventListener("dblclick", () => handleDeleteLabel(id));
      return pill;
    });

    const availableLabelsView = createElement(
      "div",
      { style: { textAlign: "center", padding: "2rem 1rem" } },
      [
        createElement(
          "h3",
          {
            style: {
              color: "var(--text-secondary)",
              marginBottom: "1.5rem",
              fontSize: "1rem",
              fontWeight: "500",
            },
          },
          ["Available Labels"]
        ),
        createElement("div", { className: "le-available-labels-grid" }, pills),
        createElement(
          "p",
          {
            style: {
              color: "var(--text-tertiary)",
              fontSize: "0.85rem",
              marginTop: "1.5rem",
            },
          },
          ["Click a label to search, or double-click to delete it."]
        ),
      ]
    );

    contentArea.appendChild(availableLabelsView);
  }

  /**
   * Deletes a label and all its associations from the stored data.
   * @param {string} labelIdToDelete - The ID of the label to delete.
   */
  async function handleDeleteLabel(labelIdToDelete) {
    if (!labelIdToDelete) return;

    const labelName = appState.data.labels[labelIdToDelete]?.name;
    if (
      !confirm(
        `Are you sure you want to permanently delete the label "${labelName}"? This cannot be undone.`
      )
    ) {
      return;
    }

    delete appState.data.labels[labelIdToDelete];
    for (const chatId in appState.data.chatLabels) {
      appState.data.chatLabels[chatId] = appState.data.chatLabels[
        chatId
      ].filter((id) => id !== labelIdToDelete);
      if (appState.data.chatLabels[chatId].length === 0) {
        delete appState.data.chatLabels[chatId];
      }
    }
    await saveStoredData(appState.data);
    showAvailableLabels();
  }

  /**
   * Renders the search results in the modal content area.
   * @param {Array} conversations - The list of conversations to render.
   */
  function renderSearchResults(conversations) {
    const contentArea = document.getElementById("le-content");
    contentArea.innerHTML = ""; // Clear previous results
    const { labels, chatLabels } = appState.data;

    if (conversations.length === 0) {
      contentArea.appendChild(
        createElement(
          "p",
          {
            style: {
              textAlign: "center",
              color: "var(--text-tertiary)",
              padding: "1rem",
            },
          },
          ["No conversations found with matching labels."]
        )
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    conversations.forEach((convo) => {
      const assignedLabelIds = chatLabels[convo.id] || [];
      const pills = assignedLabelIds
        .map((id) => {
          const label = labels[id];
          if (!label) return null;

          const pill = createElement(
            "div",
            {
              className: "le-label-pill",
              "data-labelId": id,
              "data-convoId": convo.id,
              style: { backgroundColor: label.color },
              title: "Double-click to remove label",
            },
            [label.name]
          );

          pill.addEventListener("dblclick", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const currentLabels = appState.data.chatLabels[convo.id] || [];
            appState.data.chatLabels[convo.id] = currentLabels.filter(
              (labelId) => labelId !== id
            );
            if (appState.data.chatLabels[convo.id].length === 0) {
              delete appState.data.chatLabels[convo.id];
            }
            await saveStoredData(appState.data);
            pill.remove();
          });

          return pill;
        })
        .filter(Boolean); // Filter out nulls if a label was deleted but still referenced

      const itemEl = createElement(
        "div",
        { className: "le-conversation-item" },
        [
          createElement(
            "a",
            { className: "title", href: `/c/${convo.id}`, target: "_blank" },
            [convo.title]
          ),
          createElement(
            "div",
            { className: "le-label-pills-container" },
            pills
          ),
        ]
      );
      fragment.appendChild(itemEl);
    });

    contentArea.appendChild(fragment);
  }

  // --- 4. SIDEBAR BUTTON INJECTION ---

  /**
   * Injects a button into the sidebar using a MutationObserver.
   */
  function injectSidebarButton() {
    const injectionLogic = () => {
      if (document.getElementById("le-sidebar-btn")) return true;
      const sidebarNav = document.querySelector("aside");
      if (!sidebarNav) return false;

      console.log("🚀 [Label Explorer] Injecting sidebar button...");

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
          d: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z",
        })
      );
      svgIcon.appendChild(
        createSvgElement("line", { x1: "7", y1: "7", x2: "7.01", y2: "7" })
      );

      const buttonElement = createElement(
        "div",
        {
          id: "le-sidebar-btn",
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
                    "Label Manager",
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
                        "L",
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
        toggleModalVisibility(true);
      });

      sidebarNav.appendChild(buttonElement);
      console.log("✅ [Label Explorer] Sidebar button injected successfully.");
      return true;
    };

    const observer = new MutationObserver(injectionLogic);
    const interval = setInterval(() => {
      const aside = document.body.querySelector("aside");
      if (aside) {
        clearInterval(interval);
        observer.observe(aside, { childList: true, subtree: true });
        injectionLogic();
      }
    }, 2000);
  }

  // --- 5. INITIALIZATION & OBSERVERS ---

  /**
   * Sets up the MutationObserver to watch for new chats in the sidebar.
   */
  function initializeSidebarObserver() {
    const observer = new MutationObserver((mutations) => {
      const newChatLinks = new Set();
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            // ELEMENT_NODE
            if (node.matches('a[href^="/c/"]')) newChatLinks.add(node);
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
      setTimeout(() => {
        navElement.querySelectorAll('a[href^="/c/"]').forEach(injectSidebarUI);
      }, 3000);
    } else {
      setTimeout(initializeSidebarObserver, 1000);
    }
  }

  /**
   * Main entry point for the script.
   */
  async function main() {
    appState.data = await getStoredData();
    injectStyles();

    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const container = document.getElementById("le-modal-container");
        const isVisible = container && container.style.display !== "none";
        toggleModalVisibility(!isVisible);
      } else if (e.key === "Escape") {
        closeLabelAssignmentPopover();
        toggleModalVisibility(false);
      }
    });

    initializeSidebarObserver();
    injectSidebarButton();
  }

  main();
})();
