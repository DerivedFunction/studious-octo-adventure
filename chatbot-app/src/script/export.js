window.ChatGPTExport = (() => {
  // --- SHARED UTILITIES ---
  const canceledJobs = new Set();
  function cancelJob(jobid) {
    canceledJobs.add(jobid);
    showStatusBar(jobid, `Canceling Export`, 0);
  }
  /**
   * Create a status bar showing status export
   *  */
  function showStatusBar(jobid = Date.now(), text, percent, toPercent = null) {
    // Remove existing status bar with same ID if present
    const existingStatusBar = document.getElementById(
      `export-status-bar-${jobid}`
    );
    if (existingStatusBar) {
      existingStatusBar.remove();
    }
    if (canceledJobs.has(jobid)) {
      return;
    }

    // Create status bar container
    const statusBar = document.createElement("div");
    statusBar.id = `export-status-bar-${jobid}`;
    statusBar.className = "export-status-bar";

    // Create content with cancel button
    statusBar.innerHTML = `
    <div class="export-status-content ignore-this">
      <div class="export-status-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" x2="12" y1="15" y2="3"/>
        </svg>
      </div>
      <div class="export-status-text">${text}</div>
      <div class="export-status-progress">
        <div class="export-status-progress-bar" style="width: ${percent}%"></div>
      </div>
      <div class="export-status-percentage">${percent}%</div>
      <button class="export-status-cancel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;
    statusBar
      .querySelector("button.export-status-cancel")
      .addEventListener("click", () => cancelJob(jobid));
    let container = document.querySelector("#export-status-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "export-status-container";
      document.body.appendChild(container);
    }
    container.appendChild(statusBar);

    // Auto-hide when progress reaches 100%
    if (percent >= 100 || percent == 0) {
      closeStatusBar();
    }
    if (toPercent) {
      const status = statusBar.querySelector(".export-status-progress-bar");
      const percentage = statusBar.querySelector(".export-status-percentage");

      let current = percent;
      const step = () => {
        if (current <= toPercent && !canceledJobs.has(jobid)) {
          status.style.width = `${current}%`;
          percentage.textContent = `${current}%`;
          current++;
          setTimeout(step, 100); // adjust speed
          if (current >= 100) {
            closeStatusBar();
          }
        } else if (current >= toPercent && canceledJobs.has(jobid)) {
          setTimeout(() => {
            canceledJobs.delete(jobid); // Clean up the job from the Set
          }, 1000 * 5 * 60);
        }
      };
      step();
    }
    // return a jobid if it is null
    return jobid;

    function closeStatusBar() {
      setTimeout(() => {
        if (statusBar && statusBar.parentNode) {
          statusBar.style.opacity = "0";
          statusBar.style.transform = "translateY(100%)";
          setTimeout(() => {
            statusBar.remove();
          }, 300);
        }
      }, 1500);
    }
  }

  // --- HTML Download ---
  // --- PRINT FUNCTIONALITY ---
  /**
   * Merged function to handle both printing and downloading the conversation as HTML.
   * It prepares the chat content, injects dynamic data, and then either
   * opens the print dialog or triggers a file download based on the specified action.
   * @param {'print' | 'download'} action - The desired action to perform.
   */
  async function exportOrPrintHTML(
    action = "print",
    printOptions = {
      reason: true,
      assistant: true,
      user: true,
      replaceCanvas: true,
      saveImages: true, // load images as data-uri
      saveStyles: true, // fetch styles
    }
  ) {
    const jobid = Date.now();
    let buttonsClicked = [];
    try {
      // --- SHARED SETUP AND DOM PREPARATION ---
      showStatusBar(jobid, `${action}: Begin Export`, 1, 5);
      // 0. Open all reasoning sections to ensure their content is in the DOM for cloning.
      document
        .querySelectorAll(
          "div.origin-top-left button:not(pre button) span span"
        )
        .forEach((el) => {
          const parent = el.closest("div.origin-top-left");
          if (!parent) return;
          const expandReason =
            parent.children.length !== 2 && printOptions.reason;
          const collapseReason =
            parent.children.length === 2 && !printOptions.reason;
          if (expandReason || collapseReason) {
            // expand or collapse reasoning
            const button = el.closest("button");
            button.click();
            buttonsClicked.push(button);
          }
        });

      // Wait briefly for the reasoning sections to expand.
      if (buttonsClicked.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (canceledJobs.has(jobid)) return;
      showStatusBar(jobid, `${action}: Preparing content`, 5, 15);

      // 1. Clone the main chat area. This serves as the base for both print and download.
      const mainArea = document.querySelector("article")?.parentElement;
      if (!mainArea) {
        alert("Could not find chat content to export.");
        showStatusBar(jobid, `${action}: Export Canceled`, 0);
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

      if (canceledJobs.has(jobid)) return;
      showStatusBar(jobid, `${action}: Fetching conversation data`, 15, 30);

      // 2. Fetch necessary conversation data for populating the cloned content.
      const { canvasMapData, jsonCopy } = await ChatGPT.convertExport();
      const conversationTitle = jsonCopy.title;
      const data = Array.from(jsonCopy.turns); // An array [] of {id, content}
      const canvasDataMap = Array.from(canvasMapData, ([turnId, canvases]) => [
        turnId,
        canvases,
      ]);

      if (canceledJobs.has(jobid)) return;
      showStatusBar(jobid, `${action}: Processing content`, 30, 50);

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
        message.style.opacity = 1;
        const id = message.closest("article").getAttribute("data-turn-id");
        const buttonArray = message.parentElement.nextElementSibling;
        const copyBtn = buttonArray?.querySelector(
          "[data-testid='copy-turn-action-button']"
        );
        if (copyBtn) {
          const messageData = data.find((e) => e.id === id);
          const text = messageData?.content;
          if (text) copyBtn.setAttribute("data-copy-content", text);
        }
      });

      // 3c. Remove live popovers and replace them with static, highlighted code blocks from canvas data.
      if (printOptions.replaceCanvas) {
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
            codeEl.setAttribute("textdoc_id", canvas.textdoc_id);
            codeEl.setAttribute("textdoc_version", canvas.version);
            codeEl.className =
              "markdown prose dark:prose-invert w-full break-words dark markdown-new-styling mt-2 canvas-to-codeblock";
            codeEl.innerHTML = `<pre class="overflow-visible!"><div class="contain-inline-size rounded-2xl relative bg-token-sidebar-surface-primary"><div class="flex items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between h-9 bg-token-sidebar-surface-primary select-none rounded-t-2xl">${title}</div><div class="sticky top-9"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs"><button class="flex gap-1 items-center select-none py-1" aria-label="Collapse Or Expand" data-collapse-added="true"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-xs"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg><span>Collapse</span></button><button class="flex gap-1 items-center select-none py-1" aria-label="Copy"><svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon-xs"><path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path></svg>Copy</button></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-${type}"><span>${codeContent}</span></code></div></pre>`;

            const articleContent = area.querySelector(
              `article[data-turn-id='${turnId}']`
            );
            if (!articleContent) return;
            const articleMessage =
              articleContent.querySelector("[data-message-id]");
            if (articleMessage)
              articleMessage.parentElement.insertBefore(codeEl, articleMessage);
            else articleContent.appendChild(codeEl);
          });
        }
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

      // 3f. Hide user or assistant messages
      if (!printOptions.user) {
        area
          .querySelectorAll("article [data-message-author-role='user']")
          .forEach((el) => (el.closest("article").style.display = "none"));
      }
      if (!printOptions.assistant) {
        area
          .querySelectorAll("article [data-message-author-role='assistant']")
          .forEach((el) => (el.closest("article").style.display = "none"));
      }

      // --- ACTION-SPECIFIC OUTPUT GENERATION ---
      if (action === "Save Webpage") {
        if (canceledJobs.has(jobid)) return;
        showStatusBar(jobid, `${action}: Building HTML page`, 50, 60);
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

          document.querySelectorAll("button[data-collapse-added]").forEach(
            (btn) => {
              btn.addEventListener("click", () => {
                const code = btn.closest("pre").querySelector("code");
                code.style.display = code.style.display === "none" ? "block" : "none";
                btn.querySelector("span").textContent =
                code.style.display === "none"
                  ? "Expand"
                  : "Collapse";
              })
          })
          // Override Ctrl + Shift + C to use custom collapse code function
          document.addEventListener("keydown", (e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.shiftKey &&
              e.key.toLowerCase() === "c"
            ) {
              e.preventDefault();

              const buttons = document.querySelectorAll(
                "button[data-collapse-added]"
              );
              if (!buttons.length) return;

              // Detect if we should collapse or expand
              const shouldCollapse = Array.from(buttons).some(
                (btn) =>
                  btn.closest("pre").querySelector("code").style.display !== "none"
              );

              buttons.forEach((btn) => {
                const code = btn.closest("pre").querySelector("code");
                code.style.display = shouldCollapse ? "none" : "block";
                btn.querySelector("span").textContent =
                  code.style.display === "none"
                    ? "Expand"
                    : "Collapse";
              });
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
            "style:not(#le-styles,#export-menu-styles,#token-popup-styles,#chm-styles,#export-status-styles,#print-options-styles"
          )
          .forEach((el) => {
            stylesHTML += el.outerHTML;
          });
        let currentPercent = 60.0;
        // fetch and inline external CSS <link>
        const linkEls = document.querySelectorAll('link[rel="stylesheet"]');
        let delta = Math.round((75 - currentPercent) / linkEls.length);
        for (let link of linkEls) {
          if (canceledJobs.has(jobid)) return;
          const href = link.href;
          try {
            showStatusBar(
              jobid,
              "Applying styling",
              currentPercent,
              currentPercent + delta
            );
            if (!printOptions.saveStyles) {
              stylesHTML += link.outerHTML;
            } else {
              const resp = await fetch(href);
              const cssText = await resp.text();
              stylesHTML += `<style>\n${cssText}\n</style>`;
            }
            currentPercent += delta;
          } catch (err) {
            showStatusBar(
              jobid,
              "Stylesheet Error. Appending link.",
              currentPercent
            );
            console.warn("Failed to fetch stylesheet:", href, err);
            stylesHTML += link.outerHTML;
          }
        }

        const customStyles = `
        form, button:not([aria-label="Copy"], [show="true"], [aria-label="Collapse Or Expand"]),
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
        if (printOptions.saveImages) {
          const images = area.querySelectorAll("img");
          delta = Math.round((95 - currentPercent) / images.length);
          for (const img of images) {
            try {
              // Skip if already data URI
              if (canceledJobs.has(jobid)) return;
              showStatusBar(
                jobid,
                "Downloading images",
                currentPercent,
                currentPercent + delta
              );
              currentPercent += delta;
              if (img.src.startsWith("data:")) continue;
              const response = await fetch(img.src, { mode: "cors" }).catch(
                () => null
              );
              if (!response || !response.ok) continue;

              const blob = await response.blob();
              const reader = new FileReader();

              reader.onloadend = () => {
                img.src = reader.result; // Replace with data URI
              };

              reader.readAsDataURL(blob);
            } catch (err) {
              console.warn("Failed to convert image:", img.src, err);
            }
          }
        }

        if (canceledJobs.has(jobid)) return;
        const conversationId = ChatGPT.getConversationId();
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
                <div id="toggleTheme" class="group flex cursor-pointer justify-center items-center gap-1 rounded-full min-h-9 touch:min-h-10 px-2.5 text-sm hover:bg-token-surface-hover focus-visible:bg-token-surface-hover font-normal whitespace-nowap focus-visible:outline-none">
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
        downloadFile(
          fullHTML,
          `ChatGPT-${conversationTitle}.html`,
          "text/html",
          jobid,
          action
        );
      } else if (action === "Print Chat") {
        if (canceledJobs.has(jobid)) return;
        showStatusBar(jobid, `${action}: Preparing print`, 60, 90);
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

        if (canceledJobs.has(jobid)) return;
        showStatusBar(jobid, `${action}: Opening print dialog`, 90, 100);

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
      showStatusBar(jobid, `${action}: Export failed`, 0);
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
   * Downloads the markdown content as a file.
   */
  function downloadFile(
    content,
    filename,
    mimeType = "application/octet-stream",
    jobId,
    action
  ) {
    const blob =
      content instanceof Blob
        ? content
        : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    if (!canceledJobs.has(jobId)) a.click();
    showStatusBar(jobId, `${action}: Downloading file`, 100);
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- UI AND INITIALIZATION ---

  /**
   * Injects CSS for the custom dropdown menu and status bar to match ChatGPT's UI.
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

    // Add status bar styles
    const statusStyle = document.createElement("style");
    statusStyle.id = "export-status-styles";
    statusStyle.textContent = `
    #export-status-container {
        position: fixed;
        bottom: 20px;
        right: 20px;
    }
    .export-status-bar {
      background: var(--main-surface-primary);
      border: 1px solid var(--border-light);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      min-width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      transform: translateY(0);
      opacity: 1;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .export-status-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .export-status-icon {
      color: var(--text-primary);
      flex-shrink: 0;
    }
    
    .export-status-icon svg {
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .export-status-text {
      color: var(--text-primary);
      font-size: 14px;
      font-weight: 500;
      flex-grow: 1;
    }
    
    .export-status-progress {
      width: 60px;
      height: 4px;
      background: var(--main-surface-tertiary);
      border-radius: 2px;
      overflow: hidden;
      flex-shrink: 0;
    }
    
    .export-status-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #10a37f, #1a7f64);
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    
    .export-status-percentage {
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      min-width: 32px;
      text-align: right;
      flex-shrink: 0;
    }
  
  `;
    document.head.appendChild(statusStyle);
  }
  // Print Options Dialog Implementation
  // Add this to your existing export.js file

  // CSS for the print options dialog
  function injectPrintOptionsStyles() {
    if (document.getElementById("print-options-styles")) return;

    const style = document.createElement("style");
    style.id = "print-options-styles";
    style.textContent = `
    #print-options-container { 
      position: fixed; 
      top: 0; 
      left: 0; 
      width: 100vw; 
      height: 100vh; 
      background-color: rgba(0, 0, 0, 0.6); 
      z-index: 9999; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-family: inherit; 
      opacity: 0; 
      visibility: hidden;
      transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out; 
    }
    
    #print-options-container.visible { 
      opacity: 1; 
      visibility: visible;
    }
    
    #print-options-modal { 
      position: relative; 
      background-color: var(--main-surface-primary, #ffffff); 
      color: var(--text-primary, #000000); 
      border: 1px solid var(--border-medium, #e5e5e5); 
      border-radius: 16px; 
      width: min(480px, 90vw); 
      max-height: 80vh;
      display: flex; 
      flex-direction: column; 
      box-shadow: 0 10px 30px rgba(0,0,0,0.2); 
      overflow: hidden; 
      transform: scale(0.95); 
      transition: transform 0.2s ease-in-out; 
    }
    
    #print-options-container.visible #print-options-modal { 
      transform: scale(1); 
    }
    
    #print-options-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px 16px 24px;
      border-bottom: 1px solid var(--border-light);
    }
    
    #print-options-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }
    
    #print-options-close-btn { 
      background: none; 
      border: none; 
      font-size: 1.25rem; 
      cursor: pointer; 
      color: var(--text-tertiary); 
      transition: color 0.2s;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
    }
    
    #print-options-content { 
      padding: 20px 24px; 
      overflow-y: auto;
      flex-grow: 1;
      overscroll-behavior: contain;
      contain: layout style;
    }

    .print-option-group {
      margin-bottom: 24px;
    }
    
    .print-option-group:last-child {
      margin-bottom: 0;
    }
    
    .print-option-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 8px;
    }
    
    .print-option-description {
      font-size: 0.8rem;
      color: var(--text-secondary);
      margin-bottom: 12px;
      line-height: 1.4;
    }
    
    .print-checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .print-checkbox-label { 
      display: flex; 
      align-items: flex-start; 
      cursor: pointer; 
      user-select: none; 
      gap: 12px;
      padding: 8px 0;
    }
    
    .print-checkbox-label input[type="checkbox"] { 
      position: absolute; 
      opacity: 0; 
      height: 0; 
      width: 0; 
    }
    
    .print-custom-checkbox { 
      position: relative; 
      display: inline-block; 
      width: 18px; 
      height: 18px; 
      background-color: transparent; 
      border: 1px solid var(--text-tertiary, #8e8ea0); 
      border-radius: 4px; 
      transition: all 0.2s ease;
      flex-shrink: 0;
      margin-top: 1px;
    }
    
    .print-checkbox-label:hover .print-custom-checkbox { 
      border-color: var(--text-secondary, #6b6b7b); 
    }
    
    .print-checkbox-label input[type="checkbox"]:checked + .print-custom-checkbox { 
      background-color: var(--accent-primary, #10a37f); 
      border-color: var(--accent-primary, #10a37f); 
    }
    
    .print-custom-checkbox::after { 
      content: ''; 
      position: absolute; 
      display: none; 
      left: 6px; 
      top: 2px; 
      width: 4px; 
      height: 9px; 
      border: solid white; 
      border-width: 0 2px 2px 0; 
      transform: rotate(45deg); 
    }
    
    .print-checkbox-label input[type="checkbox"]:checked + .print-custom-checkbox::after { 
      display: block; 
    }
    
    .print-checkbox-content {
      flex-grow: 1;
    }
    
    .print-checkbox-title {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 2px;
    }
    
    .print-checkbox-desc {
      font-size: 0.8rem;
      color: var(--text-secondary);
      line-height: 1.3;
    }
    
    #print-options-footer { 
      display: flex; 
      justify-content: flex-end; 
      align-items: center; 
      gap: 12px; 
      padding: 16px 24px; 
      border-top: 1px solid var(--border-light); 
    }
    #print-options-footer .btn {
      border-color: var(--border-light);
      background-color: var(--main-surface-secondary);
    }

    #print-options-footer .btn:hover {
      background-color: var(--main-surface-tertiary);
    }
    
  `;

    document.head.appendChild(style);
  }

  // Create and show the print options dialog
  function showPrintOptionsDialog(option = "Print Chat") {
    // Inject styles if not already present
    injectPrintOptionsStyles();

    // Remove existing dialog if present
    const existingDialog = document.getElementById("print-options-container");
    if (existingDialog) {
      existingDialog.remove();
    }

    // Create dialog HTML
    const dialogHTML = `
    <div id="print-options-container" class="ignore-this">
      <div id="print-options-modal">
        <div id="print-options-header">
          <h2 id="print-options-title">${option} Options</h2>
          <button id="print-options-close-btn" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div id="print-options-content">
          <div class="print-option-group">
            <label class="print-option-label">Include Content</label>
            <div class="print-option-description">
              Choose which parts of the conversation to include.
            </div>
            <div class="print-checkbox-group">
              <label class="print-checkbox-label">
                <input type="checkbox" id="print-include-user" checked>
                <div class="print-custom-checkbox"></div>
                <div class="print-checkbox-content">
                  <div class="print-checkbox-title">User Messages</div>
                  <div class="print-checkbox-desc">Include your questions and prompts</div>
                </div>
              </label>
              
              <label class="print-checkbox-label">
                <input type="checkbox" id="print-include-assistant" checked>
                <div class="print-custom-checkbox"></div>
                <div class="print-checkbox-content">
                  <div class="print-checkbox-title">Assistant Responses</div>
                  <div class="print-checkbox-desc">Include ChatGPT's responses and answers</div>
                </div>
              </label>
              
              <label class="print-checkbox-label">
                <input type="checkbox" id="print-include-reasoning" checked>
                <div class="print-custom-checkbox"></div>
                <div class="print-checkbox-content">
                  <div class="print-checkbox-title">Reasoning/Thinking</div>
                  <div class="print-checkbox-desc">Include ChatGPT's internal reasoning process</div>
                </div>
              </label>
            </div>
          </div>
          
          <div class="print-option-group">
            <label class="print-option-label">Canvas & Code</label>
            <div class="print-option-description">
              Options for handling code blocks and canvas documents.
            </div>
            <div class="print-checkbox-group">
              <label class="print-checkbox-label">
                <input type="checkbox" id="print-replace-canvas" checked>
                <div class="print-custom-checkbox"></div>
                <div class="print-checkbox-content">
                  <div class="print-checkbox-title">Replace Canvas with Code</div>
                  <div class="print-checkbox-desc">Convert interactive canvas documents to static code blocks. Requires internet access to fetch canvas documents.</div>
                </div>
              </label>
            </div>
          </div>
          <div class="print-option-group" style="${
            option === "Save Webpage" ? "" : "display: none;"
          }">
            <label class="print-option-label">Styles and Images</label>
            <div class="print-option-description">
              Options for saving stylesheets and images locally. Requires internet access to fetch content. Results in larger files.
            </div>
            <div class="print-checkbox-group">
              <label class="print-checkbox-label">
                <input type="checkbox" id="print-save-images" checked>
                <div class="print-custom-checkbox"></div>
                <div class="print-checkbox-content">
                  <div class="print-checkbox-title">Save Images Locally</div>
                  <div class="print-checkbox-desc">Replace all visible images with local data.</div>
                </div>
              </label>
            </div>
            <div class="print-checkbox-group">
              <label class="print-checkbox-label">
                <input type="checkbox" id="print-save-styles" checked>
                <div class="print-custom-checkbox"></div>
                <div class="print-checkbox-content">
                  <div class="print-checkbox-title">Save Stylesheets Locally</div>
                  <div class="print-checkbox-desc">Append the stylesheets instead of appending links.</div>
                </div>
              </label>
            </div>
          </div>
        </div>
        
        <div id="print-options-footer">
          <button class="btn" id="print-options-cancel">Cancel</button>
          <button class="btn" id="print-options-confirm">
            ${option}
          </button>
        </div>
      </div>
    </div>
  `;

    // Add dialog to DOM
    document.body.insertAdjacentHTML("beforeend", dialogHTML);

    const container = document.getElementById("print-options-container");

    // Show dialog with animation
    requestAnimationFrame(() => {
      container.classList.add("visible");
    });

    // Event handlers
    const closeDialog = () => {
      container.classList.remove("visible");
      setTimeout(() => {
        container.remove();
      }, 200);
    };

    // Close button
    document
      .getElementById("print-options-close-btn")
      .addEventListener("click", closeDialog);

    // Cancel button
    document
      .getElementById("print-options-cancel")
      .addEventListener("click", closeDialog);

    // Click outside to close
    container.addEventListener("click", (e) => {
      if (e.target === container) {
        closeDialog();
      }
    });

    // Escape key to close
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        closeDialog();
        document.removeEventListener("keydown", handleEscape);
      }
    };
    document.addEventListener("keydown", handleEscape);

    // Confirm button - collect options and proceed with print
    document
      .getElementById("print-options-confirm")
      .addEventListener("click", () => {
        const options = {
          user: document.getElementById("print-include-user").checked,
          assistant: document.getElementById("print-include-assistant").checked,
          reason: document.getElementById("print-include-reasoning").checked,
          replaceCanvas: document.getElementById("print-replace-canvas")
            .checked,
          saveImages: document.getElementById("print-save-images").checked,
          saveStyles: document.getElementById("print-save-styles").checked,
        };

        closeDialog();

        // Call your existing print function with the collected options
        exportOrPrintHTML(option, options);
      });
  }

  // Export the function for use in your existing code
  window.showPrintOptionsDialog = showPrintOptionsDialog;

  /**
   * Creates and injects the "Export" menu button(s) for desktop and mobile.
   */
  function addExportMenu() {
    // Only on conversation pages
    const inConversation =
      window.location.pathname.startsWith("/c/") ||
      window.location.href.includes("temporary-chat=true");
    const targetContainer = document.querySelector(
      "#conversation-header-actions"
    ); // desktop
    const mobileMenu = document.querySelector(
      "div.no-draggable a[aria-label='New chat']"
    );
    let smallContainer;
    if (mobileMenu) smallContainer = mobileMenu.closest("div.no-draggable"); // mobile

    // Build menu factory
    function buildExportMenu() {
      const menuContainer = document.createElement("div");
      menuContainer.className = "relative export-menu-container ignore-this";

      const button = document.createElement("button");
      button.title = "Export";
      button.className =
        "btn relative btn-ghost text-token-text-primary export-menu-btn";
      button.innerHTML = `
      <div class="flex w-full items-center justify-center gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" x2="12" y1="15" y2="3"/>
        </svg>
        <span class="hidden md:block">Export</span>
        <svg class="hidden md:block" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6"/>
        </svg>
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
      <span>Save Webpage</span>
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

      // Attach event listeners
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("show");
      });

      dropdown
        .querySelector("#print-chat-item")
        .addEventListener("click", () => {
          showPrintOptionsDialog("Print Chat");
          dropdown.classList.remove("show");
        });
      dropdown
        .querySelector("#html-chat-item")
        .addEventListener("click", () => {
          showPrintOptionsDialog("Save Webpage");
          dropdown.classList.remove("show");
        });
      dropdown
        .querySelector("#export-md-item")
        .addEventListener("click", async () => {
          const id = Date.now();
          showStatusBar(
            id,
            "Download markdown: Fetching conversation data",
            1,
            60
          );
          const { markdown, metaData } = await ChatGPT.convertExport();
          showStatusBar(id, "Processing Data", 60, 95);
          if (markdown) {
            downloadFile(
              markdown,
              `ChatGPT-${metaData.title}.md`,
              "text/markdown",
              id,
              "Download markdown"
            );
          }
          dropdown.classList.remove("show");
        });
      dropdown
        .querySelector("#export-json-chat-item")
        .addEventListener("click", async () => {
          const id = Date.now();
          showStatusBar(id, "Download JSON: Fetching conversation data", 1, 60);
          const { jsonData, metaData } = await ChatGPT.convertExport();
          showStatusBar(id, "Processing Data", 60, 95);
          if (jsonData) {
            downloadFile(
              JSON.stringify(jsonData, null, 2),
              `ChatGPT-Output-${metaData.title}.json`,
              "application/json",
              id,
              "Download JSON"
            );
          }
          dropdown.classList.remove("show");
        });
      dropdown
        .querySelector("#export-json-item")
        .addEventListener("click", async () => {
          const id = Date.now();
          showStatusBar(id, "Download JSON: Fetching conversation data", 1, 60);
          const { jsonAPI, metaData } = await ChatGPT.convertExport();
          showStatusBar(id, "Processing Data", 60, 95);
          if (jsonAPI) {
            downloadFile(
              JSON.stringify(jsonAPI, null, 2),
              `ChatGPT-Input-${metaData.title}.json`,
              "application/json",
              id,
              "Download JSON"
            );
          }
          dropdown.classList.remove("show");
        });

      // Hide dropdown when clicking elsewhere
      document.addEventListener("click", () => {
        dropdown.classList.remove("show");
      });

      return menuContainer;
    }

    // Helper to inject or show/hide per container
    function ensureMenu(container) {
      if (!container) return;
      const existing = container.querySelector(".export-menu-container");

      if (!inConversation && !guestMode()) {
        if (existing) existing.style.display = "none";
        return;
      }

      if (existing) {
        existing.style.display = "";
        return;
      }

      // Create and insert new menu
      const menu = buildExportMenu();
      if (container.lastChild) {
        container.insertBefore(menu, container.lastChild);
      } else {
        container.appendChild(menu);
      }
    }

    // Handle both desktop + mobile separately
    ensureMenu(targetContainer);
    ensureMenu(smallContainer);
  }

  // Override Ctrl+P to use custom print function
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "p") {
      event.preventDefault();
      showPrintOptionsDialog("Print Chat");
    }
  });
  // Override Ctrl+S to use custom html function
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      showPrintOptionsDialog("Save Webpage");
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
  return {
    exportOrPrintHTML,
  };
})();
function guestMode() {
  return (
    document.querySelector("[data-testid='login-button']") ||
    document.querySelector("[data-testid='mobile-login-button']")
  );
}
