(() => {
  function createEnhancedToolsSection() {
    const container = document.createDocumentFragment();
    const exist = document.querySelector("#enhanced-chatgpt-tool-shorcuts");
    if (exist) return;
    // Section Header
    const header = document.createElement("dt");
    header.className = "text-token-text-tertiary col-span-2 mt-2 empty:hidden";
    header.textContent = "Enhanced ChatGPT Tools";
    header.id = "enhanced-chatgpt-tool-shorcuts";
    container.appendChild(header);

    // List of tools + shortcuts
    const tools = [
      { name: "Manage history", key: "H" },
      { name: "Manage labels", key: "L" },
      { name: "Print", key: "P" },
      { name: "Save webpage", key: "S" },
      { name: "Open saved prompts", key: "M" },
      { name: "Run token check", key: "B" },
    ];

    tools.forEach((tool) => {
      // dt element
      const dt = document.createElement("dt");
      dt.textContent = tool.name;

      // dd element
      const dd = document.createElement("dd");
      dd.className = "text-token-text-secondary justify-self-end";

      const div = document.createElement("div");
      div.className =
        "inline-flex whitespace-pre *:inline-flex *:font-sans *:not-last:after:px-0.5 *:not-last:after:content-['+']";

      // Ctrl
      const kbdCtrl = document.createElement("kbd");
      kbdCtrl.setAttribute("aria-label", "Control");
      const spanCtrl = document.createElement("span");
      spanCtrl.className = "min-w-[1em]";
      spanCtrl.textContent = "Ctrl";
      kbdCtrl.appendChild(spanCtrl);

      // Key
      const kbdKey = document.createElement("kbd");
      const spanKey = document.createElement("span");
      spanKey.className = "min-w-[1em]";
      spanKey.textContent = tool.key;
      kbdKey.appendChild(spanKey);

      // Append
      div.appendChild(kbdCtrl);
      div.appendChild(kbdKey);
      dd.appendChild(div);

      container.appendChild(dt);
      container.appendChild(dd);
    });

    return container;
  }

  // Attach listener for Ctrl + /
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      let shortcuts = document.body.querySelector("dl");
      if (!shortcuts) {
        return;
      }
      shortcuts.appendChild(createEnhancedToolsSection());
    }
  });
})();
