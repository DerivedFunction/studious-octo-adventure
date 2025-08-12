import chatgpt from "../assets/chatgpt.png";

const Header = ({
  isScriptingEnabled,
  handleScriptingToggle,
  pageName,
  toolStatus,
  toggleTool,
  isDarkMode,
  setIsDarkMode,
}) => {
  return (
    <header
      className="flex items-center justify-between p-4 border-b transition-colors duration-300"
      style={{ borderColor: "var(--input-border)" }}
    >
      <img src={chatgpt} width={24} height={24} alt="ChatGPT Logo" />
      <h1
        className="text-xl font-bold m-0"
        style={{ color: "var(--header-text)" }}
      >
        ChatGPT Tools
      </h1>
      <div className="flex items-center gap-4">
        {/* --- NEW SCRIPTING TOGGLE --- */}
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--header-text)"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="lucide lucide-power-icon lucide-power"
          >
            <path d="M12 2v10" />
            <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
          </svg>
          <label
            htmlFor="scripting-toggle"
            className="relative inline-flex items-center cursor-pointer"
          >
            <input
              type="checkbox"
              id="scripting-toggle"
              className="sr-only peer"
              checked={isScriptingEnabled}
              onChange={handleScriptingToggle}
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
          </label>
        </div>
        {/* --- END NEW SCRIPTING TOGGLE --- */}

        <div className="flex items-center gap-3">
          <div style={{ color: "var(--header-text)" }}>{pageName}</div>
          <label
            htmlFor="page-toggle"
            className="relative inline-flex items-center cursor-pointer"
          >
            <input
              type="checkbox"
              id="page-toggle"
              className="sr-only peer"
              checked={toolStatus}
              onChange={() => toggleTool((prev) => !prev)}
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--header-text)" }}
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
          <label
            htmlFor="dark-mode-toggle"
            className="relative inline-flex items-center cursor-pointer"
          >
            <input
              type="checkbox"
              id="dark-mode-toggle"
              className="sr-only peer"
              checked={isDarkMode}
              onChange={() => setIsDarkMode((prev) => !prev)}
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>
    </header>
  );
};
export default Header;
