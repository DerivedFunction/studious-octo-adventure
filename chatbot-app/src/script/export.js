(() => {
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
      console.error("❌ [Export MD] Could not retrieve access token:", error);
      accessToken = null;
      return null;
    }
  }
  /**
   * Extracts conversation ID from the current URL
   * @returns {string|null} The conversation ID or null if not found
   */

  function getConversationId() {
    return window.location.pathname.split("/")[2];
  }
  /**
   * Formats timestamp to readable string
   * @param {number} timestamp Unix timestamp
   * @returns {string} Formatted date string
   */

  function formatTimestamp(timestamp) {
    if (!timestamp) return "";
    return new Date(timestamp * 1000).toLocaleString();
  }
  /**
   * Converts text content to markdown format
   * @param {string} text The text to convert
   * @returns {string} Markdown formatted text
   */

  function textToMarkdown(text) {
    if (!text) return ""; // Basic markdown conversion

    return text
      .replace(/\*\*(.*?)\*\*/g, "**$1**") // Bold
      .replace(/\*(.*?)\*/g, "*$1*") // Italic
      .replace(/```([\s\S]*?)```/g, "```\n$1\n```") // Code blocks
      .replace(/`([^`]+)`/g, "`$1`") // Inline code
      .trim();
  }
  /**
   * Processes canvas content and formats it for markdown
   * @param {Array} canvases Array of canvas objects
   * @returns {string} Formatted canvas content
   */

  function formatCanvasContent(canvases) {
    if (!canvases || canvases.length === 0) return "";

    let canvasMarkdown = "\n\n---\n\n### Canvas Files\n\n";

    canvases.forEach((canvas, index) => {
      canvasMarkdown += `#### ${canvas.title}\n\n`;
      canvasMarkdown += `\`\`\`\n${canvas.content}\n\`\`\`\n\n`;
    });

    return canvasMarkdown;
  }
  /**
   * Extracts and processes conversation data from ChatGPT API
   * @param {string} conversationId The conversation ID
   * @returns {Promise<string>} Markdown formatted conversation
   */

  async function exportConversationToMarkdown(conversationId) {
    const signal = AbortController ? new AbortController().signal : undefined;

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
      const latestCanvasData = new Map(); // Pass 1: Collect all canvas versions to find the latest for each.

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
                  const contentNode = JSON.parse(node.message.content.parts[0]); // Find the final assistant message this canvas belongs to.

                  // ✅ Extract the file type here
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
                    const existing = latestCanvasData.get(textdoc_id);
                    if (existing) title = existing.title; // Carry over title
                  }

                  if (attachToMessageId) {
                    const existing = latestCanvasData.get(textdoc_id);
                    if (!existing || existing.version < version) {
                      latestCanvasData.set(textdoc_id, {
                        version,
                        title,
                        content, // Store the full content
                        attachToMessageId,
                      });
                    }
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
      } // Pass 2: Populate the final map with the latest canvas content.

      latestCanvasData.forEach((data, textdoc_id) => {
        const attachToMessageId = data.attachToMessageId;
        const existing = additionalDataMap.get(attachToMessageId) || {};
        const existingCanvases = existing.canvases || [];

        additionalDataMap.set(attachToMessageId, {
          ...existing,
          canvases: [
            ...existingCanvases,
            {
              title: data.title,
              content: data.content,
              textdoc_id,
              version: data.version,
            },
          ],
        });
      }); // Build the conversation tree and generate markdown

      let markdown = ""; // Add conversation metadata

      if (conversationApiData.title) {
        markdown += `# ${conversationApiData.title}\n\n`;
      }

      if (conversationApiData.create_time) {
        markdown += `**Created:** ${formatTimestamp(
          conversationApiData.create_time
        )}\n`;
      }

      if (conversationApiData.update_time) {
        markdown += `**Updated:** ${formatTimestamp(
          conversationApiData.update_time
        )}\n\n`;
      }

      markdown += "---\n\n"; // Process messages in order

      const processedMessages = new Set();

      function processMessage(messageId) {
        if (!messageId || processedMessages.has(messageId)) return;

        const node = conversationApiData.mapping[messageId];
        if (!node?.message) return;

        const message = node.message;
        const author = message.author?.role; // Skip system messages, tool messages, and hidden messages

        if (
          author === "system" ||
          author === "tool" ||
          message.metadata?.is_visually_hidden_from_conversation ||
          message.content?.content_type === "model_editable_context" ||
          (message.content?.content_type === "code" &&
            message.recipient === "web")
        ) {
          processedMessages.add(messageId);
          return;
        }

        processedMessages.add(messageId); // Add user messages

        if (author === "user") {
          if (message.content?.parts && message.content.parts.length > 0) {
            const content = message.content.parts.join("\n");
            if (content.trim()) {
              markdown += `---\n---\n\n## You Said\n\n${textToMarkdown(
                content
              )}\n\n`;
            }
          }
        } // Add assistant messages

        if (author === "assistant" && message.recipient === "all") {
          if (message.content?.parts && message.content.parts.length > 0) {
            let content = message.content.parts.join("\n");
            const references = message.metadata?.content_references;

            // Correctly replace citations using API metadata
            if (references && Array.isArray(references)) {
              references.forEach((ref) => {
                // Use the 'alt' property which contains the pre-formatted Markdown
                if (ref.matched_text && ref.alt) {
                  content = content.replace(ref.matched_text, ref.alt);
                }
              });
            }

            // Fallback to remove any unprocessed citation characters for clean output
            content = content.replace(/\uE200.*?\uE201/g, "").trim();

            if (content) {
              // Check trim() result to avoid empty blocks
              markdown += `---\n---\n\n## ChatGPT said\n\n${content}\n`; // Add canvas content if available

              const additionalData = additionalDataMap.get(messageId);
              if (additionalData?.canvases) {
                markdown += formatCanvasContent(additionalData.canvases);
              }

              markdown += "\n";
            }
          }
        }
      } // Start from root and traverse the conversation tree

      function traverseConversation(nodeId) {
        const node = conversationApiData.mapping[nodeId];
        if (!node) return;

        processMessage(nodeId); // Process children (follow the main conversation path)

        if (node.children && node.children.length > 0) {
          // For simplicity, follow the first child (main conversation path)
          traverseConversation(node.children[0]);
        }
      }

      if (conversationApiData.mapping["client-created-root"]) {
        traverseConversation("client-created-root");
      }

      return markdown;
    } catch (error) {
      console.error("❌ [Export MD] Export failed:", error);
      throw error;
    }
  }
  /**
   * Downloads the markdown content as a file
   * @param {string} content The markdown content
   * @param {string} filename The filename for the download
   */

  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: "text/markdown" });
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
   * Main export function
   */

  async function exportCurrentConversation() {
    try {
      const conversationId = getConversationId();
      if (!conversationId) {
        alert(
          "No conversation found. Please navigate to a ChatGPT conversation."
        );
        return;
      }

      console.log(
        "🚀 [Export MD] Starting export for conversation:",
        conversationId
      );

      const markdown = await exportConversationToMarkdown(conversationId);
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `chatgpt-conversation-${conversationId.substring(
        0,
        8
      )}-${timestamp}.md`;

      downloadMarkdown(markdown, filename);
      console.log("✅ [Export MD] Export completed successfully");
    } catch (error) {
      console.error("❌ [Export MD] Export failed:", error);
      alert("Export failed. Please check the console for details.");
    }
  } // Create export button and add to page

  // Create export button and add to page
  function addExportButton() {
    // Check if button already exists
    const btn = document.getElementById("markdown-export-btn");
    // Check if the button already exists
    if (btn) {
      if (!window.location.pathname.startsWith("/c/"))
        btn.style.display = "hidden";
      else btn.style.display = "";
      return;
    } else {
      if (!window.location.pathname.startsWith("/c/")) return;
    }

    // Find the target container for the new buttons in the conversation header
    const targetContainer = document.querySelector(
      "#conversation-header-actions"
    );
    if (!targetContainer) {
      // If the target isn't found, the page might not be ready.
      return;
    }

    const button = document.createElement("button");
    button.id = "markdown-export-btn";
    // Apply classes similar to the native 'Share' button for a consistent look
    button.className = "btn relative btn-ghost text-token-text-primary";

    // Create the inner content structure (icon + text) to match the UI
    const innerDiv = document.createElement("div");
    innerDiv.className = "flex w-full items-center justify-center gap-1.5";

    // SVG icon for 'Export'
    const svgIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    svgIcon.setAttribute("width", "16");
    svgIcon.setAttribute("height", "16");
    svgIcon.setAttribute("viewBox", "0 0 24 24");
    svgIcon.setAttribute("fill", "none");
    svgIcon.setAttribute("stroke", "currentColor");
    svgIcon.setAttribute("stroke-width", "2");
    svgIcon.setAttribute("stroke-linecap", "round");
    svgIcon.setAttribute("stroke-linejoin", "round");
    svgIcon.innerHTML = `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />`;
    svgIcon.classList.add("-ms-0.5", "icon");

    const buttonText = document.createTextNode("Export .md");

    innerDiv.appendChild(svgIcon);
    innerDiv.appendChild(buttonText);
    button.appendChild(innerDiv);

    button.addEventListener("click", exportCurrentConversation);

    // Insert the new button before the last element in the container (the '...' menu)
    if (targetContainer.lastChild) {
      targetContainer.insertBefore(button, targetContainer.lastChild);
    } else {
      targetContainer.appendChild(button);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addExportButton);
  } else {
    addExportButton();
  } // Also add button when navigating between conversations

  let currentUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
    }
    setTimeout(addExportButton, 1000);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log("✅ [Export MD] Content script loaded successfully");
})();
