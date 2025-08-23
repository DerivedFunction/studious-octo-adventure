(() => {
  function getModifierKey() {
    const ua = navigator.userAgent.toLowerCase();
    const isMac = /mac|ipod|iphone|ipad/.test(ua);
    return isMac ? "⌘" : "Ctrl";
  }

  function createEnhancedToolsSection() {
    const container = document.createDocumentFragment();
    const exist = document.querySelector("#enhanced-tool-shortcuts");
    if (exist) return;

    const modifier = getModifierKey();

    // Section Header
    const header = document.createElement("dt");
    header.className = "text-token-text-tertiary col-span-2 mt-2 empty:hidden";
    header.textContent = "Enhanced Tools";
    header.id = "enhanced-tool-shortcuts";
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
      const dt = document.createElement("dt");
      dt.textContent = tool.name;

      const dd = document.createElement("dd");
      dd.className = "text-token-text-secondary justify-self-end";

      const div = document.createElement("div");
      div.className =
        `inline-flex whitespace-pre *:inline-flex *:font-sans *:not-last:after:px-0.5 ${modifier === "⌘" ? "":
          "*:not-last:after:content-['+']"}`;

      // Modifier key (Ctrl/Cmd)
      const kbdMod = document.createElement("kbd");
      kbdMod.setAttribute("aria-label", modifier);
      const spanMod = document.createElement("span");
      spanMod.className = "min-w-[1em]";
      spanMod.textContent = modifier;
      kbdMod.appendChild(spanMod);

      // Shortcut key
      const kbdKey = document.createElement("kbd");
      const spanKey = document.createElement("span");
      spanKey.className = "min-w-[1em]";
      spanKey.textContent = tool.key;
      kbdKey.appendChild(spanKey);

      div.appendChild(kbdMod);
      div.appendChild(kbdKey);
      dd.appendChild(div);

      container.appendChild(dt);
      container.appendChild(dd);
    });

    return container;
  }

  // Attach listener for Ctrl/Cmd + /
  document.addEventListener("keydown", async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      setTimeout(() => {
        let shortcuts = document.body.querySelector("dl");
        if (!shortcuts) return;
        shortcuts.appendChild(createEnhancedToolsSection());
      }, 100);
    }
  });
})();
