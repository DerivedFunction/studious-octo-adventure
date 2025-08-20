import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
(() => {
  const enc = new Tiktoken(o200k_base);
  console.log("✅ [Token Manager] Tokenizer initialized.");
  /**
   * Backend methods for ChatGPT
    @function getApiData() returns API data json of data 
    @var apiData = {
      metaData,
      userProfile,
      userMemory,
      turnMapData,
      toolMapData,
      messageMapData,
      imageMapData,
      canvasMapData,
      reasoningMapData,
      fileMapData,
    }; Each MapData has {key: turnId, value: []}
    @function  convertExport Uses apiData to convert file to export
    exportData = {
        markdown,
        jsonAPI,
        jsonCopy,
        jsonData,
        canvasMapData,
        metaData,
      };
    @function  getAccessToken,
    @function  getImageDownloadUrl
    @function  getConversationId,
    @function  getUserMemory,
    @var userMemory
    @var accessToken
    @var conversationId
    @var apiData // Finished apiData
    @var exportData // Finished exportData
   */
  let ChatGPT = window.ChatGPTDataExport;
  let lastCheckState = {};

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
    const conversationId = ChatGPT.getConversationId();
    if (!conversationId) {
      clearTokenUI();
      return;
    }
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
      const api = await ChatGPT.getApiData();
      const currentConversationId = ChatGPT.getConversationId();
      if (conversationId !== currentConversationId) {
        console.log(
          `🗑️ Stale data for ${conversationId} ignored; current chat is ${currentConversationId}.`
        );
        return;
      }
      console.log(api);
    } catch (e) {
      console.error("[Token Manager] ", e);
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
  let lastConvoId = ChatGPT.getConversationId();
  const observer = new MutationObserver((mutationList) => {
    const cId = ChatGPT.getConversationId();
    if (cId !== lastConvoId) {
      lastConvoId = cId;
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

  // --- UTILITY FUNCTIONS ---
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
  }
})();
