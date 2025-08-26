window.ChatGPTCode = (() => {
  function addCollapse() {
    const codeBlocks = document.querySelectorAll(
      "article pre button[aria-label='Copy']"
    );

    if (!codeBlocks) return;

    // Only target code blocks without a collapse button already added
    const numBlocks = Array.from(codeBlocks).filter(
      (e) =>
        e.childNodes.length != 3 &&
        !e.parentElement.querySelector("[data-collapse-added]")
    );
    if (numBlocks.length === 0) return;

    numBlocks.forEach((el) => {
      const parent = el.parentElement;
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "flex gap-1 items-center select-none py-1";
      collapseBtn.setAttribute("aria-label", "Collapse Or Expand");
      collapseBtn.setAttribute("data-collapse-added", "true"); // marker
      collapseBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" 
             viewBox="0 0 24 24" fill="none" stroke="currentColor" 
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" 
             class="icon-xs">
          <path d="m7 15 5 5 5-5"/>
          <path d="m7 9 5-5 5 5"/>
        </svg>
        <span></span>
      `;
      parent.appendChild(collapseBtn);

      const code = el.closest("pre").querySelector("code");
      function updateLabel() {
        const totalLines = code.textContent.split("\n").length;
        collapseBtn.querySelector("span").textContent =
          code.style.display === "none"
            ? `Expand (${totalLines} lines hidden)`
            : "Collapse";
      }

      // Initialize button label
      updateLabel();

      collapseBtn.addEventListener("click", () => {
        code.style.display = code.style.display === "none" ? "block" : "none";
        updateLabel();
      });
    });
  }

  function observeCodeBlocks() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          // Run only if new <pre> or <code> might exist
          if (
            Array.from(mutation.addedNodes).some(
              (node) =>
                node.nodeType === 1 &&
                (node.matches("pre, code, article") ||
                  node.querySelector?.("pre code"))
            )
          ) {
            addCollapse();
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function setupGlobalShortcut() {
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

          // Update label
          const totalLines = code.textContent.split("\n").length;
          btn.querySelector("span").textContent =
            code.style.display === "none"
              ? `Expand (${totalLines} lines hidden)`
              : "Collapse";
        });
      }
    });
  }

  // Run immediately for existing code blocks
  addCollapse();
  // Watch for dynamically added ones
  observeCodeBlocks();
  // Enable keyboard shortcut
  setupGlobalShortcut();
  return {
    addCollapse,
  };
})();
