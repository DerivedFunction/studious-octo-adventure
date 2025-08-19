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

  // --- HTML Download ---
  /**
   * Clones the chat, injects dynamic canvas content, sets up offline copy functionality,
   * and downloads the entire conversation as a single HTML file.
   */
  async function downloadHTML() {
    try {
      // 0. Open all reasoning.
      let buttonsClicked = [];
      document
        .querySelectorAll(
          "div.origin-top-left button:not(pre button) span span"
        )
        .forEach((el) => {
          // find the nearest ancestor div.grow (or whatever parent you need)
          const parent = el.closest("div.origin-top-left");
          if (parent && parent.children.length !== 2) {
            const button = el.closest("button");
            button.click();
            buttonsClicked.push(button);
          }
        });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // 1. Clone the main chat area
      const area = document
        .querySelector("article")
        .parentElement.cloneNode(true);
      // 2. Unclick the reasoning
      buttonsClicked.forEach((button) => {
        button.click();
      });

      //2a. set attribute 'show' to not hide the button
      area
        .querySelectorAll(
          "div.origin-top-left button:not(pre button) span span"
        )
        .forEach((el) => {
          const btn = el.closest("button");
          btn.setAttribute("show", "true");
          const parent = btn.closest("div.origin-top-left");
          parent.classList.add("thoughts")
          btn.classList.add("reason");
        });
      const { canvasDataMap: canvasMap, fileContent } =
        await exportConversationToFileType(getConversationId(), "json", 0);
      const data = JSON.parse(fileContent);
      const conversationTitle = data.title;
      // 2b. Set copy attributes for entire messages
      area.querySelectorAll("[data-message-id]").forEach((message) => {
        const id = message.getAttribute("data-message-id");
        const buttonArray = message.parentElement.nextElementSibling;
        const copyBtn = buttonArray?.querySelector(
          "[data-testid='copy-turn-action-button']"
        );
        if (copyBtn) {
          const message = data.messages.find((e) => e.id === id);
          const text = message?.content
            .filter((o) => o.content_type.split("_")[1] === "text")
            .map((o) => o.text)
            .join("\n");
          copyBtn.setAttribute("data-copy-content", text);
        }
      });
      // Destroy all popovers, as we want to replace them with code blocks from canvasMap
      area.querySelectorAll(".popover").forEach((codeEl) => {
        codeEl.parentElement.removeChild(codeEl);
      });
      // canvasMap is: Map<messageId, { canvases: [...] }>
      for (const [messageId, { canvases }] of canvasMap) {
        canvases.forEach((canvas) => {
          const parts = canvas.type?.split("/") || [null];
          const title = escapeHTML(canvas.title); // escape for safety
          let type = parts.length > 1 ? parts[1] : parts[0];
          if (!type) return;
          switch (type) {
            case "react":
              type = "tsx";
              break;
            default:
              break;
          }

          let codeContent;
          try {
            // highlight with explicit type if possible
            codeContent = hljs.highlight(canvas.content, {
              language: type,
            }).value;
          } catch (e) {
            // fallback to auto detection
            codeContent = hljs.highlightAuto(canvas.content).value;
            type = "auto";
          }
          const codeEl = document.createElement("div");
          codeEl.className =
            "markdown prose dark:prose-invert w-full break-words dark markdown-new-styling";
          codeEl.innerHTML = `<pre class="overflow-visible!"><div class="contain-inline-size rounded-2xl relative bg-token-sidebar-surface-primary"><div class="flex items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between h-9 bg-token-sidebar-surface-primary select-none rounded-t-2xl">${title}</div><div class="sticky top-9"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs"><button class="flex gap-1 items-center select-none py-1" aria-label="Copy"><svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon-xs"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>Copy</button></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-${type}"><span>${codeContent}</span></code></div></pre>`;
          // Append it
          const articleContent = area.querySelector(
            `article [data-message-id='${messageId}'] div.w-full`
          );
          articleContent.appendChild(codeEl);
        });
      }
      // 2a. Set copy attributes for standard code blocks
      area.querySelectorAll("pre").forEach((pre) => {
        const code = pre.querySelector("code");
        const button = pre.querySelector("button[aria-label='Copy']");
        // Avoid overwriting canvas buttons that already have the attribute
        if (code && button && !button.hasAttribute("data-copy-content")) {
          button.setAttribute("data-copy-content", code.textContent);
        }
      });
      area.querySelectorAll("div.grow").forEach((el) => {
        el.parentElement.className =
          "mx-auto flex-1 group/turn-messages focus-visible:outline-hidden relative flex w-full min-w-0 flex-col";
      });
      // 6. Create the script to be embedded in the HTML file for interactivity
      const script = document.createElement("script");
      script.textContent = `
        // --- In-Page Script for Offline HTML ---
        document.addEventListener('DOMContentLoaded', () => {
            // 1. Theme Toggler
            let light = document.documentElement.classList.contains('light');
            const toggleButton = document.getElementById("toggleTheme");

            if (toggleButton) {
                toggleButton.addEventListener("click", () => {
                    light = !light;
                    const theme = light ? "light" : "dark";
                    const removeTheme = light ? "dark" : "light";
                    document.querySelectorAll("*").forEach((el) => {
                      el.classList.remove(removeTheme);
                      el.classList.add(theme);
                    });
                });
            }

            // 2. Universal Copy Handler
            document.body.addEventListener('click', (e) => {
                const button = e.target.closest('button[data-copy-content]');
                if (!button) return;

                const contentToCopy = button.getAttribute('data-copy-content');
                if (contentToCopy === null) return;

                navigator.clipboard.writeText(contentToCopy).then(() => {
                    const originalInnerHTML = button.innerHTML;
                    const checkSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

                    if (button.closest('pre') || button.closest('.popover')) {
                         button.innerHTML = checkSVG + ' Copied';
                    } else {
                         button.innerHTML = checkSVG;
                    }
                    button.disabled = true;

                    setTimeout(() => {
                        button.innerHTML = originalInnerHTML;
                        button.disabled = false;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy to clipboard:', err);
                    alert('Failed to copy!');
                });
            });
            document.querySelectorAll(".reason").forEach(btn => {
              btn.addEventListener("click", () => {
                const parent = btn.closest(".origin-top-left");
                const thoughts = parent.querySelector("div.relative.z-0");
                thoughts.classList.toggle("show-reason");
              });
            });
        });
      
    `;

      // 7. Create the theme toggle button element
      const toggleButton = document.createElement("div");
      toggleButton.textContent = "Toggle Theme";
      toggleButton.id = "toggleTheme";
      Object.assign(toggleButton.style, {
        position: "fixed",
        top: "10px",
        right: "10px",
        padding: "8px 12px",
        backgroundColor: "var(--main-surface-primary)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-medium)",
        borderRadius: "8px",
        cursor: "pointer",
        zIndex: "10000",
        userSelect: "none",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
      });

      // 8. Assemble the full HTML document as a string
      let stylesHTML = "";
      document
        .querySelectorAll('link[rel="stylesheet"], style')
        .forEach((el) => {
          stylesHTML += el.outerHTML;
        });

      const customStyles = `
        /* Hide unwanted UI elements and style the toggle button */
        #toggleTheme {
            background-color: var(--main-surface-primary) !important;
            color: var(--text-primary) !important;
            border-color: var(--border-medium) !important;
        }
      form, button:not([aria-label="Copy"], [show="true"]),
      .token-count-display,
      .extra-token-info, .token-status-container,
      .prompt-token-count, nav, header, footer,
      [role="banner"], [role="navigation"], [role="complementary"] {
        display: none !important;
      }
        .thoughts div.relative.z-0 {
          overflow: hidden;
          max-height: 0;
          opacity: 0;
          filter: blur(5px);
          transition: max-height 0.4s ease, opacity 0.4s ease;
        }
        .thoughts div.relative.z-0.show-reason {
          max-height: 1000px; /* large enough to fit content */
          filter: blur(0);
          opacity: 1;
        }
        
    `;
      stylesHTML += `<style>${customStyles}</style>`;

      const fullHTML = `
        <!DOCTYPE html>
        <html lang="en" class="${document.documentElement.className}">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${conversationTitle}</title>
            ${stylesHTML}
        </head>
        <body style="overflow-y: scroll;">
            ${toggleButton.outerHTML}
            <div style="padding: 2rem;">${area.outerHTML}</div>
            ${script.outerHTML}
        </body>
        </html>
    `;

      // 9. Trigger the download using the existing utility function
      downloadFile(fullHTML, `ChatGPT-${conversationTitle}.html`, "html");
    } catch (error) {
      console.error("❌ [Export HTML] Failed to create HTML file:", error);
      alert("Failed to export HTML. Check the console for more details.");
    }
  }

  // --- PRINT FUNCTIONALITY ---

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
    const { canvasDataMap: canvasMap } = await exportConversationToFileType(
      conversationId,
      "json",
      0
    );
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
    // 2. Create a hidden iframe to build the print content in isolation.
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
      code {
        white-space: pre-wrap !important;
        word-break: break-all !important;
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

    // Handle canvas textdoc content
    // Destroy all popovers, as we want to replace them with code blocks from canvasMap
    printDocument.querySelectorAll(".popover").forEach((codeEl) => {
      codeEl.parentElement.removeChild(codeEl);
    });

    // canvasMap is: Map<messageId, { canvases: [...] }>
    for (const [messageId, { canvases }] of canvasMap) {
      canvases.forEach((canvas) => {
        if (!canvas.type) return;
        const parts = canvas.type?.split("/") || [null];
        const title = escapeHTML(canvas.title); // escape for safety
        let type = parts.length > 1 ? parts[1] : parts[0];

        switch (type) {
          case "react":
            type = "tsx";
            break;
          default:
            break;
        }

        let codeContent;
        try {
          // highlight with explicit type if possible
          codeContent = hljs.highlight(canvas.content, {
            language: type,
          }).value;
        } catch (e) {
          // fallback to auto detection
          codeContent = hljs.highlightAuto(canvas.content).value;
          type = "auto";
        }
        const codeEl = printDocument.createElement("div");
        codeEl.className =
          "markdown prose dark:prose-invert w-full break-words dark markdown-new-styling";
        codeEl.innerHTML = `<pre class="overflow-visible!"><div class="contain-inline-size rounded-2xl relative bg-token-sidebar-surface-primary"><div class="flex items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between h-9 bg-token-sidebar-surface-primary select-none rounded-t-2xl">${title}</div><div class="sticky top-9"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs"><button class="flex gap-1 items-center select-none py-1" aria-label="Copy"><svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon-xs"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>Copy</button></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-${type}"><span>${codeContent}</span></code></div></pre>`;
        // Append it
        const articleContent = printDocument.querySelector(
          `article [data-message-id='${messageId}'] div.w-full`
        );
        articleContent.appendChild(codeEl);
      });
    }

    // 6. Fix code blocks inside articles and add user message borders.
    const articles = printDocument.querySelectorAll("article");
    articles.forEach((article) => {
      const content = article.querySelector("[tabindex]");
      if (!content) return; // Clean up classes that might interfere with printing

      content.className = "print-article-content";

      const codeBlocks = content.querySelectorAll("code");
      codeBlocks.forEach((codeEl) => {
        if (codeEl.closest("div")) {
          codeEl.closest("div").style.padding = "12px";
        } // Apply print-friendly code styling

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
    });
    // 7. Wait for styles to load, then trigger print and cleanup
    printDocument.querySelectorAll("*").forEach((el) => {
      el.classList.add("light");
      el.classList.remove("dark");
    });
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

  function escapeHTML(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
   * @returns {Promise<string>}  { fileContent, conversationApiData, canvasDataMap, reasoningData }
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
      const canvasDataMap = new Map();
      const allCanvasOps = [];

      // Pass 1: Collect all canvas operations
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
                allCanvasOps.push({ node, toolNode });
              }
            }
          }
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
          } = toolNode.message.metadata.canvas;
          const contentNode = JSON.parse(node.message.content.parts[0]);
          // Find the final assistant message this canvas belongs to.
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
          attachToMessageId = currentNodeId;

          // Correctly track and carry over titles for updated canvases
          let currentTitle = canvasTitle || canvasTitles.get(textdoc_id);
          if (currentTitle) {
            canvasTitles.set(textdoc_id, currentTitle);
          } else {
            currentTitle = contentNode.name || "Canvas";
          }
          let currentType = textdoc_type || canvasTypes.get(textdoc_id);
          if (currentType) {
            canvasTypes.set(textdoc_id, currentType);
          }
          const title = currentTitle;
          const content =
            contentNode.content || contentNode.updates?.[0]?.replacement || "";

          if (attachToMessageId) {
            const canvasData = {
              version,
              title,
              content,
              textdoc_id,
              type: textdoc_type,
            };

            if (!canvasDataMap.has(attachToMessageId)) {
              canvasDataMap.set(attachToMessageId, { canvases: [] });
            }
            canvasDataMap.get(attachToMessageId).canvases.push(canvasData);
          }
        } catch (e) {
          console.error("❌ [Export MD] Error processing canvas data:", e);
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
      const imageDataMap = new Map();
      let messageData = [];
      async function processMessage(messageId) {
        if (!messageId || processedMessages.has(messageId)) return;

        const node = conversationApiData.mapping[messageId];
        if (!node?.message) return;

        const message = node.message;
        const author = message.author?.role;
        const contentType = message.content?.content_type;

        // Skip system messages, hidden messages, and intermediate steps.
        // Allow tool messages that contain images ('multimodal_text').
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
                    id: messageId,
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
              let fullAssistantContent = "";
              // Append reasoning information if it exists
              const reasoningContent = reasoningData.get(messageId);
              if (reasoningContent && version > 0) {
                fullAssistantContent += reasoningContent;
              }
              // Add canvas content if available
              const additionalData = canvasDataMap.get(messageId);
              if (additionalData?.canvases && version > 0) {
                fullAssistantContent += formatCanvasContent(
                  additionalData.canvases
                );
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
                    id: messageId,
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
        }
        // Handle multimodal messages (e.g., images) from the tool role
        if (author === "tool" && contentType === "multimodal_text") {
          let markdownContent = "";
          let jsonParts = [];

          for (const part of message.content.parts) {
            if (
              part.content_type === "image_asset_pointer" &&
              part.asset_pointer
            ) {
              const fileId = part.asset_pointer.replace("sediment://", "");
              const conversationId = getConversationId();

              // Find the image prompt by traversing up the conversation tree
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
                const imageData = {
                  url: downloadUrl,
                  messageId: messageId,
                  prompt: prompt,
                };

                if (!imageDataMap.has(messageId)) {
                  imageDataMap.set(messageId, [imageData]);
                } else {
                  imageDataMap.get(messageId).push(imageData);
                }
              }
            }
          }

          // Add the processed content to the final output
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
            case 2:
              // We want chat completions, so  { "role": "role", "content": "text"}
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
      return {
        fileContent,
        conversationApiData,
        canvasDataMap,
        reasoningData,
        imageDataMap,
      };
    } catch (error) {
      console.error("❌ [Export MD] Export failed:", error);
      throw error;
    }
  }
  function formatCanvasContent(canvases) {
    if (!canvases || canvases.length === 0) return "";

    let canvasMarkdown = "";

    canvases.forEach((canvas, index) => {
      if (!canvas.type) return;
      const parts = canvas.type?.split("/");
      let type = parts[0];
      if (parts.length > 1) type = parts[1];
      if (type.includes("react")) type = "typescript";
      canvasMarkdown += `#### ${canvas.title}\n\n`;
      canvasMarkdown += `\`\`\`${type ? type : ""}\n${
        canvas.content
      }\n\`\`\`\n\n`;
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
      const { fileContent: content } = await exportConversationToFileType(
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
    <button class="export-menu-item" id="html-chat-item">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-code-icon lucide-code"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>
      <span>HTML</span>
    </button>
    <button class="export-menu-item" id="export-md-item">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
      <span>Markdown</span>
    </button>
    <button class="export-menu-item" id="export-json-item">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-braces-icon lucide-braces"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>
      <span>Input JSON</span>
    </button>
    <button class="export-menu-item" id="export-json-chat-item">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-braces-icon lucide-braces"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>
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
    dropdown.querySelector("#html-chat-item").addEventListener("click", () => {
      downloadHTML(); // Changed this line
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
