(() => {
  /**
   * Finds the main chat content, clones it into a hidden iframe with styles,
   * and triggers the browser's print dialog.
   */
  function triggerPrint() {
    // 1. Find the main content area you want to print.
    const printArea = document.querySelector("main");
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

    // 4. Add a custom print-only stylesheet to hide unwanted elements and set layout.
    const printStyles = `
            @media print {
                /* Hide UI elements that shouldn't be printed */
                body > div:not(.print-content),
                main > div:first-child, /* Hides the model selector header */
                form, button {
                    display: none !important;
                }
                /* Ensure the print content takes up the full page */
                .print-content {
                    width: 100%;
                    margin: 0;
                    padding: 1rem;
                    box-shadow: none;
                }
            }
        `;
    const styleSheet = printDocument.createElement("style");
    styleSheet.textContent = printStyles;
    printDocument.head.appendChild(styleSheet);

    // 5. Clone the content into the iframe's body.
    const contentToPrint = printArea.cloneNode(true);
    contentToPrint.classList.add("print-content");
    printDocument.body.appendChild(contentToPrint);

    // 6. Trigger the print dialog and clean up the iframe afterward.
    setTimeout(() => {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();
      document.body.removeChild(printFrame);
    }, 100); // A small delay ensures styles are applied
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
      // Delay to ensure the new page's header is rendered
      setTimeout(addPrintButton, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log(
    "✅ [Print Script] Loaded successfully. Use Ctrl+P or the 'Print' button."
  );
})();
