(() => {
  /**
   * Finds the main chat content, clones it into a hidden iframe with styles,
   * and triggers the browser's print dialog.
   */
  function triggerPrint() {
    // 1. Find the main content area you want to print.
    const printArea = document.querySelector("article")?.parentElement;
    if (!printArea) {
      alert("Could not find chat content to print.");
      return;
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

  /**
   * Creates and injects a "Print" button into the conversation header.
   */
  function addPrintButton() {
    // Check if the button already exists
    if (document.getElementById("print-chat-btn")) return;

    // Find the target container for header buttons
    const targetContainer = document.querySelector(
      "#conversation-header-actions"
    );
    if (!targetContainer) return; // Exit if the container isn't ready

    const button = document.createElement("button");
    button.id = "print-chat-btn";
    // Use native ChatGPT classes for consistent styling
    button.className = "btn relative btn-ghost text-token-text-primary";

    const innerDiv = document.createElement("div");
    innerDiv.className = "flex w-full items-center justify-center gap-1.5";

    // SVG icon for "Print"
    const svgIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    svgIcon.setAttribute("width", "20");
    svgIcon.setAttribute("height", "20");
    svgIcon.setAttribute("viewBox", "0 0 24 24");
    svgIcon.setAttribute("fill", "none");
    svgIcon.setAttribute("stroke", "currentColor");
    svgIcon.setAttribute("stroke-width", "2");
    svgIcon.setAttribute("stroke-linecap", "round");
    svgIcon.setAttribute("stroke-linejoin", "round");
    svgIcon.innerHTML = `<polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect>`;
    svgIcon.classList.add("-ms-0.5", "icon");

    const buttonText = document.createTextNode("Print");

    innerDiv.appendChild(svgIcon);
    innerDiv.appendChild(buttonText);
    button.appendChild(innerDiv);

    button.addEventListener("click", triggerPrint);

    // Insert the new button next to the other action buttons
    if (targetContainer.lastChild) {
      targetContainer.insertBefore(button, targetContainer.lastChild);
    } else {
      targetContainer.appendChild(button);
    }
  }

  // Listen for Ctrl+P or Cmd+P to trigger the custom print function
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "p") {
      event.preventDefault(); // Prevent the default browser print dialog
      triggerPrint();
    }
  });

  // --- Initialization and Navigation Handling ---

  // Run the script when the page is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addPrintButton);
  } else {
    addPrintButton();
  }

  // Use a MutationObserver to re-add the button when navigating between chats
  let currentUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
    }
    setTimeout(addPrintButton, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  console.log(
    "✅ [Print Script] Loaded successfully. Use Ctrl+P or the 'Print' button."
  );
})();
