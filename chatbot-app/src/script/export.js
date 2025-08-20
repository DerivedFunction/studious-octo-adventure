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
  // --- PRINT FUNCTIONALITY ---

  /**
   * Merged function to handle both printing and downloading the conversation as HTML.
   * It prepares the chat content, injects dynamic data, and then either
   * opens the print dialog or triggers a file download based on the specified action.
   * @param {'print' | 'download'} action - The desired action to perform.
   */
  async function exportOrPrintHTML(action) {
    let buttonsClicked = [];
    try {
      // --- SHARED SETUP AND DOM PREPARATION ---

      // 0. Open all reasoning sections to ensure their content is in the DOM for cloning.
      document
        .querySelectorAll(
          "div.origin-top-left button:not(pre button) span span"
        )
        .forEach((el) => {
          const parent = el.closest("div.origin-top-left");
          if (parent && parent.children.length !== 2) {
            const button = el.closest("button");
            button.click();
            buttonsClicked.push(button);
          }
        });

      // Wait briefly for the reasoning sections to expand.
      if (buttonsClicked.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // 1. Clone the main chat area. This serves as the base for both print and download.
      const mainArea = document.querySelector("article")?.parentElement;
      if (!mainArea) {
        alert("Could not find chat content to export.");
        return;
      }
      const area = mainArea.cloneNode(true);
      area.classList.add("print-content");
      // remove content script popups
      area
        .querySelectorAll(
          ".token-count-display,.extra-token-info, .token-status-container, .prompt-token-count"
        )
        .forEach((el) => el.remove());

      // 2. Fetch necessary conversation data for populating the cloned content.
      const { canvasMapData, jsonCopy } = await convertExport();
      const conversationTitle = jsonCopy.title;
      const data = Array.from(jsonCopy.turns); // An array [] of {id, content}
      const canvasDataMap = Array.from(canvasMapData, ([turnId, canvases]) => [
        turnId, canvases
      ]);
      // --- SHARED DOM MANIPULATION ON THE CLONED AREA ---
      // 3a. Set attributes on reasoning buttons for offline interactivity or styling.
      area
        .querySelectorAll(
          "div.origin-top-left button:not(pre button) span span"
        )
        .forEach((el) => {
          const btn = el.closest("button");
          btn.setAttribute("show", "true");
          const parent = btn.closest("div.origin-top-left");
          parent.classList.add("thoughts");
          btn.classList.add("reason");
        });

      // 3b. Set 'data-copy-content' attribute for entire messages to enable copying.
      area.querySelectorAll("[data-message-id]").forEach((message) => {
        const id = message.getAttribute("data-message-id");
        const buttonArray = message.parentElement.nextElementSibling;
        const copyBtn = buttonArray?.querySelector(
          "[data-testid='copy-turn-action-button']"
        );
        if (copyBtn) {
          const messageData = data.find((e) => e.id === id);
          const text = messageData?.content;
          copyBtn.setAttribute("data-copy-content", text);
        }
      });

      // 3c. Remove live popovers and replace them with static, highlighted code blocks from canvas data.
      area
        .querySelectorAll(".popover")
        .forEach((codeEl) => codeEl.parentElement.removeChild(codeEl));

      for (const [turnId, canvases] of canvasDataMap) {
        canvases.forEach((canvas) => {
          const parts = canvas.type?.split("/") || [null];
          const title = escapeHTML(canvas.title);
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
            codeContent = hljs.highlight(canvas.content, {
              language: type,
            }).value;
          } catch (e) {
            codeContent = hljs.highlightAuto(canvas.content).value;
            type = "auto";
          }

          const codeEl = document.createElement("div");
          codeEl.className =
            "markdown prose dark:prose-invert w-full break-words dark markdown-new-styling";
          codeEl.innerHTML = `<pre class="overflow-visible!"><div class="contain-inline-size rounded-2xl relative bg-token-sidebar-surface-primary"><div class="flex items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between h-9 bg-token-sidebar-surface-primary select-none rounded-t-2xl">${title}</div><div class="sticky top-9"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs"><button class="flex gap-1 items-center select-none py-1" aria-label="Copy"><svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon-xs"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>Copy</button></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-${type}"><span>${codeContent}</span></code></div></pre>`;

          const articleContent = area.querySelector(
            `article[data-turn-id='${turnId}'] div.w-full`
          );
          if (articleContent) articleContent.appendChild(codeEl);
        });
      }

      // 3d. Set 'data-copy-content' attribute for standard code blocks.
      area.querySelectorAll("pre").forEach((pre) => {
        const code = pre.querySelector("code");
        const button = pre.querySelector("button[aria-label='Copy']");
        if (code && button && !button.hasAttribute("data-copy-content")) {
          button.setAttribute("data-copy-content", code.textContent);
        }
      });

      // 3e. Standardize parent container class names for consistent styling.
      area.querySelectorAll("div.grow").forEach((el) => {
        el.parentElement.className =
          "mx-auto flex-1 group/turn-messages focus-visible:outline-hidden relative flex w-full min-w-0 flex-col";
      });

      // --- ACTION-SPECIFIC OUTPUT GENERATION ---

      if (action === "download") {
        // 4a. Create the interactive script for the offline HTML file.
        const script = document.createElement("script");
        script.textContent = `
        document.addEventListener('DOMContentLoaded', () => {
          let light = document.documentElement.classList.contains("light");
          const toggleButton = document.getElementById("toggleTheme");
          toggleButton.addEventListener("click", () => {
            light = !light;
            const theme = light ? "light" : "dark";
            const removeTheme = light ? "dark" : "light";
            document.querySelectorAll("*").forEach((el) => {
              el.classList.remove(removeTheme);
              el.classList.add(theme);
            });
          });
          document.body.addEventListener("click", (e) => {
            const button = e.target.closest("button[data-copy-content]");
            if (!button) return;
            const contentToCopy = button.getAttribute("data-copy-content");
            if (contentToCopy === null) return;
            navigator.clipboard
              .writeText(contentToCopy)
              .then(() => {
                const originalInnerHTML = button.innerHTML;
                const checkSVG =
                  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                if (button.closest("pre") || button.closest(".popover")) {
                  button.innerHTML = checkSVG + " Copied";
                } else {
                  button.innerHTML = checkSVG;
                }
                button.disabled = true;
                setTimeout(() => {
                  button.innerHTML = originalInnerHTML;
                  button.disabled = false;
                }, 2000);
              })
              .catch((err) => {
                console.error("Failed to copy to clipboard:", err);
                alert("Failed to copy!");
              });
          });
          document.querySelectorAll(".reason").forEach((btn) => {
            btn.addEventListener("click", () => {
              const parent = btn.closest(".origin-top-left");
              const thoughts = parent.querySelector("div.relative.z-0");
              thoughts.classList.toggle("show-reason");
            });
          });

          // Override Ctrl+P to use custom print function
          document.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "p") {
              event.preventDefault();
              document.querySelector("#printChat").click();
            }
          });
          document.querySelector("#printChat").addEventListener("click", async () => {
            // 1. Clone the main chat area. This serves as the base for both print and download.
            const mainArea = document.querySelector("article")?.parentElement;
            if (!mainArea) {
              alert("Could not find chat content to export.");
              return;
            }
            const area = mainArea.cloneNode(true);
            const articles = area.querySelectorAll("article");
            articles.forEach((article) => {
              const content = article.querySelector("[tabindex]");
              if (!content) return; // Clean up classes that might interfere with printing

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
              });
            });
            // 5a. Create a hidden iframe to build the print content in isolation.
            const printFrame = document.createElement("iframe");
            printFrame.style.position = "absolute";
            printFrame.style.width = "0";
            printFrame.style.height = "0";
            printFrame.style.border = "0";
            document.body.appendChild(printFrame);
            const printDocument = printFrame.contentWindow.document;
            // 5b. Clone all stylesheets into the iframe.
            document
              .querySelectorAll('link[rel="stylesheet"], style')
              .forEach((styleElement) => {
                printDocument.head.appendChild(styleElement.cloneNode(true));
              });
            printDocument.body.appendChild(area);
            printDocument.querySelectorAll("*").forEach((el) => {
              el.classList.add("light");
              el.classList.remove("dark");
            });
            // 5e. Trigger the print dialog and clean up the iframe afterward.
            setTimeout(() => {
              printFrame.contentWindow.focus();
              printFrame.contentWindow.print();
              setTimeout(() => {
                if (document.body.contains(printFrame)) {
                  document.body.removeChild(printFrame);
                }
              }, 1000);
            }, 200);
          });
        });
      `;

        // 4c. Assemble all necessary styles.
        let stylesHTML = "";

        // inline <style> blocks
        document
          .querySelectorAll(
            "style:not(#le-styles,#export-menu-styles,#token-popup-styles,#chm-styles"
          )
          .forEach((el) => {
            stylesHTML += el.outerHTML;
          });

        // fetch and inline external CSS <link>
        const linkEls = document.querySelectorAll('link[rel="stylesheet"]');
        for (let link of linkEls) {
          const href = link.href;
          try {
            const resp = await fetch(href);
            const cssText = await resp.text();
            stylesHTML += `<style>\n${cssText}\n</style>`;
          } catch (err) {
            console.warn("Failed to fetch stylesheet:", href, err);
            stylesHTML += link.outerHTML;
          }
        }

        const customStyles = `
        form, button:not([aria-label="Copy"], [show="true"]),
        nav, header, footer, [role="banner"], [role="navigation"], [role="complementary"] {
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
            max-height: 1000px;
            filter: blur(0);
            opacity: 1;
        }
        @media print {
            #toggleTheme, button, #header { display: none !important; }
        }
      `;
        stylesHTML += `<style>${customStyles}</style>`;
        const conversationId = getConversationId();
        // 4d. Construct the full HTML document string.
        const fullHTML = `
        <!DOCTYPE html>
        <html lang="en" class="${document.documentElement.className}">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${conversationTitle}</title>
            ${stylesHTML}
        </head>
        <body style="overflow-y: clip;">
            <div id="header" class="p-2 flex w-full items-center justify-center flex-row" style="background: var(--main-surface-primary);">
              <div class="flex items-center mx-2">
                <div class="group flex cursor-pointer justify-center items-center gap-1 rounded-lg min-h-9 touch:min-h-10 px-2.5 text-lg hover:bg-token-surface-hover focus-visible:bg-token-surface-hover font-normal whitespace-nowrap focus-visible:outline-none"><a href="https://chatgpt.com/c/${conversationId}">${conversationTitle}</a></div>
              </div>
              <div class="flex-1"></div>
              <div class="flex items-center mx-2 gap-1.5">
                <div id="toggleTheme" class="group flex cursor-pointer justify-center items-center gap-1 rounded-full min-h-9 touch:min-h-10 px-2.5 text-sm hover:bg-token-surface-hover focus-visible:bg-token-surface-hover font-normal whitespace-nowrap focus-visible:outline-none">
                  <div class="flex w-full items-center justify-center gap-1.5">Toggle Theme</div>
                </div>
                <div id="printChat" class="group flex cursor-pointer justify-center items-center gap-1 rounded-full min-h-9 touch:min-h-10 px-2.5 text-sm hover:bg-token-surface-hover focus-visible:bg-token-surface-hover font-normal whitespace-nowrap focus-visible:outline-none">
                  <div class="flex w-full items-center justify-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer-icon lucide-printer"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>
                    <span>Print</span>
                  </div>
                </div>
              </div>
            </div>
            <main class="overflow-y-scroll h-full">${area.outerHTML}</main>
            ${script.outerHTML}
        </body>
        </html>
      `;

        // 4e. Trigger the download.
        downloadFile(fullHTML, `ChatGPT-${conversationTitle}.html`, "html");
      } else if (action === "print") {
        // 5a.1 Fix code blocks inside articles and add user message borders.
        const articles = area.querySelectorAll("article");
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
          });
        });
        // 5a. Create a hidden iframe to build the print content in isolation.
        const printFrame = document.createElement("iframe");
        printFrame.style.position = "absolute";
        printFrame.style.width = "0";
        printFrame.style.height = "0";
        printFrame.style.border = "0";
        document.body.appendChild(printFrame);
        const printDocument = printFrame.contentWindow.document;

        // 5b. Clone all stylesheets into the iframe.
        document
          .querySelectorAll('link[rel="stylesheet"], style')
          .forEach((styleElement) => {
            printDocument.head.appendChild(styleElement.cloneNode(true));
          });

        // 5c. Add print-specific styles.
        const printStyles = `
        @media print {
            *, *::before, *::after { box-shadow: none !important; }
            body > div:not(.print-content), main > div:first-child, form, button,
            .token-count-display, .extra-token-info, .token-status-container,
            .prompt-token-count, nav, header, footer, [role="banner"],
            [role="navigation"], [role="complementary"] {
                display: none !important;
            }
            code {
                white-space: pre-wrap !important;
                word-break: break-all !important;
            }
        }
      `;
        const styleSheet = printDocument.createElement("style");
        styleSheet.textContent = printStyles;
        printDocument.head.appendChild(styleSheet);

        // 5d. Append the processed content and force a light theme for printing.
        printDocument.body.appendChild(area);
        printDocument.querySelectorAll("*").forEach((el) => {
          el.classList.add("light");
          el.classList.remove("dark");
        });

        // 5e. Trigger the print dialog and clean up the iframe afterward.
        setTimeout(() => {
          printFrame.contentWindow.focus();
          printFrame.contentWindow.print();
          setTimeout(() => {
            if (document.body.contains(printFrame)) {
              document.body.removeChild(printFrame);
            }
          }, 1000);
        }, 200);
      }
    } catch (error) {
      console.error(`❌ [Export HTML - ${action}] Failed:`, error);
      alert(
        `Failed to ${action} conversation. Check the console for more details.`
      );
    } finally {
      // --- SHARED CLEANUP ---
      // Un-click the reasoning buttons to restore the original page state.
      buttonsClicked.forEach((button) => {
        button.click();
      });
    }
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
   * Extracts and processes conversation data from ChatGPT API
   * @param {string} conversationId The conversation ID
   * @returns {Promise<string>}  { fileContent, conversationApiData, canvasDataMap, reasoningData }
   */
  async function getApiData() {
    const signal = AbortController ? new AbortController().signal : undefined;
    const token = await getAccessToken();
    const conversationId = getConversationId();
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
          const messageData = {
            messageId,
            role,
            text,
          };
          if (!messageMapData.has(turnId)) {
            messageMapData.set(turnId, [messageData]);
          } else {
            messageMapData.get(turnId).push(messageData);
          }
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
            if (!imageMapData.has(turnId)) {
              imageMapData.set(turnId, [imageData]);
            } else {
              imageMapData.get(turnId).push(imageData);
            }
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
              if (!canvasMapData.has(turnId)) {
                canvasMapData.set(turnId, [canvasData]);
              } else {
                canvasMapData.get(turnId).push(canvasData);
              }
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
                  if (!reasoningMapData.has(turnID)) {
                    reasoningMapData.set(turnID, [reasonData]);
                  } else {
                    reasoningMapData.get(turnID).push(reasonData);
                  }
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
    return {
      metaData,
      turnMapData,
      messageMapData,
      imageMapData,
      canvasMapData,
      reasoningMapData,
    };
  }

  /**
   * Downloads the markdown content as a file.
   */
  function downloadFile(content, filename, filetype = "markdown") {
    const blob = new Blob([content], {
      type: filetype === "json" ? "application/json" : `text/${filetype}`,
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
   *  Main function to trigger the markdown export process.
   */
  async function convertExport() {
    function formatCanvasContent(canvases) {
      if (!canvases || canvases.length === 0) return "";
      let canvasMarkdown = "";
      canvases.forEach((canvas) => {
        if (!canvas.type) return;
        const parts = canvas.type?.split("/");
        let type = parts[0];
        if (parts.length > 1) type = parts[1];
        if (type.includes("react")) type = "typescript";

        canvasMarkdown += `**${canvas.title}** (v${canvas.version})\n\n`;
        canvasMarkdown += `\`\`\`${type || ""}\n${canvas.content}\n\`\`\`\n\n`;
      });
      return canvasMarkdown;
    }

    try {
      const { metaData, turnMapData, canvasMapData } = await getApiData();
      const turns = Array.from(turnMapData, ([turnId, data]) => ({
        turnId,
        ...data,
      }));

      const header = [
        `# ${metaData.title}`,
        `Link: ${metaData.link}`,
        `Created: ${metaData.create_time}`,
        `Updated: ${metaData.update_time}`,
        "",
        "## Turns",
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

        // --- Markdown (collapsible reasoning, roles) ---
        let mdTurn = "";
        if (reasoning?.length) {
          mdTurn += `<details>\n<summary>**Reasoning**</summary>\n\n${reasoning
            .map((r) =>
              r.thoughts.map((t) => `*${t.summary}*\n\n${t.content}`).join("\n")
            )
            .join("\n")}\n</details>\n`;
        }
        if (messages?.length)
          mdTurn +=
            messages.map((m) => `${m.text}`).join("\n") + "\n";
        if (images?.length)
          mdTurn +=
            images.map((img) => `![${img.prompt}](${img.url})`).join("\n") +
            "\n";
        if (canvases?.length) mdTurn += formatCanvasContent(canvases);

        markdown += `\n\n## **${turnRole === "user" ? "You" : "ChatGPT"} Said**\n${mdTurn}`;

        // --- JSON Full (with <think> tags, include role) ---
        let mdFull = "";
        if (reasoning?.length) {
          mdFull += `<think>\n${reasoning
            .map((r) =>
              r.thoughts.map((t) => `*${t.summary}*\n\n${t.content}`).join("\n")
            )
            .join("\n")}\n</think>\n`;
        }
        if (messages?.length)
          mdFull += messages.map((m) => m.text).join("\n") + "\n";
        if (images?.length)
          mdFull +=
            images.map((img) => `![${img.prompt}](${img.url})`).join("\n") +
            "\n";
        if (canvases?.length) mdFull += formatCanvasContent(canvases);

        jsonAPI.turns.push({ role: turnRole, content: mdFull.trim() });

        // --- JSON Copy (no reasoning, no roles) ---
        let mdCopy = "";
        if (messages?.length)
          mdCopy += messages.map((m) => m.text).join("\n") + "\n";
        if (images?.length)
          mdCopy +=
            images.map((img) => `![${img.prompt}](${img.url})`).join("\n") +
            "\n";
        if (canvases?.length) mdCopy += formatCanvasContent(canvases);
        jsonCopy.turns.push({ id: turnId, content: mdCopy.trim() });
      });

      // Balance code fences
      const fenceCount = (markdown.match(/```/g) || []).length;
      if (fenceCount % 2 !== 0) markdown += "\n```";

      return {
        markdown,
        jsonAPI,
        jsonCopy,
        turnMapData,
        canvasMapData,
        metaData,
      };
    } catch (error) {
      console.error("❌ Export failed:", error);
      throw error;
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
      <span>Offline HTML</span>
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
      exportOrPrintHTML("print");
      dropdown.classList.remove("show");
    });
    dropdown.querySelector("#html-chat-item").addEventListener("click", () => {
      exportOrPrintHTML("download"); // Changed this line
      dropdown.classList.remove("show");
    });

    dropdown
      .querySelector("#export-md-item")
      .addEventListener("click", async () => {
        const { markdown, metaData } = await convertExport();
        if (markdown) {
          downloadFile(markdown, `ChatGPT-${metaData.title}.md`, "markdown");
        }
        dropdown.classList.remove("show");
      });
    dropdown
      .querySelector("#export-json-chat-item")
      .addEventListener("click", async () => {
        const { jsonAPI, metaData } = await convertExport();
        if (jsonAPI) {
          downloadFile(
            JSON.stringify(jsonAPI, null, 2),
            `ChatGPT-${metaData.title}.md`,
            "markdown"
          );
        }
        dropdown.classList.remove("show");
      });
    dropdown
      .querySelector("#export-json-item")
      .addEventListener("click", async () => {
        const { turnMapData, metaData } = await convertExport();
        if (turnMapData) {
          downloadFile(
            JSON.stringify(turnMapData, null, 2),
            `ChatGPT-${metaData.title}.md`,
            "markdown"
          );
        }
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
      exportOrPrintHTML("print");
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
