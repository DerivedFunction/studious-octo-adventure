window.ChatGPT = (() => {
  let accessToken = null;

  // Cache configuration
  const CACHE_DURATION = 15 * 1000; // 15 seconds in milliseconds
  const lastFetch = new Map(); // Changed from Set to Map for better data structure

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
        "❌ [API Manager] Failed to get image download URL:",
        error
      );
      return null;
    }
  }

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
      console.error("❌ [API Manager] Could not retrieve access token:", error);
      accessToken = null;
      return null;
    }
  }

  let conversationId;
  /**
   * Extracts conversation ID from the current URL.
   * @returns {string|null} The conversation ID or null if not found.
   */
  function getConversationId() {
    conversationId = window.location.href.split("/c/")[1];
    return conversationId;
  }

  let apiData = null;

  /**
   * Checks if cached data is still valid
   * @param {string} convId - Conversation ID
   * @returns {boolean} - Whether cache is valid
   */
  function isCacheValid(convId) {
    const cached = lastFetch.get(convId);
    if (!cached) return false;

    const now = Date.now();
    const cacheAge = now - cached.timestamp;
    const isValid = cacheAge < CACHE_DURATION;

    if (!isValid) {
      console.log(
        `[API Manager] Cache expired for conversation ${convId} (age: ${Math.round(
          cacheAge / 1000
        )}s)`
      );
    } else {
      console.log(
        `[API Manager] Using cached data for conversation ${convId} (age: ${Math.round(
          cacheAge / 1000
        )}s)`
      );
    }

    return isValid;
  }

  /**
   * Stores data in cache
   * @param {string} convId - Conversation ID
   * @param {Object} data - Data to cache
   */
  function setCacheData(convId, data) {
    lastFetch.set(convId, {
      timestamp: Date.now(),
      data: data,
    });
    console.log(`[API Manager] Cached data for conversation ${convId}`);
  }

  /**
   * Gets data from cache
   * @param {string} convId - Conversation ID
   * @returns {Object|null} - Cached data or null
   */
  function getCacheData(convId) {
    const cached = lastFetch.get(convId);
    return cached ? cached.data : null;
  }

  /**
   * Clears expired cache entries
   */
  function clearExpiredCache() {
    const now = Date.now();
    const toDelete = [];

    for (const [convId, cached] of lastFetch.entries()) {
      const cacheAge = now - cached.timestamp;
      if (cacheAge >= CACHE_DURATION) {
        toDelete.push(convId);
      }
    }

    toDelete.forEach((convId) => {
      lastFetch.delete(convId);
      console.log(
        `[API Manager] Removed expired cache for conversation ${convId}`
      );
    });

    if (toDelete.length > 0) {
      console.log(
        `[API Manager] Cleared ${toDelete.length} expired cache entries`
      );
    }
  }

  /**
   * Fetchs data from backend-api with caching support
   * @param {string} id conversation id or current conversation
   * @param {boolean} useCache whether to use cached data
   * @param {boolean} forceRefresh whether to force refresh even if cache is valid
   * @returns {Promise<Object>} API data
   */
  async function getApiData(id = null, useCache = true, forceRefresh = false) {
    const convId = id || getConversationId();
    if (!convId) {
      console.error("[API Manager] No conversation ID available");
      return null;
    }

    // Clear expired cache entries periodically
    clearExpiredCache();

    // Check cache first if enabled and not forcing refresh
    if (useCache && !forceRefresh && isCacheValid(convId)) {
      const cachedData = getCacheData(convId);
      if (cachedData) {
        apiData = cachedData;
        return apiData;
      }
    }

    if (forceRefresh) {
      console.log(
        `[API Manager] Force refreshing data for conversation ${convId}`
      );
    } else {
      console.log(
        `[API Manager] Fetching fresh data for conversation ${convId}`
      );
    }

    const signal = AbortController ? new AbortController().signal : undefined;
    await getAccessToken();

    if (!accessToken) throw new Error("Access token not available.");

    console.log("[API Manager] Fetching API data from server...");
    const response = await fetch(
      `https://chatgpt.com/backend-api/conversation/${convId}`,
      {
        headers: {
          accept: "*/*",
          authorization: `Bearer ${accessToken}`,
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

    // Correctly find all messages, canvases, and images for each turn.
    const visibleTurnIds = [];
    document.querySelectorAll("[data-turn-id]").forEach((e) => {
      const turnId = e.getAttribute("data-turn-id");
      visibleTurnIds.push(turnId);
    });

    const messageMapData = new Map();
    const visibleMessageIds = [];
    processAllMessages();
    function processAllMessages() {
      document.querySelectorAll("[data-message-id]").forEach((e) => {
        const turnId = e.closest("article")?.getAttribute("data-turn-id");
        const messageId = e.getAttribute("data-message-id");
        visibleMessageIds.push({
          turnId,
          messageId,
        });
      });
      visibleMessageIds.forEach(async (turn) => {
        try {
          const messageId = turn.messageId;
          const turnId = turn.turnId;
          const node = conversationApiData.mapping[messageId];
          const message = node?.message;
          const content = node?.message?.content;
          const role = message?.author?.role;
          const parts = content?.parts;
          let text = parts?.join("\n");
          const content_references = message?.metadata?.content_references;
          const references = [];
          const urlMap = new Map(); // url -> id

          // Correctly replace citations using API metadata
          if (content_references && Array.isArray(content_references)) {
            content_references.forEach((ref) => {
              if (ref.matched_text && ref.alt) {
                text = text.replace(ref.matched_text, ref.alt);
              }
            });
          }
          // Fallback to remove any unprocessed citation characters
          text = text.replace(/\uE200.*?\uE201/g, "").trim();
          let id = 1;
          // Replace markdown links with reference-style links
          text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
            let refId;
            if (urlMap.has(url)) {
              // Reuse existing id
              refId = urlMap.get(url);
            } else {
              // Assign new id
              refId = id++;
              urlMap.set(url, refId);
              references.push({
                id: refId,
                url,
              });
            }
            return `[${label}][${refId}]`;
          });

          const messageData = {
            messageId,
            role,
            text,
            references,
          };
          pushMapData(turnId, messageMapData, messageData);
        } catch (e) {
          console.error("❌ [Export MD] Error processing message data:", e);
        }
      });
    }
    function getTurnId(id) {
      let turn;
      try {
        for (const { turnId, messageId } of visibleMessageIds) {
          // see if the messageId is in the array
          if (messageId === id) {
            turn = turnId;
            break;
          }
        }
      } catch (e) {
        console.error("❌ [Export MD] Error getting turnId:", e);
      }
      return turn;
    }

    const imageMapData = new Map();
    const visibleImageIds = [];
    await processAllImages();
    async function processAllImages() {
      document.querySelectorAll("article div[id^='image-']").forEach((e) => {
        visibleImageIds.push({
          turnId: e.closest("article").getAttribute("data-turn-id"),
          imageId: e.getAttribute("id").replace("image-", ""),
        });
      });
      await Promise.all(
        visibleImageIds.map(async (turn) => {
          try {
            const imageId = turn.imageId;
            const turnId = turn.turnId;
            const node = conversationApiData.mapping[imageId];
            const message = node?.message;
            const content = message?.content;
            const image_gen_title = message?.metadata?.image_gen_title;
            const fileId = content?.parts[0]?.asset_pointer.replace(
              "sediment://",
              ""
            );
            const downloadURL = await getImageDownloadUrl(
              fileId,
              conversationId
            );
            const imageData = {
              url: downloadURL,
              imageId: turnId,
              prompt: image_gen_title,
            };
            pushMapData(turnId, imageMapData, imageData);
          } catch (e) {
            console.error("❌ [Export MD] Error processing image data:", e);
          }
        })
      );
    }

    const canvasMapData = new Map();
    processAllCanvas();
    function processAllCanvas() {
      const allCanvasOps = [];
      // Pass 1: Collect all canvas operations
      for (const turnId in conversationApiData.mapping) {
        try {
          const node = conversationApiData.mapping[turnId];
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
                allCanvasOps.push({
                  node,
                  toolNode,
                });
              }
            }
          }
        } catch (e) {
          console.error("❌ [Export MD] Error processing canvas data.", e);
        }
      }

      // Sort operations by their creation time to ensure logical order
      allCanvasOps.sort(
        (a, b) =>
          a.toolNode.message.create_time - b.toolNode.message.create_time
      );

      // Pass 2: Process sorted canvas operations to build the data map
      const canvasTitles = new Map();
      const canvasTypes = new Map();
      for (const { node, toolNode } of allCanvasOps) {
        try {
          const {
            textdoc_id,
            version,
            title: canvasTitle,
            textdoc_type,
            is_failure,
          } = toolNode.message.metadata.canvas;
          if (is_failure) continue;
          const jsonString =
            node.message.content.parts?.[0] || node.message.content?.text;
          if (!jsonString) {
            console.warn(
              `[Export MD] No canvas content found for message ID: ${node.id}`
            );
            continue;
          }
          const contentNode = JSON.parse(jsonString);
          // Find the final assistant message this canvas belongs to.
          let messageId = null;
          let currentNodeId = toolNode.id;
          let currentNode = toolNode;
          while (
            currentNode &&
            currentNode.children &&
            currentNode.children.length > 0
          ) {
            try {
              currentNodeId = currentNode.children[0];
              currentNode = conversationApiData.mapping[currentNodeId];
              if (
                currentNode?.message?.author?.role === "assistant" &&
                currentNode?.message?.recipient === "all"
              ) {
                break; // Found the final response to the user.
              }
            } catch (e) {
              console.error(
                "❌ [Export MD] Error processing canvas data in loop:",
                e
              );
            }
          }
          messageId = currentNodeId;

          try {
            let currentType = textdoc_type || canvasTypes.get(textdoc_id);
            if (currentType) {
              canvasTypes.set(textdoc_id, currentType);
            }
            // Correctly track and carry over titles for updated canvases
            let currentTitle = canvasTitle || canvasTitles.get(textdoc_id);
            if (currentTitle) {
              canvasTitles.set(textdoc_id, currentTitle);
            } else {
              currentTitle = contentNode.name || currentType;
            }
            const title = currentTitle;
            const content =
              contentNode.content ||
              contentNode.updates?.[0]?.replacement ||
              "";

            if (messageId) {
              const canvasData = {
                version,
                title,
                content,
                textdoc_id,
                type: textdoc_type,
              };
              let turnId = getTurnId(messageId);
              pushMapData(turnId, canvasMapData, canvasData);
            }
          } catch (e) {
            console.error("❌ [Export MD] Error processing canvas data:", e);
          }
        } catch (e) {
          console.error("❌ [Export MD] Error processing canvas data:", e);
        }
      }
    }
    const reasoningMapData = new Map(); // Pass 1.5: Collect all reasoning data
    processAllReasoning();
    function processAllReasoning() {
      if (conversationApiData.mapping) {
        for (const turnId in conversationApiData.mapping) {
          const node = conversationApiData.mapping[turnId];
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
                  let turnID = getTurnId(attachToMessageId);
                  const reasonData = {
                    messageId: attachToMessageId,
                    thoughts: thoughts,
                  };
                  pushMapData(turnID, reasoningMapData, reasonData);
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
    }

    const turnMapData = new Map();
    processedAllTurns();
    function processedAllTurns() {
      // Now let's map messageMapData, imageMapData, and canvasMapData
      visibleTurnIds.forEach((turnId) => {
        const messages = messageMapData.get(turnId);
        const images = imageMapData.get(turnId);
        const canvases = canvasMapData.get(turnId);
        const reasoning = reasoningMapData.get(turnId);
        const turnData = {
          messages,
          images,
          canvases,
          reasoning,
        };
        turnMapData.set(turnId, turnData);
      });
    }

    let userProfile = {};
    processUserProfile();
    function processUserProfile() {
      for (const turnId in conversationApiData.mapping) {
        try {
          const node = conversationApiData.mapping[turnId];
          const message = node?.message;
          const content = message?.content;
          if (!content) continue;
          const { content_type, user_profile, user_instructions } = content;
          if (content_type === "user_editable_context") {
            userProfile = { user_profile, user_instructions };
            break;
          }
        } catch (e) {
          console.error("[API Mananger] Error processing user data", e);
        }
      }
    }

    const toolMapData = new Map();
    processToolData();
    function processToolData() {
      for (const turnId in conversationApiData.mapping) {
        try {
          const node = conversationApiData.mapping[turnId];
          const message = node?.message;
          if (!message) continue;
          const { content, author, metadata } = message;
          const { content_type, parts, text, language } = content;
          if (author?.role === "tool" && content_type === "text" && parts) {
            // skip failure textdoc creation or updates
            if (
              metadata?.canvas?.is_failure ||
              author?.name === "canmore.update_textdoc" ||
              metadata?.ui_card_title === "Processing image"
            )
              continue;
            const toolData = {
              instruction: parts,
            };
            pushMapData(turnId, toolMapData, toolData);
          }
          // extracting prompt used to generate image
          if (
            author?.role === "assistant" &&
            text &&
            content_type === "code" &&
            language === "json"
          ) {
            const json = JSON.parse(text) || {};
            const prompt = json?.prompt;
            if (!prompt) continue;
            const toolData = {
              instruction: prompt,
            };
            pushMapData(turnId, toolMapData, toolData);
          }
        } catch (e) {
          console.error("[API Mananger] Error processing tool data", e);
        }
      }
    }

    const fileMapData = new Map();
    processFileData();
    function processFileData() {
      for (const turnId in conversationApiData.mapping) {
        try {
          const node = conversationApiData.mapping[turnId];
          const message = node?.message;
          if (!message) continue;
          const { metadata } = message;
          const attachments = metadata?.attachments;
          if (!attachments) continue;
          attachments.forEach((attachment) => {
            try {
              const { id, name, file_token_size, mime_type, size } = attachment;
              const fileData = {
                id,
                name,
                mime_type,
                file_token_size,
                size,
              };
              pushMapData(turnId, fileMapData, fileData);
            } catch (e) {
              console.error(
                "[API Mananger] Error processing attachment data",
                e
              );
            }
          });
        } catch (e) {
          console.error("[API Mananger] Error processing file data", e);
        }
      }
    }

    /**
     * Pushes data to an array for turnID
     * @param {*} turnId
     * @param {*} MapData map to search
     * @param {*} object object to push
     */
    function pushMapData(turnId, MapData, object) {
      if (!MapData.get(turnId)) {
        MapData.set(turnId, [object]);
      } else {
        MapData.get(turnId).push(object);
      }
    }

    function getMetaData() {
      /**
       * Formats timestamp to readable string.
       */
      function formatTimestamp(timestamp) {
        if (!timestamp) return "";
        return new Date(timestamp * 1000).toLocaleString();
      }
      let jsonMetaData = {};
      jsonMetaData.title = conversationApiData.title;
      jsonMetaData.create_time = formatTimestamp(
        conversationApiData.create_time
      );
      jsonMetaData.update_time = formatTimestamp(
        conversationApiData.update_time
      );
      jsonMetaData.link = `https://chatgpt.com/c/${conversationId}`;
      return jsonMetaData;
    }
    const metaData = getMetaData();
    apiData = {
      metaData,
      userProfile,
      turnMapData,
      toolMapData,
      messageMapData,
      imageMapData,
      canvasMapData,
      reasoningMapData,
      fileMapData,
    };

    // Cache the processed data if caching is enabled
    if (useCache) {
      setCacheData(convId, apiData);
    }

    return apiData;
  }

  let exportData;
  async function convertExport(
    id = null,
    useCache = true,
    forceRefresh = false
  ) {
    function formatCanvasContent(canvases) {
      if (!canvases || canvases.length === 0) return "";
      let canvasMarkdown = "";
      canvases.forEach((canvas) => {
        if (!canvas.type) return;
        const parts = canvas.type?.split("/");
        let type = parts[0];
        if (parts.length > 1) type = parts[1];
        if (type.includes("react")) type = "typescript";

        canvasMarkdown += `\n\n**${canvas.title}** (v${canvas.version})\n\n`;
        canvasMarkdown += `\`\`\`${type || ""}\n${canvas.content}\n\`\`\`\n\n`;
      });
      return canvasMarkdown;
    }

    try {
      const { metaData, turnMapData, canvasMapData } = (await getApiData(
        id,
        useCache,
        forceRefresh
      )) || {
        metaData: {
          title: document.title + `${window.location.href.includes("temporary-chat=true")? ` (Temporary Chat)`:` (Fallback)`}`,
          create_time: new Date().toISOString(),
          update_time: new Date().toISOString(),
          link: window.location.href,
        },
        turnMapData: new Map(),
        canvasMapData: new Map(),
      };
      
      if (turnMapData.size === 0) {
        console.warn("Using fallback data")
        const articles = document.querySelectorAll("article [data-message-id]");
        const messageMapData = new Map();
        // tokenizer.clearTokenUI();
        articles.forEach((article) => {
          const turnId = article.closest("article").getAttribute("data-turn-id");
          const messageId = article.getAttribute("data-message-id");
          const role = article.getAttribute("data-message-author-role");
          const text = article.textContent;
          const messageData = {
            messageId,
            role,
            text,
            references: [],
          };
          messageMapData.set(messageId, [messageData]);
          turnMapData.set(turnId, {
            messages: [messageData],
            images: [],
            canvases: [],
            reasoning: [],
          });
        });
      }

      const turns = Array.from(turnMapData, ([turnId, data]) => ({
        turnId,
        ...data,
      }));

      const header = [
        `# **${metaData.title}**`,
        `**Link:** ${metaData.link}`,
        `**Created:** ${metaData.create_time}`,
        `**Updated:** ${metaData.update_time}`,
        "",
      ].join("\n\n");

      let markdown = header;
      let jsonAPI = { ...metaData, turns: [] };
      let jsonCopy = { ...metaData, turns: [] };

      turns.forEach((turn) => {
        const {
          turnId,
          messages = [],
          images = [],
          canvases = [],
          reasoning = [],
        } = turn;

        // Determine role
        let turnRole = "user";
        if (reasoning?.length || canvases?.length || images?.length) {
          turnRole = "assistant";
        } else if (messages.length > 0) {
          turnRole = messages[0].role || "assistant";
        }

        /**
         * Formats messages with attacted references
         * @param {*} messages the message data
         * @returns markdown formatting of messages with references
         */
        function renderMessagesWithRefs(messages, appendRef = true) {
          return messages
            .map((m) => {
              const body = m.text;
              const refs = appendRef
                ? m.references?.map((r) => `[${r.id}]: ${r.url}`).join("\n")
                : null;

              return body + (refs ? "\n\n" + refs : "");
            })
            .join("\n\n");
        }

        function renderImages(images) {
          return images
            .map((img) => `![${img.prompt}](${img.url})`)
            .join("\n\n");
        }

        // --- Markdown (collapsible reasoning, roles) ---
        let mdTurn = "";

        if (reasoning?.length) {
          mdTurn += `<details>\n<summary>View Reasoning</summary>\n\n${reasoning
            .map((r) =>
              r.thoughts
                .map((t) => `*${t.summary}*\n\n${t.content}`)
                .join("\n\n")
            )
            .join("\n\n")}\n\n</details>\n\n`;
        }

        if (messages?.length) {
          mdTurn += renderMessagesWithRefs(messages) + "\n\n";
        }

        if (images?.length) {
          mdTurn += renderImages(images) + "\n\n";
        }

        if (canvases?.length) {
          mdTurn += formatCanvasContent(canvases) + "\n\n";
        }

        markdown += `\n\n## **${
          turnRole === "user" ? "You" : "ChatGPT"
        } Said**\n\n${mdTurn.trim()}\n`;

        // --- JSON Full (with <think> tags, include role) ---
        let mdFull = "";

        if (reasoning?.length) {
          mdFull += `<think>\n${reasoning
            .map((r) =>
              r.thoughts
                .map((t) => `*${t.summary}*\n\n${t.content}`)
                .join("\n\n")
            )
            .join("\n\n")}\n</think>\n\n`;
        }

        if (messages?.length) {
          mdFull += renderMessagesWithRefs(messages) + "\n\n";
        }

        if (images?.length) {
          mdFull += renderImages(images) + "\n\n";
        }

        if (canvases?.length) {
          mdFull += formatCanvasContent(canvases) + "\n\n";
        }

        jsonAPI.turns.push({ role: turnRole, content: mdFull.trim() });

        // --- JSON Copy (no reasoning, no roles, no canvas) ---
        let mdCopy = "";

        if (messages?.length) {
          mdCopy += renderMessagesWithRefs(messages) + "\n\n";
        }

        jsonCopy.turns.push({ id: turnId, content: mdCopy.trim() });

        // --- Balance code fences ---
        const fenceCount = (markdown.match(/```/g) || []).length;
        if (fenceCount % 2 !== 0) markdown += "\n```";
      });
      const jsonData = { ...metaData, messages: turns };
      exportData = {
        markdown,
        jsonAPI,
        jsonCopy,
        jsonData,
        canvasMapData,
        metaData,
      };
      return exportData;
    } catch (error) {
      console.error("❌ Export failed:", error);
      exportData = null;
      return null;
    }
  }

  let userMemory = {
    memoryTokens: 0,
    memories: [],
  };
  async function getUserMemory() {
    console.log("[API Manager] Fetching memory...");
    try {
      await getAccessToken();
      if (!accessToken)
        throw new Error("Access token not available for memory fetch.");

      const response = await fetch(
        "https://chatgpt.com/backend-api/memories?include_memory_entries=true",
        {
          headers: {
            accept: "*/*",
            authorization: `Bearer ${accessToken}`,
          },
          method: "GET",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Memory API request failed with status: ${response.status}`
        );
      }

      const data = await response.json();
      const memoryTokens = data?.memory_num_tokens || 0;
      const memories = data?.memories;
      userMemory = {
        memoryTokens,
        memories,
      };
    } catch (error) {
      console.error(
        "❌ [API Manager] Could not retrieve memory tokens:",
        error
      );
      userMemory = {
        memoryTokens: 0,
        memories: [],
      }; // Return 0 on failure to avoid breaking the main flow
    }
    return userMemory;
  }

  const observer = new MutationObserver(() => {
    getConversationId();
  });
  const interval = setInterval(() => {
    const main = document.body.querySelector("main");
    if (main) {
      clearInterval(interval);
      observer.observe(main, {
        childList: true,
        subtree: true,
      });
    }
  }, 500);

  // Cache management methods
  const cacheManager = {
    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
      const now = Date.now();
      let validEntries = 0;
      let expiredEntries = 0;
      let totalSize = 0;

      for (const [convId, cached] of lastFetch.entries()) {
        const cacheAge = now - cached.timestamp;
        if (cacheAge < CACHE_DURATION) {
          validEntries++;
        } else {
          expiredEntries++;
        }
        totalSize += JSON.stringify(cached.data).length;
      }

      return {
        totalEntries: lastFetch.size,
        validEntries,
        expiredEntries,
        totalSizeBytes: totalSize,
        cacheDurationMs: CACHE_DURATION,
      };
    },

    /**
     * Clear all cached data
     */
    clearAll() {
      const count = lastFetch.size;
      lastFetch.clear();
      console.log(`[API Manager] Cleared all ${count} cache entries`);
    },

    /**
     * Clear cache for specific conversation
     * @param {string} convId - Conversation ID
     */
    clearConversation(convId) {
      if (lastFetch.delete(convId)) {
        console.log(`[API Manager] Cleared cache for conversation ${convId}`);
        return true;
      }
      return false;
    },

    /**
     * Get all cached conversation IDs
     * @returns {Array<string>} Array of conversation IDs
     */
    getCachedConversations() {
      return Array.from(lastFetch.keys());
    },

    /**
     * Force clear expired entries
     */
    clearExpired() {
      clearExpiredCache();
    },
  };

  return {
    getApiData,
    convertExport,
    getAccessToken,
    getImageDownloadUrl,
    getConversationId,
    getUserMemory,
    cacheManager,
    get userMemory() {
      return userMemory;
    },
    get accessToken() {
      return accessToken;
    },
    get conversationId() {
      return conversationId;
    },
    get apiData() {
      return apiData;
    },
    get exportData() {
      return exportData;
    },
    // Expose cache configuration for external modification if needed
    get cacheConfig() {
      return {
        CACHE_DURATION,
        cacheSize: lastFetch.size,
      };
    },
  };
})();
