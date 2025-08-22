window.ChatGPTLabel = (() => {
  console.log(
    "🚀 [Label Explorer] Content script loaded. Press Ctrl+L to open."
  );

  // --- Configuration & State ---
  let appState = {
    data: { labels: {}, chatLabels: {} },
    uiInjected: false,
  };

  // --- 1. CORE LOGIC & DATA MANAGEMENT ---

  // --- Chrome Storage Sync Helper for Label Data ---
  const STORAGE_KEY = "labelExplorerData";
  const MAX_STORAGE_SIZE = 102400; // Chrome storage.sync limit is ~100KB per item
  let idCounter = 0; // For generating short IDs

  // Initialize ID counter from existing data
  async function initializeIdCounter() {
    const data = await getStoredData();
    const existingIds = Object.keys(data.labels).map((id) => {
      // Extract numeric part from IDs like "l1", "l2", etc.
      const match = id.match(/^l(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });
    idCounter = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  }

  // Generate short, sequential IDs instead of timestamp-based ones
  function generateShortId() {
    return `l${++idCounter}`;
  }

  // Storage helper functions using Chrome Storage Sync
  async function getStoredData() {
    try {
      // Check if we're in a Chrome extension environment
      if (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.sync
      ) {
        return new Promise((resolve) => {
          chrome.storage.sync.get([STORAGE_KEY], (result) => {
            if (chrome.runtime.lastError) {
              console.error(
                "[Label Explorer] Chrome storage error:",
                chrome.runtime.lastError
              );
              resolve({ labels: {}, chatLabels: {} });
            } else {
              const data = result[STORAGE_KEY];
              if (data && data.labels && data.chatLabels) {
                resolve(data);
              } else {
                resolve({ labels: {}, chatLabels: {} });
              }
            }
          });
        });
      } else {
        // Fallback to localStorage for development/testing
        console.warn(
          "[Label Explorer] Chrome storage not available, using localStorage fallback"
        );
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            const data = JSON.parse(stored);
            if (data && data.labels && data.chatLabels) {
              return data;
            }
          } catch (e) {
            console.error(
              "[Label Explorer] Error parsing localStorage data:",
              e
            );
          }
        }
        return { labels: {}, chatLabels: {} };
      }
    } catch (e) {
      console.error("[Label Explorer] Error reading from storage:", e);
      return { labels: {}, chatLabels: {} };
    }
  }

  async function saveStoredData(data) {
    try {
      // check to make sure if there is a chatlabel with an empty array, we remove it
      for (const chatId in data.chatLabels) {
        if (
          data.chatLabels[chatId].length === 0 ||
          data.chatLabels[chatId][0] == null
        ) {
          delete data.chatLabels[chatId];
        }
      }
      // Validate data size before saving
      const dataSize = JSON.stringify(data).length;
      if (dataSize > MAX_STORAGE_SIZE) {
        console.warn(
          `[Label Explorer] Data size (${dataSize} bytes) exceeds Chrome storage limit. Consider cleaning up old labels.`
        );
        // Could implement data cleanup logic here
      }

      if (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.sync
      ) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.set({ [STORAGE_KEY]: data }, () => {
            if (chrome.runtime.lastError) {
              console.error(
                "[Label Explorer] Error saving to Chrome storage:",
                chrome.runtime.lastError
              );
              reject(chrome.runtime.lastError);
            } else {
              console.log(
                "[Label Explorer] Data successfully synced to Chrome storage"
              );
              resolve();
            }
          });
        });
      } else {
        // Fallback to localStorage
        console.warn(
          "[Label Explorer] Chrome storage not available, using localStorage fallback"
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return Promise.resolve();
      }
    } catch (e) {
      console.error("[Label Explorer] Error saving to storage:", e);
      throw e;
    }
  }

  // Listen for storage changes from other instances (tabs/devices)
  function initializeStorageListener() {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.sync
    ) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "sync" && changes[STORAGE_KEY]) {
          console.log(
            "[Label Explorer] Storage sync detected, updating local state"
          );
          appState.data = changes[STORAGE_KEY].newValue || {
            labels: {},
            chatLabels: {},
          };

          // Refresh UI if modal is open
          const container = document.getElementById("le-modal-container");
          if (container && container.style.display !== "none") {
            const searchInput = document.getElementById("le-search-input");
            if (searchInput && searchInput.value.trim()) {
              handleSearch();
            } else {
              showAvailableLabels();
            }
          }
        }
      });
    } else {
      // Fallback: listen for localStorage changes (same-origin only)
      window.addEventListener("storage", (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
          try {
            appState.data = JSON.parse(e.newValue);
            console.log(
              "[Label Explorer] localStorage change detected, updating local state"
            );

            // Refresh UI if modal is open
            const container = document.getElementById("le-modal-container");
            if (container && container.style.display !== "none") {
              const searchInput = document.getElementById("le-search-input");
              if (searchInput && searchInput.value.trim()) {
                handleSearch();
              } else {
                showAvailableLabels();
              }
            }
          } catch (error) {
            console.error(
              "[Label Explorer] Error parsing storage change:",
              error
            );
          }
        }
      });
    }
  }

  // --- End of Chrome Storage Sync Helper ---

  /**
   * Fetches ALL conversations from the History Manager's local cache.
   */
  async function fetchAllConversations() {
    console.log(
      "🔄 [Label Explorer] Fetching conversations from History Manager cache..."
    );
    // history
    const history = await ChatGPThistory.cacheManager.getConversations(true);
    // archive
    const archive = await ChatGPThistory.cacheManager.getConversations(false);
    const conversations = [...history, ...archive];
    if (conversations.length === 0) {
      console.warn(
        "[Label Explorer] History Manager cache is empty or inaccessible."
      );
    }
    console.log(
      `✅ [Label Explorer] Fetched ${conversations.length} conversations from cache.`
    );
    return conversations;
  }

  /**
   * Validates all chatlabels against history cache, to check for deleted conversations
   * SAFETY: Multiple validation checks to prevent accidental data loss
   */
  async function validateChatlabels() {
    console.log("[Label Explorer] Starting safe label validation...");

    // Step 1: Get current state before any server operations
    const beforeData = await getStoredData();
    const beforeCount = Object.keys(beforeData.chatLabels).length;

    console.log(
      `[Label Explorer] Current state: ${
        Object.keys(beforeData.labels).length
      } labels, ${beforeCount} chat label assignments`
    );

    // Step 2: Attempt server sync with safety checks
    console.log("[Label Explorer] Syncing with server...");
    const success = await ChatGPThistory.syncAllConversationsWithServer(
      999,
      true
    );

    if (!success) {
      console.warn(
        "[Label Explorer] Server sync failed - aborting cleanup to prevent data loss"
      );
      return false;
    }

    // Step 3: Get conversations with safety validation
    const allConversations = await fetchAllConversations();

    // SAFETY CHECK 1: Ensure we actually got conversation data
    if (!allConversations || allConversations.length === 0) {
      console.warn(
        "[Label Explorer] SAFETY ABORT: No conversations returned from cache. This could indicate:"
      );
      console.warn("  - Server returned empty response");
      console.warn("  - Cache was cleared due to sync error");
      console.warn("  - Network/API issues occurred");
      console.warn("  - Aborting cleanup to prevent accidental label deletion");
      return false;
    }

    // SAFETY CHECK 2: Sanity check - ensure conversation count is reasonable
    // If we had labels before, we should have at least some conversations
    if (beforeCount > 0 && allConversations.length < 5) {
      console.warn(
        `[Label Explorer] SAFETY ABORT: Suspiciously low conversation count (${allConversations.length})`
      );
      console.warn(
        "  - Previously had chat labels, but now very few conversations"
      );
      console.warn("  - This suggests partial/incomplete server sync");
      console.warn("  - Aborting cleanup to prevent accidental label deletion");
      return false;
    }

    console.log(
      `[Label Explorer] Validation passed: Found ${allConversations.length} conversations`
    );

    // Step 4: Perform safe comparison and cleanup
    const { chatLabels, labels } = await getStoredData();
    const orphanedLabels = [];
    let cleanupCount = 0;

    // Identify orphaned labels without deleting yet
    for (const convoId in chatLabels) {
      const convo = allConversations.find((c) => c.id === convoId);
      if (!convo) {
        orphanedLabels.push(convoId);
      }
    }

    // SAFETY CHECK 3: Prevent mass deletion
    const orphanPercentage =
      (orphanedLabels.length / Object.keys(chatLabels).length) * 100;
    if (orphanedLabels.length > 10 && orphanPercentage > 50) {
      console.warn(
        `[Label Explorer] SAFETY ABORT: Would delete ${
          orphanedLabels.length
        } labels (${orphanPercentage.toFixed(1)}%)`
      );
      console.warn("  - This is unusually high and suggests data sync issues");
      console.warn("  - Aborting cleanup to prevent accidental mass deletion");
      console.warn("  - Consider running History Manager sync manually first");
      return false;
    }

    // Safe to proceed with cleanup
    if (orphanedLabels.length > 0) {
      console.log(
        `[Label Explorer] Cleaning up ${orphanedLabels.length} orphaned label assignments:`
      );
      orphanedLabels.forEach((convoId) => {
        console.log(`  - Removing labels for conversation: ${convoId}`);
        delete chatLabels[convoId];
        cleanupCount++;
      });

      // Save the cleaned data
      const cleanedData = { labels, chatLabels };
      await saveStoredData(cleanedData);
      appState.data = await getStoredData();

      console.log(
        `✅ [Label Explorer] Successfully cleaned up ${cleanupCount} orphaned label assignments`
      );
    } else {
      console.log("✅ [Label Explorer] No orphaned labels found - all clean!");
    }

    return true;
  }

  // --- 2. UI, STYLES, AND INJECTION ---

  function injectStyles() {
    if (document.getElementById("le-styles")) return;
    const cssTemplate = `
      .le-modal-container { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.6); z-index: 10000; display: flex; align-items: center; justify-content: center; font-family: inherit; opacity: 0; transition: opacity 0.2s ease-in-out; }
      .le-modal-container.visible { opacity: 1; }
      .le-modal { background-color: var(--main-surface-primary); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: 16px; width: 80vw; max-width: 800px; height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden; transform: scale(0.95); transition: transform 0.2s ease-in-out; contain: layout style paint; }
      .le-modal-container.visible .le-modal { transform: scale(1); }
      .le-header { padding: 16px 20px; border-bottom: 1px solid var(--border-light); }
      .le-search-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; background-color: var(--main-surface-secondary); border-radius: 8px; padding: 4px; }
      .le-search-bar input { flex-grow: 1; background: transparent; border: none; outline: none; box-shadow: none; color: var(--text-primary); font-size: 1rem; padding: 8px; min-width: 150px; }
      .le-content { flex-grow: 1; overflow-y: auto; padding: 8px 20px; overscroll-behavior: contain; scroll-behavior: smooth; contain: layout style paint; }
      .le-conversation-item { display: flex; align-items: center; padding: 12px 8px; border-radius: 8px; transition: background-color 0.2s; cursor: pointer; }
      .le-conversation-item:hover { background-color: var(--surface-hover); }
      .le-conversation-item .title { flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary); text-decoration: none; }
      .le-label-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; color: white; }
      .le-label-pill-clickable { cursor: pointer; transition: all 0.2s ease; padding: 8px 12px; font-size: 0.85rem; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .le-label-pill-clickable:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
      .le-label-count { padding: 2px 6px; border-radius: 50%; font-size: 1rem; font-weight: 600; margin-left: 6px; }
      .le-available-labels-grid { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; max-width: 600px; margin: 0 auto; }
      .le-label-pill.in-search { cursor: pointer; }
      .le-label-pills-container { display: flex; gap: 6px; flex-wrap: wrap; }
      .le-sidebar-btn { color: var(--text-secondary); margin-left: auto; padding: 4px; border-radius: 4px; transition: background-color 0.2s, color 0.2s; background: none; border: none; cursor: pointer; display: flex; align-items: center; }
      .le-sidebar-btn:hover { background-color: var(--surface-hover); color: var(--text-primary); }
      .le-popover { position: fixed; z-index: 10001; background: var(--main-surface-primary); border: 1px solid var(--border-medium); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); padding: 16px; width: 300px; max-height: 400px; overflow-y: auto; transform: translate(-50%, -50%); top: 50%; left: 50%; overscroll-behavior: contain; contain: layout style paint; }
      .le-popover-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.4); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s ease-in-out; }
      .le-popover-backdrop.visible { opacity: 1; }
      .le-popover-section { margin-bottom: 16px; }
      .le-popover-section:last-child { margin-bottom: 0; }
      .le-popover-section h4 { font-size: 0.85rem; font-weight: 600; margin-bottom: 12px; color: var(--text-secondary); letter-spacing: 0.5px; }
      .le-popover-labels-list { max-height: 200px; overflow-y: auto; overscroll-behavior: contain; contain: layout style; }
      .le-popover-label-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-light); }
      .le-popover-label-item:last-child { border-bottom: none; }
      .le-popover-label-item label { flex-grow: 1; cursor: pointer; font-size: 0.9rem; }
      .le-popover-label-item input[type="checkbox"] { margin-right: 8px; cursor: pointer; }
      .le-popover-new-label-input { width: 100%; padding: 10px; border: 1px solid var(--border-medium); border-radius: 6px; background: var(--main-surface-secondary); color: var(--text-primary); font-size: 0.9rem; box-sizing: border-box; outline: none; box-shadow: none; }
      .le-popover-close-btn { position: absolute; top: 8px; right: 12px; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-tertiary); transition: color 0.2s; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
      .le-popover-close-btn:hover { color: var(--text-secondary); }
      .le-color-swatch-label { position: relative; display: flex; width: 100%; height: 20px; cursor: pointer; flex-direction: row-reverse; align-items: center; margin-left: auto; }
      .le-color-picker-input { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
      .le-color-swatch { display: block; width: 25px; height: 25px; border-radius: 50%; border: 1px solid var(--border-light); pointer-events: none; }
      .le-sync-status { font-size: 0.75rem; color: var(--text-tertiary); padding: 4px 8px; cursor: pointer; }
      .le-sync-status.synced { color: var(--text-success); }
      .le-sync-status.error { color: var(--text-error); }
      .le-sync-status:disabled { opacity: 0.5; cursor: not-allowed; }
      .le-sync-status.cleaning { background-color: var(--main-surface-secondary); }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.id = "le-styles";
    styleSheet.textContent = cssTemplate;
    document.head.appendChild(styleSheet);
  }

  function injectModal() {
    if (appState.uiInjected) return;

    const container = document.createElement("div");
    container.id = "le-modal-container";
    container.className = "le-modal-container ignore-this";
    container.innerHTML = `
      <div id="le-modal" class="le-modal">
        <div class="le-header">
          <div id="le-search-bar" class="le-search-bar">
            <input type="text" id="le-search-input" placeholder="Search by labels...">

            <div id="le-sync-status" class="le-sync-status btn">Synced ✓</div>
          </div>
        </div>
        <div id="le-content" class="le-content">
          <p style="text-align: center; color: var(--text-tertiary); padding: 1rem;">
            Start typing to search for conversations by label.
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    appState.uiInjected = true;
    addModalEventListeners();
  }

  async function injectSidebarUI(chatElement) {
    if (chatElement.dataset.leInjected) return;
    chatElement.dataset.leInjected = "true";
    const titleContainer = chatElement.querySelector("div.trailing.highlight");
    if (!titleContainer) return;

    const conversationId = chatElement.href.split("/").pop();
    const labelButton = document.createElement("button");
    labelButton.className = "le-sidebar-btn";
    labelButton.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
        <line x1="7" y1="7" x2="7.01" y2="7"></line>
      </svg>
    `;

    labelButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showLabelAssignmentPopover(conversationId);
    });

    titleContainer.parentElement.style.display = "flex";
    titleContainer.insertBefore(labelButton, titleContainer.firstChild);
  }

  // --- 3. EVENT HANDLERS & DYNAMIC UI ---

  function updateSyncStatus(status, message = "") {
    const sync = "le-sync-status";
    const syncStatusEl = document.getElementById(sync);
    if (!syncStatusEl) return;

    switch (status) {
      case "synced":
        syncStatusEl.className = `${sync} synced btn`;
        syncStatusEl.textContent = "Synced ✓";
        break;
      case "syncing":
        syncStatusEl.className = `${sync} btn`;
        syncStatusEl.textContent = "Syncing...";
        break;
      case "cleaning":
        syncStatusEl.className = `${sync} btn`;
        syncStatusEl.textContent = "Cleaning...";
        break;
      case "error":
        syncStatusEl.className = `${sync} error btn`;
        syncStatusEl.textContent = message || "Sync error";
        break;
    }
  }

  /**
   * Handles the cleanup button click - validates and cleans up orphaned labels
   * Enhanced with comprehensive safety checks and user warnings
   */
  async function handleCleanupLabels() {
    const cleanupBtn = document.getElementById("le-sync-status");
    if (!cleanupBtn) return;

    const originalText = cleanupBtn.textContent;

    // Show safety warning to user
    const shouldProceed = confirm(
      "🧹 Label Cleanup Safety Check\n\n" +
        "This will:\n" +
        "• Sync with ChatGPT servers to get latest conversation data\n" +
        "• Remove labels for conversations that no longer exist\n" +
        "• Multiple safety checks prevent accidental data loss\n\n" +
        "The process will abort if any issues are detected.\n\n" +
        "Continue with cleanup?"
    );

    if (!shouldProceed) return;

    cleanupBtn.disabled = true;
    updateSyncStatus("cleaning");

    try {
      console.log(
        "[Label Explorer] Starting enhanced label cleanup with safety checks..."
      );

      // Get counts before cleanup for reporting
      const beforeCounts = {
        labels: Object.keys(appState.data.labels).length,
        chatLabels: Object.keys(appState.data.chatLabels).length,
      };

      const success = await validateChatlabels();

      if (success) {
        // Get counts after cleanup
        const afterCounts = {
          labels: Object.keys(appState.data.labels).length,
          chatLabels: Object.keys(appState.data.chatLabels).length,
        };

        const removedCount = beforeCounts.chatLabels - afterCounts.chatLabels;

        console.log(
          `[Label Explorer] Cleanup complete. Removed ${removedCount} orphaned label assignments.`
        );

        // Show success message
        updateSyncStatus("synced");

        if (removedCount > 0) {
          cleanupBtn.textContent = `Cleaned ${removedCount} items`;

          // Show success notification
          setTimeout(() => {
            alert(
              `✅ Cleanup Complete!\n\nRemoved ${removedCount} orphaned label assignments.\nYour labels are now synchronized with your actual conversations.`
            );
          }, 500);
        } else {
          cleanupBtn.textContent = "Already Clean ✓";
        }

        // Refresh the current view
        const searchInput = document.getElementById("le-search-input");
        if (searchInput && searchInput.value.trim()) {
          handleSearch();
        } else {
          showAvailableLabels();
        }

        // Reset button after 3 seconds
        setTimeout(() => {
          cleanupBtn.textContent = originalText;
        }, 3000);
      } else {
        throw new Error(
          "Cleanup aborted due to safety checks - see console for details"
        );
      }
    } catch (error) {
      console.error("[Label Explorer] Cleanup failed:", error);
      updateSyncStatus("error", "Cleanup failed");
      cleanupBtn.textContent = "❌ Safety Abort";

      // Show detailed error to user
      setTimeout(() => {
        alert(
          "🛡️ Cleanup Safely Aborted\n\n" +
            "The cleanup was stopped due to safety checks to prevent accidental data loss.\n\n" +
            "Common reasons:\n" +
            "• Server sync failed or returned incomplete data\n" +
            "• Network connectivity issues\n" +
            "• Unusually high number of orphaned labels detected\n\n" +
            "Try:\n" +
            "1. Check your internet connection\n" +
            "2. Open History Manager (Ctrl+H) and refresh manually\n" +
            "3. Try cleanup again after successful sync\n\n" +
            "Check browser console for detailed information."
        );
      }, 500);

      // Reset button after 5 seconds
      setTimeout(() => {
        cleanupBtn.textContent = originalText;
      }, 5000);
    } finally {
      cleanupBtn.disabled = false;
      cleanupBtn.classList.remove("cleaning");
    }
  }

  /**
   * Renders a helpful message when the local cache is empty.
   */
  function renderCacheEmptyMessage() {
    const contentArea = document.getElementById("le-content");
    contentArea.innerHTML = `
      <div style="text-align: center; color: var(--text-tertiary); padding: 2rem;">
        <p style="margin-bottom: 1rem;">No conversations found in the local cache.</p>
        <p style="font-size: 0.9rem;">Please open the History Manager (Ctrl+H) to sync your conversations first.</p>
      </div>
    `;
  }

  /**
   * Handles search logic and displays a notice if the cache is empty.
   */
  async function handleSearch() {
    const searchInput = document.getElementById("le-search-input");
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
      showAvailableLabels();
      return;
    }

    const allConversations = await fetchAllConversations();
    if (allConversations.length === 0) {
      renderCacheEmptyMessage();
      return;
    }

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

  function showLabelAssignmentPopover(conversationId) {
    closeLabelAssignmentPopover();
    const { labels, chatLabels } = appState.data;
    const assignedLabelIds = new Set(chatLabels[conversationId] || []);

    let labelItemsHTML = "";
    const labelEntries = Object.entries(labels);

    if (labelEntries.length > 0) {
      labelItemsHTML = labelEntries
        .map(
          ([id, { name, color }]) => `
        <div class="le-popover-label-item ignore-this">
          <input type="checkbox" id="le-cb-${id}" data-label-id="${id}" ${
            assignedLabelIds.has(id) ? "checked" : ""
          }>
          <label for="le-cb-${id}">${name}</label>
          <label class="le-color-swatch-label" title="Change label color">
            <input type="color" class="le-color-picker-input" data-label-id="${id}" value="${color}">
            <span class="le-color-swatch" style="background-color: ${color};"></span>
          </label>
        </div>
      `
        )
        .join("");
    } else {
      labelItemsHTML = `
        <p style="font-size: 0.85rem; color: var(--text-tertiary); text-align: center; padding: 1rem;">
          No labels created yet.
        </p>
      `;
    }

    const backdrop = document.createElement("div");
    backdrop.id = "le-popover-backdrop";
    backdrop.className = "le-popover-backdrop";
    backdrop.innerHTML = `
      <div id="le-popover" class="le-popover">
        <button class="le-popover-close-btn">×</button>
        <div class="le-popover-section">
          <h4>Apply Labels</h4>
          <div class="le-popover-labels-list">
            ${labelItemsHTML}
          </div>
        </div>
        <div class="le-popover-section">
          <h4>Create New Label</h4>
          <input type="text" id="le-new-label-input" placeholder="Enter label name..." class="le-popover-new-label-input">
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.classList.add("visible"), 10);

    const popover = backdrop.querySelector("#le-popover");

    // Close button
    popover
      .querySelector(".le-popover-close-btn")
      .addEventListener("click", closeLabelAssignmentPopover);
    if (window.matchMedia("(max-width: 767px)").matches) {
      console.log("Closing sidebar for small screens");
      document.querySelector("[aria-label='Close sidebar']")?.click();
    }
    // Close on backdrop click
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeLabelAssignmentPopover();
    });

    // Prevent popover clicks from closing
    popover.addEventListener("click", (e) => e.stopPropagation());

    // Checkbox event listeners
    popover.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", async () => {
        updateSyncStatus("syncing");
        try {
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
          updateSyncStatus("synced");
        } catch (error) {
          console.error(
            "[Label Explorer] Error saving label assignment:",
            error
          );
          updateSyncStatus("error");
        }
      });
    });

    // Color picker event listeners
    popover.querySelectorAll(".le-color-picker-input").forEach((picker) => {
      picker.addEventListener("input", async (e) => {
        updateSyncStatus("syncing");
        try {
          const labelId = e.target.dataset.labelId;
          const newColor = e.target.value;
          const swatch = e.target.nextElementSibling;

          if (swatch) swatch.style.backgroundColor = newColor;
          if (appState.data.labels[labelId]) {
            appState.data.labels[labelId].color = newColor;
            await saveStoredData(appState.data);
            updateSyncStatus("synced");
          }
        } catch (error) {
          console.error("[Label Explorer] Error saving color change:", error);
          updateSyncStatus("error");
        }
      });
    });

    // New label input
    const newLabelInput = popover.querySelector("#le-new-label-input");
    newLabelInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && newLabelInput.value.trim()) {
        updateSyncStatus("syncing");
        try {
          const newName = newLabelInput.value.trim();
          const newId = generateShortId();
          const randomHue = Math.random() * 360;
          const newColor = hslToHex(randomHue, 70, 50);

          appState.data.labels[newId] = { name: newName, color: newColor };
          await saveStoredData(appState.data);
          updateSyncStatus("synced");
          closeLabelAssignmentPopover();
        } catch (error) {
          console.error("[Label Explorer] Error creating new label:", error);
          updateSyncStatus("error");
        }
      }
    });

    setTimeout(() => newLabelInput.focus(), 100);
  }

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

  function closeLabelAssignmentPopover() {
    const backdrop = document.getElementById("le-popover-backdrop");
    if (backdrop) {
      backdrop.classList.remove("visible");
      setTimeout(() => backdrop.remove(), 200);
    }
  }

  function toggleModalVisibility(show) {
    if (!appState.uiInjected) {
      if (show) injectModal();
      else return;
    }

    const container = document.getElementById("le-modal-container");
    if (show) {
      container.style.display = "flex";
      if (window.matchMedia("(max-width: 767px)").matches) {
        console.log("Closing sidebar for small screens");
        document.querySelector("[aria-label='Close sidebar']")?.click();
      }
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

  function addModalEventListeners() {
    const container = document.getElementById("le-modal-container");
    const searchInput = document.getElementById("le-search-input");
    const cleanupBtn = document.getElementById("le-sync-status");

    container.addEventListener("click", (e) => {
      if (e.target.id === "le-modal-container") toggleModalVisibility(false);
    });

    searchInput.addEventListener("keyup", handleSearch);

    // Add cleanup button event listener
    if (cleanupBtn) {
      cleanupBtn.addEventListener("click", handleCleanupLabels);
    }
  }

  function showAvailableLabels() {
    const contentArea = document.getElementById("le-content");
    const { labels } = appState.data;
    const labelEntries = Object.entries(labels);

    if (labelEntries.length === 0) {
      contentArea.innerHTML = `
        <div style="text-align: center; color: var(--text-tertiary); padding: 2rem;">
          <p style="margin-bottom: 1rem;">No labels created yet.</p>
          <p style="font-size: 0.9rem;">Click the tag icon next to any conversation to create your first label!</p>
          <p style="font-size: 0.8rem; margin-top: 1rem;">✨ Your labels sync across all devices and stay saved when you log out!</p>
        </div>
      `;
      return;
    }

    const pillsHTML = labelEntries
      .map(
        ([id, { name, color }]) => `
      <div class="le-label-pill le-label-pill-clickable" 
           style="background-color: ${color};" 
           data-label-id="${id}" 
           data-label-name="${name}" 
           title="Single-click to search.">
        ${name}
        <span class="le-label-count" title="Delete ${name}">×</span>
      </div>
    `
      )
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
          Click a label to search • Click Sync to remove labels for deleted conversations
        </p>
      </div>
    `;

    // Add event listeners to pills
    contentArea.querySelectorAll(".le-label-pill-clickable").forEach((pill) => {
      pill.addEventListener("click", () => {
        const labelName = pill.dataset.labelName;
        const searchInput = document.getElementById("le-search-input");
        searchInput.value = labelName;
        handleSearch();
      });

      // Delete button
      const deleteBtn = pill.querySelector(".le-label-count");
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleDeleteLabel(pill.dataset.labelId);
      });
    });
  }

  async function handleDeleteLabel(labelIdToDelete) {
    if (!labelIdToDelete) return;
    const labelName = appState.data.labels[labelIdToDelete]?.name;
    if (
      !confirm(
        `Are you sure you want to permanently delete the label "${labelName}"? This cannot be undone and will sync across all your devices.`
      )
    ) {
      return;
    }

    updateSyncStatus("syncing");
    try {
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
      updateSyncStatus("synced");
      showAvailableLabels();
    } catch (error) {
      console.error("[Label Explorer] Error deleting label:", error);
      updateSyncStatus("error");
    }
  }

  function renderSearchResults(conversations) {
    const contentArea = document.getElementById("le-content");
    const { labels, chatLabels } = appState.data;

    if (conversations.length === 0) {
      contentArea.innerHTML = `
        <p style="text-align: center; color: var(--text-tertiary); padding: 1rem;">
          No conversations found with matching labels.
        </p>
      `;
      return;
    }

    const conversationItemsHTML = conversations
      .map((convo) => {
        const assignedLabelIds = chatLabels[convo.id] || [];
        const pillsHTML = assignedLabelIds
          .map((id) => {
            const label = labels[id];
            if (!label) return null;
            return `
            <div class="le-label-pill" 
                 data-label-id="${id}" 
                 data-convo-id="${convo.id}" 
                 style="background-color: ${label.color};" 
                 title="Double-click to remove label">
              ${label.name}
            </div>
          `;
          })
          .filter(Boolean)
          .join("");

        return `
        <div class="le-conversation-item">
          <a class="title" href="/c/${
            convo.id
          }" target="_blank" style="opacity: ${convo.is_archive ? 0.5 : 1};">${
          convo.title
        }</a>
          <div class="le-label-pills-container">
            ${pillsHTML}
          </div>
        </div>
      `;
      })
      .join("");

    contentArea.innerHTML = conversationItemsHTML;

    // Add double-click event listeners to remove labels
    contentArea.querySelectorAll(".le-label-pill").forEach((pill) => {
      pill.addEventListener("dblclick", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        updateSyncStatus("syncing");
        try {
          const labelId = pill.dataset.labelId;
          const convoId = pill.dataset.convoId;
          const currentLabels = appState.data.chatLabels[convoId] || [];

          appState.data.chatLabels[convoId] = currentLabels.filter(
            (id) => id !== labelId
          );
          if (appState.data.chatLabels[convoId].length === 0) {
            delete appState.data.chatLabels[convoId];
          }

          await saveStoredData(appState.data);
          updateSyncStatus("synced");
          pill.remove();
        } catch (error) {
          console.error("[Label Explorer] Error removing label:", error);
          updateSyncStatus("error");
        }
      });
    });
  }

  // --- 4. & 5. INITIALIZATION & OBSERVERS ---
  const injectionLogic = () => {
    if (document.getElementById("le-sidebar-btn")) return true;
    const sidebarNav = document.querySelector("aside");
    if (!sidebarNav) return false;

    console.log("🚀 [Label Explorer] Injecting sidebar button...");
    const mainButton = document.createElement("div");
    mainButton.id = "le-sidebar-btn";
    mainButton.tabIndex = "0";
    mainButton.className = "group __menu-item hoverable cursor-pointer";

    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const modifierKey = isMac ? "⌘" : "Ctrl";

    mainButton.innerHTML = `
      <div class="flex min-w-0 items-center gap-1.5">
        <div class="flex items-center justify-center icon">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
        </div>
        <div class="flex min-w-0 grow items-center gap-2.5">
          <div class="truncate">Label Manager</div>
        </div>
      </div>
      <div class="trailing highlight text-token-text-tertiary">
        <div class="touch:hidden">
          <div class="inline-flex whitespace-pre *:inline-flex *:font-sans *:not-last:after:px-0.5 *:not-last:after:content-['+']">
            <kbd aria-label="Control">
              <span class="min-w-[1em]">${modifierKey}</span>
            </kbd>
            <kbd>
              <span class="min-w-[1em]">L</span>
            </kbd>
          </div>
        </div>
      </div>
    `;
    const tinyButton = document.createElement("div");
    tinyButton.innerHTML = `
    <div class="">
      <div tabindex="0" data-fill="" class="group __menu-item hoverable">
        <div
          class="flex items-center justify-center group-disabled:opacity-50 group-data-disabled:opacity-50 icon"
        >
          <svg class = "w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
        </div>
      </div>
    </div>
    `;
    const tinySidebar = document
      .querySelector(
        "#stage-sidebar-tiny-bar [data-testid='create-new-chat-button']"
      )
      ?.closest("div:not([data-state])");
    if (!tinySidebar) return false;
    [mainButton, tinyButton].forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleModalVisibility(true);
      });
    });
    tinySidebar.appendChild(tinyButton);
    sidebarNav.appendChild(mainButton);
    console.log("✅ [Label Explorer] Sidebar button injected successfully.");
    return true;
  };

  function injectSidebarButton() {
    const observer = new MutationObserver(injectionLogic);
    observer.observe(document, { childList: true, subtree: true });
  }

  function initializeSidebarObserver() {
    const observer = new MutationObserver(() => {
      document.querySelectorAll("nav a[href^='/c/']")?.forEach(injectSidebarUI);
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  async function main() {
    try {
      // Load data from Chrome Storage Sync
      appState.data = await getStoredData();

      // Initialize ID counter based on existing data
      await initializeIdCounter();

      // Set up storage sync listener
      initializeStorageListener();

      console.log(
        `[Label Explorer] Initialized with ${
          Object.keys(appState.data.labels).length
        } labels, ID counter at ${idCounter}`
      );
    } catch (error) {
      console.error("[Label Explorer] Initialization error:", error);
      appState.data = { labels: {}, chatLabels: {} };
    }

    injectStyles();

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const container = document.getElementById("le-modal-container");
        const isVisible = container && container.style.display !== "none";

        // Refresh sidebar UI for new chat links
        const newChatLinks = new Set();
        document.body
          .querySelectorAll('a[href^="/c/"]')
          .forEach((link) => newChatLinks.add(link));
        newChatLinks.forEach(injectSidebarUI);
        injectionLogic();

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
  return {
    getStoredData,
    validateChatlabels,
  };
})();
