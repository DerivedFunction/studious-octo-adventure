(() => {
  // --- SHARED UTILITIES ---

  let accessToken = null;

  /**
   * Fetches and stores the access token globally. Only fetches if the token is not already present.
   * @returns {Promise<string|null>} The access token or null if it fails.
   */
  async function getAccessToken() {
    if (accessToken) {
      return accessToken;
    }
    try {
      const session = await fetch("https://chatgpt.com/api/auth/session").then(
        (res) => {
          if (!res.ok) throw new Error("Failed to fetch auth session");
          return res.json();
        }
      );
      accessToken = session.accessToken;
      return accessToken;
    } catch (error) {
      console.error(
        "❌ [Export Script] Could not retrieve access token:",
        error
      );
      accessToken = null;
      return null;
    }
  }

  /**
   * Extracts conversation ID from the current URL.
   * @returns {string|null} The conversation ID or null if not found.
   */
  function getConversationId() {
    return window.location.pathname.split("/")[2];
  }

  // --- PRINT FUNCTIONALITY ---

  /**
   * Fetches canvas content specifically for the print function.
   * @param {string} conversationId The conversation ID
   * @returns {Promise<Map>} Map of textdoc_id to canvas content
   */
  async function fetchCanvasContentForPrint(conversationId) {
    const canvasMap = new Map();
    try {
      const token = await getAccessToken();
      if (!token) return canvasMap;

      const response = await fetch(
        `https://chatgpt.com/backend-api/conversation/${conversationId}`,
        {
          headers: {
            accept: "*/*",
            authorization: `Bearer ${token}`,
          },
          method: "GET",
        }
      );
      if (!response.ok) return canvasMap;

      const conversationApiData = await response.json();
      const latestCanvasData = new Map();

      if (conversationApiData && conversationApiData.mapping) {
        for (const messageId in conversationApiData.mapping) {
          const node = conversationApiData.mapping[messageId];
          const recipient = node.message?.recipient;

          if (
            recipient === "canmore.create_textdoc" ||
            recipient === "canmore.update_textdoc"
          ) {
            if (node.children && node.children.length > 0) {
              const toolNode = conversationApiData.mapping[node.children[0]];
              if (
                toolNode?.message?.author?.role === "tool" &&
                toolNode.message.metadata.canvas
              ) {
                try {
                  const {
                    textdoc_id,
                    version,
                    title: canvasTitle,
                  } = toolNode.message.metadata.canvas;
                  const contentNode = JSON.parse(node.message.content.parts[0]);
                  let content =
                    contentNode.content ||
                    contentNode.updates?.[0]?.replacement ||
                    "";

                  const existing = latestCanvasData.get(textdoc_id);
                  if (!existing || existing.version < version) {
                    latestCanvasData.set(textdoc_id, {
                      version,
                      title: canvasTitle || contentNode.name || "Canvas",
                      content,
                    });
                  }
                } catch (e) {
                  console.error(
                    "❌ [Print Script] Error processing canvas data:",
                    e
                  );
                }
              }
            }
          }
        }
      }
      latestCanvasData.forEach((data, textdoc_id) => {
        canvasMap.set(textdoc_id, data);
      });
    } catch (error) {
      console.error("❌ [Print Script] Failed to fetch canvas content:", error);
    }
    return canvasMap;
  }

  /**
   * Finds the main chat content, clones it, and triggers the browser's print dialog.
   */
  /**
   * Finds the main chat content, clones it into a hidden iframe with styles,
   * fetches canvas content, and triggers the browser's print dialog.
   */
  async function triggerPrint() {
    // 1. Find the main content area you want to print.
    const printArea = document.querySelector("article")?.parentElement;
    if (!printArea) {
      alert("Could not find chat content to print.");
      return;
    }

    // Get conversation ID and fetch canvas content
    const conversationId = getConversationId();
    let canvasMap = new Map();

    if (conversationId) {
      console.log("🚀 [Print Script] Fetching canvas content...");
      canvasMap = await fetchCanvasContentForPrint(conversationId);
      console.log(
        `✅ [Print Script] Fetched ${canvasMap.size} canvas documents`
      );
    }

    // 2. Create a hidden iframe to build the print content in isolation.
    const printFrame = document.createElement("iframe");
    printFrame.style.position = "absolute";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    document.body.appendChild(printFrame);

    const printDocument = printFrame.contentWindow.document;

    // 3. Clone all stylesheet links from the original page into the iframe.
    document
      .querySelectorAll('link[rel="stylesheet"], style')
      .forEach((styleElement) => {
        printDocument.head.appendChild(styleElement.cloneNode(true));
      });

    // 4. Add comprehensive print-only stylesheet to override dark mode and adjust layout.
    const printStyles = `
    @media print {
      /* Force light mode for all elements */
      *, *::before, *::after {
        background-color: white !important;
        color: black !important;
        border-color: #ccc !important;
        box-shadow: none !important;
      }

      /* Ensure body and html have white background */
      html, body {
        background: white !important;
        color: black !important;
      }

      /* Hide UI elements that shouldn't be printed */
      body > div:not(.print-content),
      main > div:first-child,
      form, button, .token-count-display,
      .extra-token-info, .token-status-container,
      .prompt-token-count, nav, header, footer,
      [role="banner"], [role="navigation"], [role="complementary"] {
        display: none !important;
      }

      /* Ensure the print content takes up the full page with proper margins */
      .print-content {
        width: 100% !important;
        padding: 0 !important;
        box-shadow: none !important;
        background: white !important;
        color: black !important;
      }

      /* Add page margins for proper printing */
      @page {
        margin: 0.25in;
        size: letter;
      }

      /* Format code blocks with light background and proper contrast */
      pre, code {
        background-color: #f8f8f8 !important;
        color: #333 !important;
        border: 1px solid #ddd !important;
        white-space: pre-wrap !important;
        word-break: break-word !important;
        page-break-inside: avoid;
      }

      /* Style code syntax highlighting for print */
      .hljs-keyword, .hljs-built_in { color: #0000ff !important; }
      .hljs-string { color: #008000 !important; }
      .hljs-comment { color: #808080 !important; }
      .hljs-number { color: #ff0000 !important; }
      .hljs-title { color: #800080 !important; }

      /* Ensure links are visible */
      a {
        color: #0066cc !important;
        text-decoration: underline !important;
      }

      /* Style headings */
      h1, h2, h3, h4, h5, h6 {
        color: black !important;
        background: white !important;
        page-break-after: avoid;
      }

      /* Ensure tables are readable */
      table, th, td {
        border: 1px solid #333 !important;
        background: white !important;
        color: black !important;
        border-collapse: collapse !important;
        page-break-inside: avoid !important;
      }

      th {
        background-color: #f0f0f0 !important;
        font-weight: bold !important;
        padding: 8px !important;
        text-align: left !important;
        vertical-align: top !important;
      }

      td {
        padding: 8px !important;
        vertical-align: top !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        max-width: 200px !important;
      }

      /* Fix table layout */
      table {
        width: 100% !important;
        table-layout: fixed !important;
        margin: 8px 0 !important;
      }

      /* Ensure table text doesn't get cut off */
      table * {
        font-size: 12px !important;
        line-height: 1.3 !important;
      }

      /* Style user message bubbles */
      article[data-turn="user"] .user-message-bubble-color {
        background-color: #f5f5f5 !important;
        border: 0px !important;
        border-radius: 18px !important;
        padding: 12px 16px !important;
        margin: 4px 0 !important;
      }

      /* Force grey background for all user message text */
      article[data-turn="user"] .user-message-bubble-color * {
        background-color: #f5f5f5 !important;
      }

      /* Canvas content styling */
      .canvas-content {
        background-color: #f8f8f8 !important;
        border: 1px solid #ddd !important;
        border-radius: 4px !important;
        padding: 12px !important;
        margin: 8px 0 !important;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace !important;
        font-size: 12px !important;
        line-height: 1.4 !important;
        white-space: pre-wrap !important;
        word-break: break-word !important;
        page-break-inside: avoid;
      }

      .canvas-title {
        background-color: #e8e8e8 !important;
        color: #333 !important;
        font-weight: bold !important;
        padding: 8px 12px !important;
        margin: 0 0 8px 0 !important;
        border-radius: 4px 4px 0 0 !important;
        font-size: 13px !important;
      }

      /* Page break controls */
      .page-break-before { page-break-before: always; }
      .page-break-after { page-break-after: always; }
      .no-page-break { page-break-inside: avoid; }

      /* Improve readability */
      p, li {
        line-height: 1.4 !important;
        margin-bottom: 0.5em !important;
      }

      /* Remove any dark backgrounds that might slip through */
      [class*="dark"], [class*="bg-"], [style*="background"] {
        background: white !important;
        background-color: white !important;
      }
    }
  `;

    const styleSheet = printDocument.createElement("style");
    styleSheet.textContent = printStyles;
    printDocument.head.appendChild(styleSheet);

    // 5. Clone the content into the iframe's body.
    const contentToPrint = printArea.cloneNode(true);
    contentToPrint.classList.add("print-content");

    // Remove dark mode classes more thoroughly
    const removeClasses = ["dark", "dark-mode", "theme-dark"];
    removeClasses.forEach((className) => {
      contentToPrint.classList.remove(className);
      // Also remove from all child elements
      contentToPrint.querySelectorAll(`.${className}`).forEach((el) => {
        el.classList.remove(className);
      });
    });

    // Remove any inline dark styles
    contentToPrint.querySelectorAll("[style]").forEach((el) => {
      const style = el.getAttribute("style");
      if (style && (style.includes("background") || style.includes("color"))) {
        // Remove background and color styles that might interfere
        el.style.background = "";
        el.style.backgroundColor = "";
        el.style.color = "";
      }
    });

    printDocument.body.appendChild(contentToPrint);

    // Handle canvas textdoc content
    printDocument.querySelectorAll(".popover").forEach((codeEl) => {
      // Clear inline height
      codeEl.style.height = "";

      // Extract textdoc ID from the element's ID attribute
      const elementId = codeEl.id;
      if (elementId && elementId.startsWith("textdoc-message-")) {
        const textdocId = elementId.replace("textdoc-message-", "");

        if (canvasMap.has(textdocId)) {
          const canvasData = canvasMap.get(textdocId);

          // Clear existing content and add canvas data
          codeEl.innerHTML = "";
          codeEl.className = "canvas-content";

          // Add title if available
          if (canvasData.title) {
            const titleEl = printDocument.createElement("div");
            titleEl.className = "canvas-title";
            titleEl.textContent = `📄 ${canvasData.title}`;
            codeEl.appendChild(titleEl);
          }

          // Add content
          const contentEl = printDocument.createElement("div");
          contentEl.textContent =
            canvasData.content || "[Canvas content not available]";
          codeEl.appendChild(contentEl);

          console.log(
            `✅ [Print Script] Populated canvas content for ${textdocId}`
          );
        } else {
          // Fallback for canvas elements without content
          codeEl.textContent =
            "[Canvas content - please use Export MD for full content]";
          console.warn(
            `⚠️ [Print Script] Canvas content not found for ${textdocId}`
          );
        }
      }
    });

    // 6. Fix code blocks inside articles and add user message borders.
    const articles = printDocument.querySelectorAll("article");
    articles.forEach((article) => {
      // Check if this is a user message by looking at data-turn attribute
      const isUser = article.getAttribute("data-turn") === "user";

      // Add styling for user messages
      if (isUser) {
        // Style the user message bubble if it exists
        const messageBubble = article.querySelector(
          ".user-message-bubble-color"
        );
        if (messageBubble) {
          messageBubble.style.backgroundColor = "#f5f5f5";
          messageBubble.style.border = "0px";

          // Force grey background for all child elements to avoid white text backgrounds
          const allChildren = messageBubble.querySelectorAll("*");
          allChildren.forEach((child) => {
            child.style.backgroundColor = "#f5f5f5";
          });
        }
      }

      const content = article.querySelector("[tabindex]");
      if (!content) return;

      // Clean up classes that might interfere with printing
      content.className = "print-article-content";

      const codeBlocks = content.querySelectorAll("code, pre");
      codeBlocks.forEach((codeEl) => {
        // Skip canvas elements (they're handled separately)
        if (codeEl.classList.contains("canvas-content")) return;

        // Ensure proper styling for code blocks
        if (codeEl.parentElement) {
          codeEl.parentElement.className = "code-container";
        }

        // Apply print-friendly code styling
        codeEl.style.whiteSpace = "pre-wrap";
        codeEl.style.wordBreak = "break-word";
        codeEl.style.fontSize = "12px";
        codeEl.style.lineHeight = "1.4";

        // Handle nested elements in code blocks
        const codeChildren = codeEl.querySelectorAll("*");
        codeChildren.forEach((child) => {
          child.style.whiteSpace = "pre-wrap";
          child.style.wordBreak = "break-word";
        });
      });

      // Fix table formatting
      const tables = content.querySelectorAll("table");
      tables.forEach((table) => {
        table.style.width = "100%";
        table.style.tableLayout = "fixed";
        table.style.borderCollapse = "collapse";
        table.style.margin = "8px 0";

        // Fix table cells
        const cells = table.querySelectorAll("th, td");
        cells.forEach((cell) => {
          cell.style.padding = "8px";
          cell.style.verticalAlign = "top";
          cell.style.wordWrap = "break-word";
          cell.style.overflowWrap = "break-word";
          cell.style.fontSize = "12px";
          cell.style.lineHeight = "1.3";
        });
      });
    });

    // 7. Wait for styles to load, then trigger print and cleanup
    setTimeout(() => {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();

      // Clean up after a delay to ensure print dialog has appeared
      setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame);
        }
      }, 1000);
    }, 200);
  }
  // --- MARKDOWN EXPORT FUNCTIONALITY ---

  /**
   * Formats timestamp to readable string.
   */
  function formatTimestamp(timestamp) {
    if (!timestamp) return "";
    return new Date(timestamp * 1000).toLocaleString();
  }

  /**
   * Formats canvas content for markdown.
   */
  function formatCanvasContentForMd(canvases) {
    if (!canvases || canvases.length === 0) return "";
    let canvasMarkdown = "\n\n---\n\n### Canvas Files\n\n";
    canvases.forEach((canvas) => {
      canvasMarkdown += `#### ${canvas.title}\n\n\`\`\`\n${canvas.content}\n\`\`\`\n\n`;
    });
    return canvasMarkdown;
  }

  /**
   * Extracts and processes conversation data from ChatGPT API for Markdown export.
   */
  async function exportConversationToMarkdown(conversationId) {
    const token = await getAccessToken();
    if (!token) throw new Error("Access token not available.");

    const response = await fetch(
      `https://chatgpt.com/backend-api/conversation/${conversationId}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      }
    );
    if (!response.ok) throw new Error(`API request failed: ${response.status}`);

    const data = await response.json();
    const additionalDataMap = new Map();
    const latestCanvasData = new Map();

    // Process canvas data
    if (data.mapping) {
      for (const messageId in data.mapping) {
        const node = data.mapping[messageId];
        const recipient = node.message?.recipient;

        if (
          recipient === "canmore.create_textdoc" ||
          recipient === "canmore.update_textdoc"
        ) {
          const toolNode = data.mapping[node.children?.[0]];
          if (
            toolNode?.message?.author?.role === "tool" &&
            toolNode.message.metadata.canvas
          ) {
            try {
              const {
                textdoc_id,
                version,
                title: canvasTitle,
              } = toolNode.message.metadata.canvas;
              const contentNode = JSON.parse(node.message.content.parts[0]);
              let type = contentNode.type.split("/")[1] || null;

              let currentNodeId = toolNode.id;
              let currentNode = toolNode;
              while (currentNode?.children?.length > 0) {
                currentNodeId = currentNode.children[0];
                currentNode = data.mapping[currentNodeId];
                if (
                  currentNode?.message?.author?.role === "assistant" &&
                  currentNode?.message?.recipient === "all"
                )
                  break;
              }

              let title =
                canvasTitle && type
                  ? `${canvasTitle}: ${type}`
                  : canvasTitle || contentNode.name || "Canvas";
              let content =
                contentNode.content ||
                contentNode.updates?.[0]?.replacement ||
                "";
              if (contentNode.updates && latestCanvasData.has(textdoc_id))
                title = latestCanvasData.get(textdoc_id).title;

              const existing = latestCanvasData.get(textdoc_id);
              if (!existing || existing.version < version) {
                latestCanvasData.set(textdoc_id, {
                  version,
                  title,
                  content,
                  attachToMessageId: currentNodeId,
                });
              }
            } catch (e) {
              console.error("❌ [Export MD] Error processing canvas data:", e);
            }
          }
        }
      }
    }

    latestCanvasData.forEach((canvas, textdoc_id) => {
      const attachTo = canvas.attachToMessageId;
      const existing = additionalDataMap.get(attachTo) || {};
      const existingCanvases = existing.canvases || [];
      additionalDataMap.set(attachTo, {
        ...existing,
        canvases: [
          ...existingCanvases,
          {
            title: canvas.title,
            content: canvas.content,
          },
        ],
      });
    });

    // Build markdown string
    let markdown = `# ${data.title}\n\n`;
    markdown += `**Created:** ${formatTimestamp(data.create_time)}\n`;
    markdown += `**Updated:** ${formatTimestamp(data.update_time)}\n\n---\n\n`;

    const processedMessages = new Set();
    const traverseConversation = (nodeId) => {
      if (!nodeId || processedMessages.has(nodeId)) return;
      const node = data.mapping[nodeId];
      if (!node?.message) return;

      processedMessages.add(nodeId);
      const { author, content, metadata, recipient } = node.message;

      const role = author?.role;
      const shouldSkip =
        role === "system" ||
        role === "tool" ||
        metadata?.is_visually_hidden_from_conversation;

      if (!shouldSkip && content?.parts?.length > 0) {
        if (role === "user") {
          markdown += `## You\n\n${content.parts.join("\n")}\n\n`;
        } else if (role === "assistant" && recipient === "all") {
          let textContent = content.parts
            .join("\n")
            .replace(/\uE200.*?\uE201/g, "")
            .trim();
          markdown += `## ChatGPT\n\n${textContent}\n`;

          const additional = additionalDataMap.get(nodeId);
          if (additional?.canvases) {
            markdown += formatCanvasContentForMd(additional.canvases);
          }
          markdown += "\n";
        }
      }
      if (node.children?.length > 0) traverseConversation(node.children[0]);
    };

    if (data.mapping["client-created-root"]) {
      traverseConversation("client-created-root");
    }
    return markdown;
  }

  /**
   * Downloads the markdown content as a file.
   */
  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Main function to trigger the markdown export process.
   */
  async function exportCurrentConversation() {
    try {
      const conversationId = getConversationId();
      if (!conversationId) {
        alert("No conversation found.");
        return;
      }
      const markdown = await exportConversationToMarkdown(conversationId);
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `chatgpt-export-${timestamp}.md`;
      downloadMarkdown(markdown, filename);
    } catch (error) {
      console.error("❌ [Export MD] Export failed:", error);
      alert("Export failed. Check the console for details.");
    }
  }

  // --- UI AND INITIALIZATION ---

  /**
   * Injects CSS for the custom dropdown menu to match ChatGPT's UI.
   */
  function injectStyles() {
    if (document.getElementById("export-menu-styles")) return;
    const style = document.createElement("style");
    style.id = "export-menu-styles";
    style.textContent = `
    #export-menu-container {
      position: relative;
    }
    #export-menu-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 8px;
      background-color: var(--main-surface-secondary);
      border: 1px solid var(--border-light);
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 1000;
      width: 200px;
      overflow: hidden;
      display: none; /* Initially hidden */
    }
    #export-menu-dropdown.show {
      display: block;
    }
    .export-menu-content {
      display: flex;
      flex-direction: column;
      gap: 0.25rem; /* Adds space between items */
      padding: 0.5rem; /* Adds margin-like space around items */
    }
    .export-menu-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      color: var(--text-primary);
      cursor: pointer;
      background-color: var(--main-surface-tertiary);
      border: none;
      width: 100%;
      text-align: left;
      border-radius: 0.375rem; /* Rounds the corners of the item */
      transition: background-color 0.2s; /* Smooth hover transition */
    }
    .export-menu-item:hover {
      /* A slightly different color for hover feedback */
      background-color: var(--main-surface-secondary);
    }
    .export-menu-item svg {
      width: 16px;
      height: 16px;
      color: var(--text-secondary);
    }
  `;
    document.head.appendChild(style);
  }

  /**
   * Creates and injects the "Export" button with a dropdown menu.
   */
  function addExportMenu() {
    // Check if we are in a conversation page
    const inConversation = window.location.pathname.startsWith("/c/");
    const existingContainer = document.getElementById("export-menu-container");

    if (!inConversation) {
      if (existingContainer) existingContainer.style.display = "none";
      return;
    }

    if (existingContainer) {
      existingContainer.style.display = "";
      return;
    }

    const targetContainer = document.querySelector(
      "#conversation-header-actions"
    );
    if (!targetContainer) return;

    // Main container
    const menuContainer = document.createElement("div");
    menuContainer.id = "export-menu-container";
    menuContainer.className = "relative";

    // Export Button
    const button = document.createElement("button");
    button.id = "export-menu-btn";
    button.className = "btn relative btn-ghost text-token-text-primary";
    button.innerHTML = `
      <div class="flex w-full items-center justify-center gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        Export
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    `;

    // Dropdown Menu
    const dropdown = document.createElement("div");
    dropdown.id = "export-menu-dropdown";
    dropdown.innerHTML = `
  <div class="export-menu-content">
    <button class="export-menu-item" id="print-chat-item">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer-icon lucide-printer"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>
      <span>Print Chat</span>
    </button>
    <button class="export-menu-item" id="export-md-item">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
      <span>Export Markdown</span>
    </button>
  </div>
`;

    menuContainer.appendChild(button);
    menuContainer.appendChild(dropdown);

    // Add event listeners
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("show");
    });

    dropdown.querySelector("#print-chat-item").addEventListener("click", () => {
      triggerPrint();
      dropdown.classList.remove("show");
    });

    dropdown.querySelector("#export-md-item").addEventListener("click", () => {
      exportCurrentConversation();
      dropdown.classList.remove("show");
    });

    // Hide dropdown when clicking elsewhere
    document.addEventListener("click", () => {
      if (dropdown.classList.contains("show")) {
        dropdown.classList.remove("show");
      }
    });

    if (targetContainer.lastChild) {
      targetContainer.insertBefore(menuContainer, targetContainer.lastChild);
    } else {
      targetContainer.appendChild(menuContainer);
    }
  }

  // Override Ctrl+P to use custom print function
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "p") {
      event.preventDefault();
      triggerPrint();
    }
  });

  // --- SCRIPT INITIALIZATION AND NAVIGATION HANDLING ---
  function initialize() {
    injectStyles();
    addExportMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }

  // Use a MutationObserver to re-add the button when navigating between chats
  const observer = new MutationObserver(() => {
    // A short timeout helps ensure the header is fully rendered after navigation
    setTimeout(addExportMenu, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log("✅ [ChatGPT Exporter] Script loaded successfully.");
})();
