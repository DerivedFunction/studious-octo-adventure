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
   * Fetches the public download URL for a given file ID.
   * @param {string} fileId The ID of the file (without 'sediment://').
   * @param {string} conversationId The current conversation ID.
   * @returns {Promise<string|null>} The download URL or null on failure.
   */
  async function getImageDownloadUrl(fileId, conversationId) {
    try {
      const token = await getAccessToken();
      if (!token)
        throw new Error("Access token not available for image download.");

      const response = await fetch(
        `https://chatgpt.com/backend-api/files/download/${fileId}?conversation_id=${conversationId}`,
        {
          headers: {
            accept: "*/*",
            authorization: `Bearer ${token}`,
          },
          method: "GET",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch image download URL: ${response.status}`
        );
      }

      const data = await response.json();
      return data.download_url;
    } catch (error) {
      console.error(
        "❌ [Export Script] Failed to get image download URL:",
        error
      );
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
   * @returns {Promise<Map>} Map of textdoc_id to an array of chronological canvas content versions
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
      const allCanvasOps = [];

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
                    textdoc_type,
                  } = toolNode.message.metadata.canvas;
                  const contentNode = JSON.parse(node.message.content.parts[0]);
                  let content =
                    contentNode.content ||
                    contentNode.updates?.[0]?.replacement ||
                    "";

                  allCanvasOps.push({
                    create_time: toolNode.message.create_time,
                    textdoc_id,
                    version,
                    title: canvasTitle || contentNode.name || "Canvas",
                    content,
                    type: textdoc_type,
                  });
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

      // Sort all operations chronologically
      allCanvasOps.sort((a, b) => a.create_time - b.create_time);

      // Group the sorted operations by textdoc_id
      allCanvasOps.forEach((op) => {
        if (!canvasMap.has(op.textdoc_id)) {
          canvasMap.set(op.textdoc_id, []);
        }
        canvasMap.get(op.textdoc_id).push({
          title: op.title,
          content: op.content,
          type: op.type,
        });
      });
    } catch (error) {
      console.error("❌ [Print Script] Failed to fetch canvas content:", error);
    }
    return canvasMap;
  }

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
    let buttonsClicked = [];
    printArea
      .querySelectorAll("div.origin-top-left button:not(pre button) span span")
      .forEach((el) => {
        // find the nearest ancestor div.grow (or whatever parent you need)
        const parent = el.closest("div.origin-top-left");
        if (parent && parent.children.length !== 2) {
          el.closest("button").click();
          buttonsClicked.push(el.closest("button"));
        }
      });
    if (conversationId) {
      console.log("🚀 [Print Script] Fetching canvas content...");
      canvasMap = await fetchCanvasContentForPrint(conversationId);
      console.log(
        `✅ [Print Script] Fetched ${canvasMap.size} canvas documents`
      );
    } // 2. Create a hidden iframe to build the print content in isolation.

    const printFrame = document.createElement("iframe");
    printFrame.style.position = "absolute";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    document.body.appendChild(printFrame);

    const printDocument = printFrame.contentWindow.document; // 3. Clone all stylesheet links from the original page into the iframe.

    document
      .querySelectorAll('link[rel="stylesheet"], style')
      .forEach((styleElement) => {
        printDocument.head.appendChild(styleElement.cloneNode(true));
      }); // 4. Add comprehensive print-only stylesheet to override dark mode and adjust layout.
    const printStyles = `
    @media print {
      /* Force light mode for all elements */
      *, *::before, *::after {
        box-shadow: none !important;
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
      }

      /* Add page margins for proper printing */
      @page {
        margin: 0.25in;
        size: letter;
      }

      /* Format code blocks with light background and proper contrast */
      pre, code {
        white-space: pre-wrap !important;
        word-break: break-word !important;
        page-break-inside: avoid;
      }


      /* Ensure links are visible */
      a {
        text-decoration: underline !important;
      }

      /* Style headings */
      h1, h2, h3, h4, h5, h6 {
        page-break-after: avoid;
      }

      /* Ensure tables are readable */
      table, th, td {
        border: 1px solid #333 !important;
        border-collapse: collapse !important;
        page-break-inside: avoid !important;
      }

      th {
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
        max-width: 150px !important;
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
        border: 0px !important;
        border-radius: 18px !important;
        padding: 12px 16px !important;
        margin: 4px 0 !important;
      }

      /* Canvas content styling */
      .canvas-content {
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
    }
  `;

    const styleSheet = printDocument.createElement("style");
    styleSheet.textContent = printStyles;
    printDocument.head.appendChild(styleSheet); // 5. Clone the content into the iframe's body.
    const contentToPrint = printArea.cloneNode(true);
    contentToPrint.classList.add("print-content");
    printDocument.body.appendChild(contentToPrint);
    printDocument.querySelectorAll("*").forEach((el) => {
      el.classList.remove("dark");
      el.classList.add("light");
    }); // Handle canvas textdoc content
    const canvasUsageCounters = new Map();
    printDocument.querySelectorAll(".popover").forEach((codeEl) => {
      // Clear inline height
      codeEl.style.height = ""; // Extract textdoc ID from the element's ID attribute

      const elementId = codeEl.id;
      if (elementId && elementId.startsWith("textdoc-message-")) {
        const textdocId = elementId.replace("textdoc-message-", "");

        if (canvasMap.has(textdocId)) {
          const versions = canvasMap.get(textdocId);
          const usageIndex = canvasUsageCounters.get(textdocId) || 0;

          if (versions && versions[usageIndex]) {
            const canvasData = versions[usageIndex]; // Clear existing content and add canvas data

            codeEl.innerHTML = "";
            codeEl.className = "canvas-content"; // Add title if available

            if (canvasData.title) {
              const titleEl = printDocument.createElement("div");
              titleEl.className = "canvas-title";
              titleEl.textContent = `${canvasData.title}`;
              codeEl.appendChild(titleEl);
            } // Add content

            const contentEl = printDocument.createElement("div");
            const pre = printDocument.createElement("pre");
            const code = printDocument.createElement("code");
            code.className = `language-${canvasData.type.split("/")[1]}`;
            code.textContent = canvasData.content;
            pre.appendChild(code);
            contentEl.appendChild(pre);
            codeEl.appendChild(contentEl);

            console.log(
              `✅ [Print Script] Populated canvas content for ${textdocId}`
            );
          } else {
            // Fallback for canvas elements without content
            codeEl.textContent =
              "[Canvas content - please use Export MD for full content]";
            console.warn(
              `⚠️ [Print Script] Canvas content not found for ${textdocId} at index ${usageIndex}`
            );
          }
          canvasUsageCounters.set(textdocId, usageIndex + 1);
        } else {
          // Fallback for canvas elements without content
          codeEl.textContent =
            "[Canvas content - please use Export MD for full content]";
          console.warn(
            `⚠️ [Print Script] Canvas content not found for ${textdocId}`
          );
        }
      }
    }); // 6. Fix code blocks inside articles and add user message borders.
    const articles = printDocument.querySelectorAll("article");
    articles.forEach((article) => {
      const content = article.querySelector("[tabindex]");
      if (!content) return; // Clean up classes that might interfere with printing

      content.className = "print-article-content";

      const codeBlocks = content.querySelectorAll("code, pre");
      codeBlocks.forEach((codeEl) => {
        // Skip canvas elements (they're handled separately)
        if (codeEl.classList.contains("canvas-content")) return; // Ensure proper styling for code blocks

        if (codeEl.parentElement) {
          codeEl.parentElement.className = "code-container";
        } // Apply print-friendly code styling

        codeEl.style.whiteSpace = "pre-wrap";
        codeEl.style.wordBreak = "break-word";
        codeEl.style.fontSize = "12px";
        codeEl.style.lineHeight = "1.4"; // Handle nested elements in code blocks

        const codeChildren = codeEl.querySelectorAll("*");
        codeChildren.forEach((child) => {
          child.style.whiteSpace = "pre-wrap";
          child.style.wordBreak = "break-word";
        });
      }); // Fix table formatting

      const tables = content.querySelectorAll("table");
      tables.forEach((table) => {
        table.style.width = "100%";
        table.style.tableLayout = "fixed";
        table.style.borderCollapse = "collapse";
        table.style.margin = "8px 0"; // Fix table cells

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
    }); // 7. Wait for styles to load, then trigger print and cleanup

    setTimeout(() => {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print(); // Clean up after a delay to ensure print dialog has appeared

      setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame); // Unclick the clicked buttons
          buttonsClicked.forEach((button) => {
            button.click();
          });
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
   * Extracts and processes conversation data from ChatGPT API
   * @param {string} conversationId The conversation ID
   * @returns {Promise<string>} Markdown formatted conversation
   */
  let title = null;
  async function exportConversationToFileType(
    conversationId,
    filetype = "markdown",
    version = 1
  ) {
    const signal = AbortController ? new AbortController().signal : undefined;
    title = null;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Access token not available.");

      const response = await fetch(
        `https://chatgpt.com/backend-api/conversation/${conversationId}`,
        {
          headers: {
            accept: "*/*",
            authorization: `Bearer ${token}`,
          },
          method: "GET",
          signal,
        }
      );

      if (!response.ok) {
        throw new Error(
          `Backend API request failed with status: ${response.status}`
        );
      }

      const conversationApiData = await response.json();
      const additionalDataMap = new Map();

      if (conversationApiData && conversationApiData.mapping) {
        for (const messageId in conversationApiData.mapping) {
          const node = conversationApiData.mapping[messageId];
          const recipient = node.message?.recipient; // Look for assistant messages that create or update canvases ('textdoc').

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
                  const contentNode = JSON.parse(node.message.content.parts[0]); // Find the final assistant message this canvas belongs to. // ✅ Extract the file type here

                  let type = contentNode.type.split("/")[1] || null;

                  let attachToMessageId = null;
                  let currentNodeId = toolNode.id;
                  let currentNode = toolNode;
                  while (
                    currentNode &&
                    currentNode.children &&
                    currentNode.children.length > 0
                  ) {
                    currentNodeId = currentNode.children[0];
                    currentNode = conversationApiData.mapping[currentNodeId];
                    if (
                      currentNode?.message?.author?.role === "assistant" &&
                      currentNode?.message?.recipient === "all"
                    ) {
                      break; // Found the final response to the user.
                    }
                  }
                  attachToMessageId = currentNodeId; // Extract title and content from the JSON structure

                  let title =
                    canvasTitle && type
                      ? `${canvasTitle}: ${type}`
                      : canvasTitle || contentNode.name || "Canvas";
                  let content = "";

                  if (contentNode.content) {
                    // Create operation
                    content = contentNode.content || "";
                  } else if (contentNode.updates && contentNode.updates[0]) {
                    // Update operation
                    content = contentNode.updates[0].replacement || "";
                  }

                  if (attachToMessageId) {
                    const canvasData = {
                      version,
                      title,
                      content,
                      textdoc_id,
                      type,
                    };

                    if (!additionalDataMap.has(attachToMessageId)) {
                      additionalDataMap.set(attachToMessageId, {
                        canvases: [],
                      });
                    }
                    additionalDataMap
                      .get(attachToMessageId)
                      .canvases.push(canvasData);
                  }
                } catch (e) {
                  console.error(
                    "❌ [Export MD] Error processing canvas data:",
                    e
                  );
                }
              }
            }
          }
        }
      }

      const reasoningData = new Map(); // Pass 1.5: Collect all reasoning data
      if (conversationApiData.mapping) {
        for (const messageId in conversationApiData.mapping) {
          const node = conversationApiData.mapping[messageId];
          if (node.message?.content?.content_type === "thoughts") {
            const request_id = node.message.metadata.request_id;
            try {
              // Find the final assistant message this reasoning belongs to.
              let attachToMessageId = null;
              for (const reasoningParentId in conversationApiData.mapping) {
                const currentNode =
                  conversationApiData.mapping[reasoningParentId];
                if (
                  currentNode?.message?.author?.role === "assistant" &&
                  currentNode?.message?.metadata.request_id === request_id &&
                  currentNode?.message?.channel === "final"
                ) {
                  attachToMessageId = reasoningParentId;
                  break; // Found the final response to the user.
                }
              }

              if (attachToMessageId) {
                const thoughts = node.message.content.thoughts;
                if (
                  thoughts &&
                  Array.isArray(thoughts) &&
                  thoughts.length > 0
                ) {
                  let reasoningMarkdown =
                    filetype === "json"
                      ? "<think>"
                      : "\n\n<details>\n<summary>View Reasoning</summary>\n\n";
                  thoughts.forEach((thought) => {
                    reasoningMarkdown += `**${thought.summary || "Step"}**\n\n${
                      thought.content
                    }${filetype === "json" ? "</think>" : "</details>\n\n"}`;
                  });
                  reasoningData.set(attachToMessageId, reasoningMarkdown);
                }
              }
            } catch (e) {
              console.error(
                "❌ [Export MD] Error processing reasoning data:",
                e
              );
            }
          }
        }
      }
      let fileContent = ""; // Add conversation metadata
      let jsonMetaData = {};
      if (conversationApiData.title) {
        switch (filetype) {
          case "json":
            jsonMetaData.title = conversationApiData.title;
            break;
          case "markdown":
          default:
            fileContent += `# ${conversationApiData.title}\n\n`;
        }
        title = conversationApiData.title;
      }

      if (conversationApiData.create_time) {
        switch (filetype) {
          case "json":
            jsonMetaData.create_time = formatTimestamp(
              conversationApiData.create_time
            );
            break;
          case "markdown":
          default:
            fileContent += `**Created:** ${formatTimestamp(
              conversationApiData.create_time
            )}\n\n`;
        }
      }

      if (conversationApiData.update_time) {
        switch (filetype) {
          case "json":
            jsonMetaData.update_time = formatTimestamp(
              conversationApiData.update_time
            );
            break;
          case "markdown":
          default:
            fileContent += `**Updated:** ${formatTimestamp(
              conversationApiData.update_time
            )}\n\n`;
        }
      }
      switch (filetype) {
        case "json":
          jsonMetaData.link = `https://chatgpt.com/c/${conversationId}`;
          break;
        case "markdown":
        default:
          fileContent += `**Link:** https://chatgpt.com/c/${conversationId}\n\n`;
          fileContent += "---\n\n"; // Process messages in order
      }

      const processedMessages = new Set();
      let messageData = [];
      async function processMessage(messageId) {
        if (!messageId || processedMessages.has(messageId)) return;

        const node = conversationApiData.mapping[messageId];
        if (!node?.message) return;

        const message = node.message;
        const author = message.author?.role;
        const contentType = message.content?.content_type; // Skip system messages, hidden messages, and intermediate steps. // Allow tool messages that contain images ('multimodal_text').

        if (
          author === "system" ||
          message.metadata?.is_visually_hidden_from_conversation ||
          contentType === "model_editable_context" ||
          (author === "assistant" && message.recipient !== "all") ||
          (author === "tool" && contentType !== "multimodal_text")
        ) {
          processedMessages.add(messageId);
          return;
        }

        processedMessages.add(messageId); // Add user messages

        if (author === "user") {
          if (message.content?.parts && message.content.parts.length > 0) {
            const content = message.content.parts.join("\n");
            if (content.trim()) {
              switch (filetype) {
                case "json":
                  messageData.push({
                    role: "user",
                    content: [
                      {
                        content_type: "input_text",
                        text: content,
                      },
                    ],
                  });
                  break;
                case "markdown":
                default:
                  fileContent += `# You Said\n\n${content}\n\n---\n\n`;
              }
            }
          }
        } // Add assistant messages

        if (author === "assistant" && message.recipient === "all") {
          if (message.content?.parts && message.content.parts.length > 0) {
            let content = message.content.parts.join("\n");
            const references = message.metadata?.content_references; // Correctly replace citations using API metadata

            if (references && Array.isArray(references)) {
              references.forEach((ref) => {
                // Use the 'alt' property which contains the pre-formatted Markdown
                if (ref.matched_text && ref.alt) {
                  content = content.replace(ref.matched_text, ref.alt);
                }
              });
            } // Fallback to remove any unprocessed citation characters for clean output

            content = content.replace(/\uE200.*?\uE201/g, "").trim();

            if (content) {
              let fullAssistantContent = ""; // Add canvas content if available
              const additionalData = additionalDataMap.get(messageId);
              if (additionalData?.canvases) {
                fullAssistantContent += formatCanvasContent(
                  additionalData.canvases
                );
              } // Append reasoning information if it exists
              const reasoningContent = reasoningData.get(messageId);
              if (reasoningContent) {
                fullAssistantContent += reasoningContent;
              }
              fullAssistantContent += content;
              const openings = (fullAssistantContent.match(/```/g) || [])
                .length;
              if (
                openings % 2 !== 0 &&
                !fullAssistantContent.trim().endsWith("```")
              ) {
                fullAssistantContent += "\n```";
              }
              switch (filetype) {
                case "json":
                  messageData.push({
                    role: "assistant",
                    content: [
                      {
                        content_type: "output_text",
                        text: fullAssistantContent,
                      },
                    ],
                  });
                  break;
                case "markdown":
                default: {
                  fileContent += `# ChatGPT said\n\n${fullAssistantContent}\n\n---\n\n`;
                  break;
                }
              }
            }
          }
        } // Handle multimodal messages (e.g., images) from the tool role
        if (author === "tool" && contentType === "multimodal_text") {
          let markdownContent = "";
          let jsonParts = [];

          for (const part of message.content.parts) {
            if (
              part.content_type === "image_asset_pointer" &&
              part.asset_pointer
            ) {
              const fileId = part.asset_pointer.replace("sediment://", "");
              const conversationId = getConversationId(); // Find the image prompt by traversing up the conversation tree

              let prompt = "Image"; // Default prompt
              try {
                const parentNode = conversationApiData.mapping[node.parent];
                const grandparentNode = parentNode
                  ? conversationApiData.mapping[parentNode.parent]
                  : null;
                if (
                  grandparentNode &&
                  grandparentNode.message?.content?.content_type === "code"
                ) {
                  const promptData = JSON.parse(
                    grandparentNode.message.content.text
                  );
                  prompt = promptData.prompt || "Image";
                }
              } catch (e) {
                console.warn("Could not parse image prompt, using default.", e);
              }

              const downloadUrl = await getImageDownloadUrl(
                fileId,
                conversationId
              );

              if (downloadUrl) {
                switch (filetype) {
                  case "json":
                    jsonParts.push([
                      {
                        content_type: "output_image",
                        url: downloadUrl,
                      },
                      { content_type: "output_text", text: prompt },
                    ]);
                    break;
                  case "markdown":
                  default:
                    markdownContent += `![${prompt}](${downloadUrl})\n\n**Prompt:** *${prompt}*\n\n`;
                    break;
                }
              }
            }
          } // Add the processed content to the final output

          if (filetype === "json" && jsonParts.length > 0) {
            messageData.push({
              role: "assistant", // Attribute the image to the assistant
              content: jsonParts.length === 1 ? jsonParts[0] : jsonParts,
            });
          } else if (filetype === "markdown" && markdownContent.trim()) {
            fileContent += `# ChatGPT said\n\n${markdownContent}\n\n---\n\n`;
          }
        }
      }

      async function traverseConversation(nodeId) {
        const node = conversationApiData.mapping[nodeId];
        if (!node) return;

        await processMessage(nodeId);

        if (node.children && node.children.length > 0) {
          await traverseConversation(node.children[0]);
        }
      }

      if (conversationApiData.mapping["client-created-root"]) {
        await traverseConversation("client-created-root");
      }
      switch (filetype) {
        case "json":
          switch (version) {
            case 2: // We want chat completions, so { "role": "role", "content": "text"}
              messageData.forEach((message) => {
                // for each message.content, only if content_type = "text" , set content to "text"
                let content = "";
                message.content.forEach((part) => {
                  const type = part.content_type.split("_")[1] || "";
                  switch (type) {
                    case "image":
                      content = `${
                        content ? `${content}\n` : ""
                      }${`![Image](${part.url})`}`;
                      break;
                    case "text":
                    default:
                      content = `${content ? `${content}\n` : ""}${part.text}`;
                      break;
                  }
                });
                message.content = content;
              });
              jsonMetaData.messages = messageData;
              break;
            case 1:
            default:
              jsonMetaData.messages = messageData;
              break;
          }
          fileContent = JSON.stringify({ ...jsonMetaData }, null, 2);
          break;
        default:
          break;
      }
      return fileContent;
    } catch (error) {
      console.error("❌ [Export MD] Export failed:", error);
      throw error;
    }
  }
  function formatCanvasContent(canvases) {
    if (!canvases || canvases.length === 0) return "";

    let canvasMarkdown = "";

    canvases.forEach((canvas, index) => {
      canvasMarkdown += `#### ${canvas.title}\n\n`;
      canvasMarkdown += `\`\`\`\n${canvas.content}\n\`\`\`\n\n`;
    });

    return canvasMarkdown;
  }

  /**
   * Downloads the markdown content as a file.
   */
  function downloadFile(content, filename, filetype = "markdown") {
    const blob = new Blob([content], {
      type: filetype === "json" ? "application/json" : "text/markdown",
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
  async function exportCurrentConversation(
    filetype = "markdown",
    extension = "md",
    version = 1
  ) {
    try {
      const conversationId = getConversationId();
      if (!conversationId) {
        alert("No conversation found.");
        return;
      }
      const content = await exportConversationToFileType(
        conversationId,
        filetype,
        version
      );
      const filename = `ChatGPT-${title || conversationId}.${extension}`;
      downloadFile(content, filename, filetype);
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
      margin-top: 6px;
      background-color: var(--main-surface-secondary);
      border: 1px solid var(--border-light);
      border-radius: 0.75rem;
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
      background-color: var(--main-surface-secondary);
      border: none;
      width: 100%;
      text-align: left;
      border-radius: 0.75rem; /* Rounds the corners of the item */
      transition: background-color 0.2s; /* Smooth hover transition */
    }
    .export-menu-item:hover {
      /* A slightly different color for hover feedback */
      background-color: var(--main-surface-tertiary);
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
        <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        Export
        <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    `;

    // Dropdown Menu
    const dropdown = document.createElement("div");
    dropdown.id = "export-menu-dropdown";
    dropdown.innerHTML = `
  <div class="export-menu-content">
    <button class="export-menu-item" id="print-chat-item">
      <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer-icon lucide-printer"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>
      <span>Print Chat</span>
    </button>
    <button class="export-menu-item" id="export-md-item">
      <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
      <span>Markdown</span>
    </button>
    <button class="export-menu-item" id="export-json-item">
      <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-braces-icon lucide-braces"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>
      <span>Input JSON</span>
    </button>
    <button class="export-menu-item" id="export-json-chat-item">
      <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-braces-icon lucide-braces"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>
      <span>Output JSON</span>
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
    dropdown
      .querySelector("#export-json-chat-item")
      .addEventListener("click", () => {
        exportCurrentConversation("json", "json");
        dropdown.classList.remove("show");
      });
    dropdown
      .querySelector("#export-json-item")
      .addEventListener("click", () => {
        exportCurrentConversation("json", "json", 2);
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
