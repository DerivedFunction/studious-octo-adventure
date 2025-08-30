window.ChatGPTprompt = (() => {
  console.log("🚀 [Prompt Manager] Content script loaded.");

  // --- Configuration & State ---
  let appState = {
    prompts: [],
    uiInjected: false,
  };

  // --- IndexedDB Helper Functions ---
  const DB_NAME = "ChatGPTPromptManager";
  const DB_VERSION = 1;
  const STORE_NAME = "prompts";

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("title", "title", { unique: false });
          store.createIndex("category", "category", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
    });
  }

  // --- IndexedDB Prompt Manager ---
  const promptManager = {
    async getAllPrompts() {
      try {
        const db = await openDB();
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.error("[Prompt Manager] Error getting prompts:", error);
        return [];
      }
    },

    async addPrompt(prompt) {
      try {
        const db = await openDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        const promptData = {
          title: prompt.title,
          content: prompt.content,
          category: prompt.category || "General",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        return new Promise((resolve, reject) => {
          const request = store.add(promptData);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.error("[Prompt Manager] Error adding prompt:", error);
        throw error;
      }
    },

    async updatePrompt(id, prompt) {
      try {
        const db = await openDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        const promptData = {
          id: id,
          title: prompt.title,
          content: prompt.content,
          category: prompt.category || "General",
          updatedAt: new Date().toISOString(),
        };

        return new Promise((resolve, reject) => {
          const request = store.put(promptData);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.error("[Prompt Manager] Error updating prompt:", error);
        throw error;
      }
    },

    async deletePrompt(id) {
      try {
        const db = await openDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
          const request = store.delete(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.error("[Prompt Manager] Error deleting prompt:", error);
        throw error;
      }
    },

    async exportPrompts() {
      try {
        const prompts = await this.getAllPrompts();
        const exportData = {
          version: "1.0",
          exportDate: new Date().toISOString(),
          prompts: prompts,
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `chatgpt-prompts-${
          new Date().toISOString().split("T")[0]
        }.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log("[Prompt Manager] Prompts exported successfully");
      } catch (error) {
        console.error("[Prompt Manager] Error exporting prompts:", error);
        alert("Failed to export prompts. Please try again.");
      }
    },

    async loadPrompts(file) {
      try {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = JSON.parse(e.target.result);
              if (data.prompts && Array.isArray(data.prompts)) {
                let importCount = 0;
                for (const prompt of data.prompts) {
                  if (prompt.title && prompt.content) {
                    await this.addPrompt({
                      title: prompt.title,
                      content: prompt.content,
                      category: prompt.category || "Imported",
                    });
                    importCount++;
                  }
                }
                resolve(importCount);
              } else {
                reject(new Error("Invalid file format"));
              }
            } catch (error) {
              reject(error);
            }
          };
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsText(file);
        });
      } catch (error) {
        console.error("[Prompt Manager] Error loading prompts:", error);
        throw error;
      }
    },
  };

  // --- UI Styles ---
  function injectStyles() {
    if (document.getElementById("pm-styles")) return;

    const cssTemplate = `
      .pm-modal-container { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.6); z-index: 10000; display: flex; align-items: center; justify-content: center; font-family: inherit; opacity: 0; transition: opacity 0.2s ease-in-out; }
      .pm-modal-container.visible { opacity: 1; }
      .pm-modal { background-color: var(--main-surface-primary); color: var(--text-primary); border: 1px solid var(--border-medium); border-radius: 16px; width: 90vw; max-width: 900px; height: 85vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); overflow: hidden; transform: scale(0.95); transition: transform 0.2s ease-in-out; }
      .pm-modal-container.visible .pm-modal { transform: scale(1); }
      .pm-header { padding: 16px 20px; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; }
      .pm-header h2 { margin: 0; font-size: 1.25rem; font-weight: 600; }
      .pm-header-buttons { display: flex; gap: 8px; }
      .pm-btn { padding: 8px 12px; background: var(--main-surface-secondary); color: var(--text-primary); cursor: pointer; font-size: 0.875rem; transition: all 0.2s; }
      .pm-btn:hover { background: var(--surface-hover); }
      .pm-search-bar { padding: 12px 20px; border-bottom: 1px solid var(--border-light); }
      .pm-search-input { width: 100%; padding: 10px 12px; border: 1px solid var(--border-medium); border-radius: 8px; background: var(--main-surface-secondary); color: var(--text-primary); font-size: 0.875rem; outline: none; }
      .pm-content { flex: 1; overflow: hidden; }
      .pm-sidebar { width: 200px; border-right: 1px solid var(--border-light); padding: 12px; overflow-y: auto; }
      .pm-category-item { padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.875rem; margin-bottom: 4px; transition: background-color 0.2s; }
      .pm-category-item:hover, .pm-category-item.active { background: var(--surface-hover); }
      .pm-main-content { flex: 1; display: flex; flex-direction: column; }
      .pm-prompts-list { flex: 1; overflow-y: auto; padding: 12px; }
      .pm-prompt-item { border: 1px solid var(--border-light); border-radius: 8px; padding: 16px; margin-bottom: 12px; cursor: pointer; transition: all 0.2s; }
      .pm-prompt-item:hover { border-color: var(--border-medium); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      .pm-prompt-title { font-weight: 600; margin-bottom: 8px; font-size: 1rem; }
      .pm-prompt-preview { color: var(--text-secondary); font-size: 0.875rem; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .pm-prompt-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 0.75rem; color: var(--text-tertiary); }
      .pm-prompt-actions { display: flex; gap: 8px; }
      .pm-action-btn { border: 1px solid var(--border-light); background: transparent; color: var(--text-secondary); cursor: pointer; }
      .pm-action-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
      .pm-editor-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--main-surface-primary); border: 1px solid var(--border-medium); border-radius: 12px; width: 80vw; max-width: 700px; max-height: 80vh; display: flex; flex-direction: column; z-index: 10001; box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
      .pm-editor-header { padding: 16px 20px; border-bottom: 1px solid var(--border-light); display: flex; justify-content: between; align-items: center; }
      .pm-editor-form { padding: 20px; flex: 1; overflow-y: auto; }
      .pm-form-group { margin-bottom: 16px; }
      .pm-form-label { display: block; margin-bottom: 6px; font-weight: 500; font-size: 0.875rem; color: var(--text-primary); }
      .pm-form-input { width: 100%; padding: 10px 12px; border: 1px solid var(--border-medium); border-radius: 6px; background: var(--main-surface-secondary); color: var(--text-primary); font-size: 0.875rem; outline: none; box-sizing: border-box; }
      .pm-form-textarea { width: 100%; min-height: 200px; padding: 12px; border: 1px solid var(--border-medium); border-radius: 6px; background: var(--main-surface-secondary); color: var(--text-primary); font-size: 0.875rem; outline: none; resize: vertical; box-sizing: border-box; font-family: inherit; line-height: 1.5; }
      .pm-editor-footer { padding: 16px 20px; border-top: 1px solid var(--border-light); display: flex; justify-content: flex-end; gap: 12px; }
      .pm-file-input { display: none; }
      .pm-empty-state { text-align: center; padding: 40px 20px; color: var(--text-tertiary); }
      .pm-empty-state h3 { margin-bottom: 8px; color: var(--text-secondary); }
      #pm-close-btn {background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-tertiary); transition: color 0.2s;}
    `;

    const styleSheet = document.createElement("style");
    styleSheet.id = "pm-styles";
    styleSheet.textContent = cssTemplate;
    document.head.appendChild(styleSheet);
  }

  // --- UI Components ---
  function injectModal() {
    if (appState.uiInjected) return;

    const container = document.createElement("div");
    container.id = "pm-modal-container";
    container.className = "pm-modal-container";
    container.innerHTML = `
      <div id="pm-modal" class="pm-modal">
      <div class="pm-header">
        <h2>Prompts</h2>
        <div class="pm-header-buttons">
          <input
            type="file"
            id="pm-file-input"
            class="pm-file-input"
            accept=".json"
          >
            <button id="pm-import-btn" class="flex gap-1.5 btn pm-btn" title="Import">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="lucide lucide-upload-icon lucide-upload"
              >
                <path d="M12 3v12" />
                <path d="m17 8-5-5-5 5" />
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              </svg>
              <span class="hidden md:block">Import</span>
            </button>
          </input>
          <button id="pm-export-btn" class="flex gap-1.5 btn pm-btn" title="Export">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            <span class="hidden md:block">Export</span>
          </button>
          <button id="pm-new-btn" class="flex gap-1.5 btn pm-btn" title="Create new">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="lucide lucide-plus-icon lucide-plus"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            <span class="hidden md:block">Create New</span>
          </button>
          <button id="pm-close-btn">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="lucide lucide-x-icon lucide-x"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="pm-search-bar">
        <input
          type="text"
          id="pm-search-input"
          class="pm-search-input"
          placeholder="Search prompts..."
        ></input>
      </div>
      <div class="pm-content flex flex-row">
        <div class="pm-sidebar hidden md:block">
          <div id="pm-categories" class="truncate"></div>
        </div>
        <div class="pm-main-content">
          <div id="pm-prompts-list" class="pm-prompts-list"></div>
        </div>
      </div>
    </div>
    `;

    document.body.appendChild(container);
    appState.uiInjected = true;
    addModalEventListeners();
  }

  function showEditor(prompt = null) {
    const backdrop = document.createElement("div");
    backdrop.className = "pm-modal-container visible";
    backdrop.innerHTML = `
      <div class="pm-editor-modal">
        <div class="pm-editor-header">
          <h3>${prompt ? "Edit Prompt" : "New Prompt"}</h3>
        </div>
        <div class="pm-editor-form">
          <div class="pm-form-group">
            <label class="pm-form-label">Title</label>
            <input type="text" id="pm-editor-title" class="pm-form-input" placeholder="Enter prompt title..." value="${
              prompt ? escapeHTML(prompt.title) : ""
            }">
          </div>
          <div class="pm-form-group">
            <label class="pm-form-label">Category</label>
            <input type="text" id="pm-editor-category" class="pm-form-input" placeholder="Enter category..." value="${
              prompt ? escapeHTML(prompt.category) : ""
            }">
          </div>
          <div class="pm-form-group">
            <label class="pm-form-label">Content</label>
            <textarea id="pm-editor-content" class="pm-form-textarea" placeholder="Enter your prompt here...">${
              prompt ? escapeHTML(prompt.content) : ""
            }</textarea>
          </div>
        </div>
        <div class="pm-editor-footer">
          <button id="pm-editor-cancel" class="pm-btn btn">Cancel</button>
          <button id="pm-editor-save" class="pm-btn btn">Save</button>
          <button id="pm-editor-use" class="pm-btn btn">Use</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Event listeners
    backdrop
      .querySelector("#pm-editor-cancel")
      .addEventListener("click", () => {
        backdrop.remove();
      });
    backdrop.querySelector("#pm-editor-use").addEventListener("click", () => {
      const content = document.getElementById("pm-editor-content").value.trim();
      backdrop.remove();
      toggleModalVisibility(false);
      pasteText(content);
    });

    backdrop
      .querySelector("#pm-editor-save")
      .addEventListener("click", async () => {
        const title = document.getElementById("pm-editor-title").value.trim();
        const category =
          document.getElementById("pm-editor-category").value.trim() ||
          "General";
        const content = document
          .getElementById("pm-editor-content")
          .value.trim();

        if (!title || !content) {
          alert("Please fill in both title and content.");
          return;
        }

        try {
          if (prompt) {
            await promptManager.updatePrompt(prompt.id, {
              title,
              category,
              content,
            });
          } else {
            await promptManager.addPrompt({ title, category, content });
          }

          backdrop.remove();
          await refreshPromptsList();
        } catch (error) {
          console.error("[Prompt Manager] Error saving prompt:", error);
          alert("Failed to save prompt. Please try again.");
        }
      });

    // Close on backdrop click
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.remove();
      }
    });

    // Focus title input
    setTimeout(() => {
      document.getElementById("pm-editor-title").focus();
    }, 100);
  }

  // --- Event Handlers ---
  function addModalEventListeners() {
    const container = document.getElementById("pm-modal-container");
    const searchInput = document.getElementById("pm-search-input");
    const fileInput = document.getElementById("pm-file-input");

    // Close modal
    container.addEventListener("click", (e) => {
      if (e.target.id === "pm-modal-container") toggleModalVisibility(false);
    });

    document.getElementById("pm-close-btn").addEventListener("click", () => {
      toggleModalVisibility(false);
    });

    // Header buttons
    document.getElementById("pm-new-btn").addEventListener("click", () => {
      showEditor();
    });

    document.getElementById("pm-export-btn").addEventListener("click", () => {
      promptManager.exportPrompts();
    });

    document.getElementById("pm-import-btn").addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const importCount = await promptManager.loadPrompts(file);
        alert(`Successfully imported ${importCount} prompts!`);
        await refreshPromptsList();
        fileInput.value = ""; // Reset file input
      } catch (error) {
        console.error("[Prompt Manager] Import error:", error);
        alert("Failed to import prompts. Please check the file format.");
      }
    });

    // Search
    searchInput.addEventListener("input", handleSearch);
  }

  async function handleSearch() {
    const searchInput = document.getElementById("pm-search-input");
    const query = searchInput.value.toLowerCase().trim();

    const allPrompts = await promptManager.getAllPrompts();
    let filteredPrompts = allPrompts;

    if (query) {
      filteredPrompts = allPrompts.filter(
        (prompt) =>
          prompt.title.toLowerCase().includes(query) ||
          prompt.content.toLowerCase().includes(query) ||
          prompt.category.toLowerCase().includes(query)
      );
    }

    renderPromptsList(filteredPrompts);
  }

  async function refreshPromptsList() {
    appState.prompts = await promptManager.getAllPrompts();
    renderCategories();
    renderPromptsList(appState.prompts);
  }

  function escapeHTML(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function renderCategories() {
    const categories = [...new Set(appState.prompts.map((p) => p.category))];
    const categoriesContainer = document.getElementById("pm-categories");
    const categoryHTML = `
      <div class="pm-category-item active truncate" data-category="all" title="All Prompts">All Prompts</div>
      ${categories
        .map((cat) => {
          const category = escapeHTML(cat);
          return `<div class="pm-category-item truncate" data-category="${category}" title="${category}">${category}</div>`;
        })
        .join("")}
    `;

    categoriesContainer.innerHTML = categoryHTML;

    // Add click handlers
    categoriesContainer
      .querySelectorAll(".pm-category-item")
      .forEach((item) => {
        item.addEventListener("click", () => {
          // Remove active class from all items
          categoriesContainer
            .querySelectorAll(".pm-category-item")
            .forEach((i) => i.classList.remove("active"));
          // Add active class to clicked item
          item.classList.add("active");

          const category = item.dataset.category;
          const filteredPrompts =
            category === "all"
              ? appState.prompts
              : appState.prompts.filter((p) => p.category === category);
          renderPromptsList(filteredPrompts);
        });
      });
  }

  function renderPromptsList(prompts) {
    const listContainer = document.getElementById("pm-prompts-list");

    if (prompts.length === 0) {
      listContainer.innerHTML = `
        <div class="pm-empty-state">
          <h3>No prompts found</h3>
          <p>Create your first prompt to get started!</p>
          <p>Prompts are saved locally until you logout.</p>
          <p>Please export to save your data.</p>
          <button class="btn">Generate Sample Prompts</button>
        </div>
      `;
      listContainer
        .querySelector("button")
        .addEventListener("click", async () => {
          for (const e of samplePrompts) {
            await promptManager.addPrompt(e);
          }
          refreshPromptsList();
        });
      return;
    }

    const promptsHTML = prompts
      .map(
        (prompt) => `
      <div class="pm-prompt-item" data-prompt-id="${prompt.id}">
        <div class="pm-prompt-title">${escapeHTML(prompt.title).substring(
          0,
          200
        )}</div>
        <div class="pm-prompt-preview">${escapeHTML(prompt.content).substring(
          0,
          400
        )}</div>
        <div class="pm-prompt-meta">
          <span>${escapeHTML(prompt.category).substring(0, 100)} • ${new Date(
          prompt.createdAt || prompt.updatedAt
        ).toLocaleDateString()}</span>
          <div class="pm-prompt-actions">
            <button class="pm-action-btn pm-edit-btn btn" data-prompt-id="${
              prompt.id
            }">Edit and Use</button>
            <button class="pm-action-btn pm-delete-btn btn" data-prompt-id="${
              prompt.id
            }">Delete</button>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    listContainer.innerHTML = promptsHTML;

    listContainer.querySelectorAll(".pm-edit-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const promptId = parseInt(btn.dataset.promptId);
        const prompt = prompts.find((p) => p.id === promptId);
        if (prompt) {
          showEditor(prompt);
        }
      });
    });

    listContainer.querySelectorAll(".pm-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const promptId = parseInt(btn.dataset.promptId);
        const prompt = prompts.find((p) => p.id === promptId);

        if (
          prompt &&
          confirm(`Are you sure you want to delete "${prompt.title}"?`)
        ) {
          try {
            await promptManager.deletePrompt(promptId);
            await refreshPromptsList();
          } catch (error) {
            console.error("[Prompt Manager] Error deleting prompt:", error);
            alert("Failed to delete prompt. Please try again.");
          }
        }
      });
    });
  }

  function toggleModalVisibility(show) {
    if (!appState.uiInjected) {
      if (show) injectModal();
      else return;
    }

    const container = document.getElementById("pm-modal-container");
    if (show) {
      container.style.display = "flex";
      setTimeout(() => container.classList.add("visible"), 10);

      // Close sidebar on mobile
      if (window.matchMedia("(max-width: 767px)").matches) {
        document.querySelector("[aria-label='Close sidebar']")?.click();
      }

      // Focus search input and refresh prompts
      const searchInput = document.getElementById("pm-search-input");
      searchInput.value = "";
      searchInput.focus();
      refreshPromptsList();
    } else {
      container.classList.remove("visible");
      setTimeout(() => (container.style.display = "none"), 200);
    }
  }

  // --- Main UI Integration ---
  function buildPromptOption(selector) {
    const fileBtn = Array.from(document.querySelectorAll(selector)).filter(
      (e) => e.textContent.includes("Add photos")
    )[0];
    if (!fileBtn) return;
    const container = fileBtn.parentElement;
    let exist = document.querySelector(".newPromptMenuItem");

    if (exist || !container) return;

    const menuitem = document.createElement("div");
    menuitem.classList.add("newPromptMenuItem");
    menuitem.innerHTML = `
      <div
        role="menuitem"
        tabindex="1"
        class="group __menu-item gap-1.5 rounded-lg min-h-9 touch:min-h-10 hover:bg-token-surface-hover focus-visible:bg-token-surface-hover"
        data-orientation="vertical"
        data-radix-collection-item=""
      >
        <div class="flex items-center justify-center icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle-icon lucide-message-circle"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>
        </div>
        <div class="flex min-w-0 grow items-center gap-2.5 group-data-no-contents-gap:gap-0">
          <div class="truncate">Add Prompts</div>
        </div>
      </div>
    `;

    container.insertBefore(menuitem, fileBtn);
    menuitem.addEventListener("click", showPromptsModal);
  }

  function showPromptsModal() {
    toggleModalVisibility(true);
  }


  /**
   * Pastes text into a contenteditable div (replace or append).
   * Always moves the cursor to the end afterwards.
   *
   * @param {string} text - Text to paste
   * @param {boolean} replace - If true, replaces existing content. If false, appends.
   */
  async function pasteText(text, replace = false) {
    console.log("[Prompt Debugger] Pasting text:", text, "replace:", replace);

    // Case 1: contenteditable div
    const editableDiv = document.body.querySelector(
      "div[contenteditable='true']"
    );
    if (editableDiv) {
      // Convert newlines to <p>
      const lines = text.split("\n");
      const htmlContent = lines
        .map((line) => `<p>${escapeHTML(line) || ""}</p>`)
        .join("");

      // Replace or is empty
      if (replace || editableDiv.textContent == "") {
        editableDiv.innerHTML = htmlContent;
      } else {
        editableDiv.innerHTML += htmlContent;
      }

      // Dispatch input event
      const inputEvent = new InputEvent("input", {
        inputType: replace ? "insertReplacementText" : "insertText",
        data: text,
        bubbles: true,
        cancelable: true,
      });
      editableDiv.dispatchEvent(inputEvent);

      // Move cursor to end
      editableDiv.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editableDiv);
      range.collapse(false); // false = end
      selection.removeAllRanges();
      selection.addRange(range);

      return;
    }

    // Case 2: textarea or input
    const textarea = document.querySelector("textarea, input[type='text']");
    if (textarea) {
      if (replace) {
        textarea.value = text;
      } else {
        textarea.value += text;
      }

      // Move cursor to end
      textarea.focus();
      const pos = textarea.value.length;
      textarea.setSelectionRange(pos, pos);

      return;
    }

    console.warn("[Prompt Debugger] No editable field found.");
  }

  // --- Initialization ---
  function init() {
    console.log("[Prompt Manager] Initializing...");

    injectStyles();

    // Set up mutation observer to inject the prompt option
    const observer = new MutationObserver(() => {
      buildPromptOption("div[role='menuitem']");
      buildPromptOption(".popover .group.__menu-item[data-highlighted]");
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "m") {
        e.preventDefault();
        toggleModalVisibility(true);
      }
    });
    console.log("[Prompt Manager] Initialized successfully");
  }

  // Initialize the prompt manager
  init();

  const samplePrompts = [
    {
      title: "Solve",
      content: `Solve the following problem. Provide clear reasoning for each step, briefly verify the final answer:\n`,
      category: "Education",
    },
    {
      title: "Summarize",
      content: `Summarize the following content. Include: brief overview, key points as bullets, important terms:\n`,
      category: "Education",
    },
    {
      title: "Explain",
      content: `Explain this concept clearly with step-by-step logic and examples:\n`,
      category: "Education",
    },
    {
      title: "Write",
      content: `Write based on these requirements:\n`,
      category: "Writing",
    },
    {
      title: "Analyze",
      content: `Analyze this topic systematically. Include overview, key findings, supporting evidence, implications, and conclusion:\n`,
      category: "Education",
    },
    {
      title: "Learn",
      content:
        "Generate sample problems on the topic. Do not solve them yet. Wait for me to request hints or guidance before providing explanations:\n\n<topic>\n</topic>",
      category: "Education",
    },
    {
      title: "Plan",
      content: `Draft a practical plan with phases, milestones, risks, and success metrics. Include a 1–2 week quick-start plan:\n`,
      category: "Productivity",
    },
    {
      title: "Translate",
      content: `Translate the following text into the target language. Ensure accuracy, preserve tone, and explain cultural nuances if relevant:\n`,
      category: "Education",
    },
    {
      title: "Improve Writing",
      content: `Improve the clarity, grammar, and tone of the following text. Suggest improvements without changing the meaning:\n`,
      category: "Writing",
    },
    {
      title: "Email Draft",
      content: `Draft a professional email based on this context. Include subject, greeting, body, and sign-off. Keep it concise:\n`,
      category: "Productivity",
    },
    {
      title: "Q&A",
      content: `Answer the following question directly. Provide a clear, concise answer with supporting reasoning if needed:\n`,
      category: "Education",
    },
    {
      title: "Code Features",
      content: `Implement these features in the existing code. Preserve existing functionality, explain changes and show code snippets, and provide the top-level functions added/modified to copy/paste.\n<features>\n</features>\n\n<code-content name="">\n\n</code-content>`,
      category: "Development",
    },
    {
      title: "Code Review",
      content: `Review this code and provide improvement suggestions. Focus on: readability, performance, best practices, potential issues. Provide specific suggestions with examples:\n\n<code-content name="">\n\n</code-content>`,
      category: "Development",
    },
    {
      title: "Code Document",
      content: `Add inline comments and generate documentation for this code. Focus on: readability, purpose of functions, parameters, and return values. Provide a documented version of the code:\n\n<code-content name="">\n\n</code-content>`,
      category: "Development",
    },
    {
      title: "Code Test",
      content: `Write test cases for this code. Focus on correctness, edge cases, and performance. Show example unit tests or integration tests where applicable:\n\n<code-content name="">\n\n</code-content>`,
      category: "Development",
    },
    {
      title: "Code Run",
      content: `Explain how to run this code. Include environment setup, dependencies, build steps, and example commands. Provide sample input/output if helpful:\n\n<code-content name="">\n\n</code-content>`,
      category: "Development",
    },
    {
      title: "Code Explain",
      content: `Provide a detailed, step-by-step explanation of the following code snippet. Structure your response with sections:\n1. Overview (purpose and high-level logic).\n2. Imports/Libraries (list each, explain purpose and usage).\n3. Key Functions/Methods (describe each, including parameters, return values, and role in the code).\n4. Main Logic Flow (break down execution line by line or block by block).\n5. Arguments and Context (how inputs fit and affect behavior).\n6. Potential Improvements or Edge Cases (if applicable):\n\n<code-content name="">\n\n</code-content>`,
      category: "Development",
    },
    {
      title: "Debug Code",
      content: `Fix the errors in this code. Explain changes, show code snippets, and provide the top-level functions added/modified to copy/paste:\n<error>\n</error>\n\n<code-content name="">\n\n</code-content>`,
      category: "Development",
    },
    {
      title: "Outline",
      content: `Create a clear outline. Include: working title, sections with 1–2 bullets each, suggested visuals/examples:\n`,
      category: "Writing",
    },
    {
      title: "Brainstorm",
      content: `List at least 5 ideas. Group by theme, mark top 3 with reasons, note quick next steps:\n`,
      category: "Writing",
    },
    {
      title: "Compare",
      content: `Compare the following items. Provide a concise table, key differences, pros/cons, and a recommendation:\n`,
      category: "Education",
    },
    {
      title: "Critique",
      content: `Provide a candid critique. Cover clarity, logic, evidence, tone, and gaps. Include a prioritized fix list:\n`,
      category: "Education",
    },
  ];

  // Return public API
  return {
    get promptManager() {
      return promptManager;
    },
    pasteText,
    showModal: () => toggleModalVisibility(true),
    hideModal: () => toggleModalVisibility(false),
  };
})();
