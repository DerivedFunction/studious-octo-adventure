/* eslint-disable no-undef */
import { useState, useEffect, useRef } from "react";
import Header from "./header";

// Helper to get initial dark mode preference from chrome.storage or system settings
const getInitialDarkMode = (callback) => {
  try {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(["isDarkMode"], (result) => {
        if (result.isDarkMode !== undefined) {
          callback(result.isDarkMode);
        } else {
          callback(
            window.matchMedia?.("(prefers-color-scheme: dark)").matches || false
          );
        }
      });
    } else {
      callback(
        window.matchMedia?.("(prefers-color-scheme: dark)").matches || false
      );
    }
  } catch (error) {
    console.error("Error getting initial dark mode:", error);
    callback(false);
  }
};

const ThemeableChatbot = () => {
  // --- STATE MANAGEMENT ---
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: "user",
      content: "This is a user message. Click me to change the theme.",
    },
    {
      id: 2,
      type: "ai",
      content: "This is an AI response.",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [themeColor, setThemeColor] = useState("#B3B3B3");
  const [themeObject, setThemeObject] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [isScriptingEnabled, setIsScriptingEnabled] = useState(false); // <-- NEW: State for scripting toggle
  const [isThemeActive, setIsThemeActive] = useState(false);
  const [contextWindow, setContextWindow] = useState(0); //  tokens
  const chatContainerRef = useRef(null);
  const textareaRef = useRef(null);

  // --- PERMISSIONS CONFIG ---
  const scriptingPermissions = {
    permissions: ["scripting"],
    origins: ["https://chat.openai.com/*", "https://*.chatgpt.com/*"], // The host you want to run scripts on
  };

  // --- COLOR CONVERSION UTILITIES (Omitted for brevity, same as your original code) ---
  const hslToHex = (h, s, l) => {
    l /= 100;
    const a = (s * Math.min(l, 1 - l)) / 100;
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  const hexToHsl = (hex) => {
    let r = 0,
      g = 0,
      b = 0;
    if (hex.length === 7) {
      r = parseInt(hex.substring(1, 3), 16);
      g = parseInt(hex.substring(3, 5), 16);
      b = parseInt(hex.substring(5, 7), 16);
    }
    r /= 255;
    g /= 255;
    b /= 255;
    const cmin = Math.min(r, g, b),
      cmax = Math.max(r, g, b);
    const delta = cmax - cmin;
    let h = 0,
      s = 0,
      l = (cmax + cmin) / 2;
    if (delta !== 0) {
      s = delta / (1 - Math.abs(2 * l - 1));
      switch (cmax) {
        case r:
          h = ((g - b) / delta) % 6;
          break;
        case g:
          h = (b - r) / delta + 2;
          break;
        case b:
          h = (r - g) / delta + 4;
          break;
        default:
          break;
      }
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }
    return { h, s: s * 100, l: l * 100 };
  };

  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  };

  // --- THEME GENERATION LOGIC (Omitted for brevity, same as your original code) ---
  const generateFullThemeObject = (mainColorHex) => {
    const hsl = hexToHsl(mainColorHex);
    const rgb = hexToRgb(mainColorHex);
    if (!rgb) return null;
    const { h, s, l } = hsl;
    const isNearBlack = l < 15;
    const isBlack = l === 0;
    const isWhite = l === 100;
    const isGrey = s < 20;
    const lightTheme = {
      primary: mainColorHex,
      "submit-btn-bg": mainColorHex,
      "submit-btn-text": "#ffffff",
      "user-msg-bg": isNearBlack ? `hsl(0, 0%, 95%)` : `hsl(${h}, ${s}%, 95%)`,
      "user-msg-text":
        isNearBlack || isGrey ? `hsl(0, 0%, 15%)` : `hsl(${h}, 100%, 15%)`,
      "secondary-btn-bg": isNearBlack
        ? `hsl(0, 0%, 95%)`
        : `hsl(${h}, ${s}%, 95%)`,
      "secondary-btn-text":
        isNearBlack || isGrey ? `hsl(0, 0%, 15%)` : `hsl(${h}, 100%, 15%)`,
      "user-selection-bg": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`,
    };

    const darkTheme = {
      primary: mainColorHex,
      "submit-btn-bg": mainColorHex,
      "submit-btn-text": "#ffffff",
      "user-msg-bg": `hsl(${h}, ${s}%, ${l * 0.5}%)`,
      "user-msg-text":
        isNearBlack || isGrey ? `hsl(0, 0%, 98%)` : `hsl(${h}, ${s}%, 98%)`,
      "secondary-btn-bg": `hsl(${h}, ${s}%, ${l * 0.6}%)`,
      "secondary-btn-text": "#ffffff",
      "user-selection-bg": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`,
    };

    if (isBlack) {
      const lightThemeBlack = {
        primary: mainColorHex,
        "submit-btn-bg": mainColorHex,
        "submit-btn-text": "#ffffff",
        "user-msg-bg": `hsl(${h}, ${s}%, ${l * 0.5}%)`,
        "user-msg-text":
          isNearBlack || isGrey ? `hsl(0, 0%, 98%)` : `hsl(${h}, ${s}%, 98%)`,
        "secondary-btn-bg": `hsl(${h}, ${s}%, ${l * 0.6}%)`,
        "secondary-btn-text": "#ffffff",
        "user-selection-bg": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`,
      };
      return { light: lightThemeBlack, dark: darkTheme };
    }

    if (isWhite) {
      const lightThemeWhite = {
        primary: mainColorHex,
        "submit-btn-bg": mainColorHex,
        "submit-btn-text": "#000",
        "user-msg-bg": `hsl(${h}, ${s}%, 98%)`,
        "user-msg-text": `hsl(0, 0%, 0%)`,
        "secondary-btn-bg": `hsl(${h}, ${s}%, 94%)`,
        "secondary-btn-text": "#000",
        "user-selection-bg": `rgba(${rgb.r - 20}, ${rgb.g - 20}, ${
          rgb.b - 20
        }, 0.6)`,
      };
      const darkThemeWhite = {
        primary: mainColorHex,
        "submit-btn-bg": mainColorHex,
        "submit-btn-text": "#000",
        "user-msg-bg": `hsl(${h}, ${s}%, 98%)`,
        "user-msg-text": `hsl(0, 0%, 0%)`,
        "secondary-btn-bg": `hsl(${h}, ${s}%, ${l}%)`,
        "secondary-btn-text": "#000",
        "user-selection-bg": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`,
      };
      return { light: lightThemeWhite, dark: darkThemeWhite };
    }
    return { light: lightTheme, dark: darkTheme };
  };

  // --- SIDE EFFECTS ---
  useEffect(() => {
    // Load initial settings from storage
    getInitialDarkMode(setIsDarkMode);
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get(["themeColor", "isThemeActive", "contextWindow"], (result) => {
          if (result.themeColor) setThemeColor(result.themeColor);
          if (result.isThemeActive) setIsThemeActive(result.isThemeActive);
          if (result.contextWindow) setContextWindow(result.contextWindow);
        });
        // Check to see if script exists
        try {
          chrome.scripting.getRegisteredContentScripts(
            { ids: ["ChatGPT"] },
            (result) => {
              setIsScriptingEnabled(result.length > 0);
            }
          );
        } catch (e) {
          console.log("No script found", e);
          setIsScriptingEnabled(false);
        }
      }
    } catch (error) {
      console.error("Error reading from chrome.storage on init:", error);
    }
  }, []);

  useEffect(() => {
    const newThemeObject = generateFullThemeObject(themeColor);
    setThemeObject(newThemeObject);

    if (chrome?.storage?.local && newThemeObject) {
      chrome.storage.local.set(
        {
          themeColor,
          isDarkMode,
          themeObject: newThemeObject,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Storage error:", chrome.runtime.lastError);
          } else {
            console.log("Theme saved to storage");
          }
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeColor, isDarkMode]);

  useEffect(() => {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ isScriptingEnabled });
    }
  }, [isScriptingEnabled]);
  useEffect(() => {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ isThemeActive });
    }
  }, [isThemeActive]);

  useEffect(() => {
    // Auto-scroll chat
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  useEffect(() => {
    // Adjust textarea for multi-line input
    const textarea = textareaRef.current;
    if (textarea) {
      setIsMultiLine(textarea.value.length > 50);
    }
  }, [inputMessage]);

  useEffect(() => {
    if (chrome?.storage?.local) {
     chrome.storage.local.set({ contextWindow });
    }
  }, [contextWindow]);

  // --- EVENT HANDLERS ---

  // NEW: Handler for the scripting toggle
  const handleScriptingToggle = async () => {
    const newIsEnabled = !isScriptingEnabled;
    setIsScriptingEnabled(newIsEnabled); // Optimistically update UI

    try {
      if (newIsEnabled) {
        // Request permissions when enabling
        const granted = await chrome.permissions.request(scriptingPermissions);
        if (granted) {
          try {
            await chrome.scripting.registerContentScripts([
              {
                id: "ChatGPT",
                matches: [
                  "https://chat.openai.com/*",
                  "https://*.chatgpt.com/*",
                ],
                js: ["./script/chatgpt.js"],
                runAt: "document_end",
                allFrames: true,
              },
            ]);
            console.log("Scripting permissions granted.");
          } catch (e) {
            console.log("Scripting error.", e);
          }
          chrome.storage.local.set({ isScriptingEnabled: true });
        } else {
          console.log("Scripting permissions denied.");
          setIsScriptingEnabled(false); // Revert UI if denied
        }
      } else {
        // Remove permissions when disabling
        try {
          await chrome.scripting.unregisterContentScripts();
          console.log("All dynamic content scripts unregistered");
        } catch (error) {
          console.error("Error unregistering scripts:", error);
        }
        await chrome.permissions.remove(scriptingPermissions);
        console.log("Scripting permissions removed.");
      }
    } catch (error) {
      console.error("Error handling scripting permissions:", error);
      setIsScriptingEnabled(isScriptingEnabled); // Revert on error
    }
  };

  const handleSendMessage = () => {
    if (inputMessage.trim().length > 0) {
      window.open(
        `https://www.chatgpt.com/?prompt=${encodeURIComponent(
          inputMessage.trim()
        )}`,
        "_blank"
      );
    } else {
      window.open("https://www.chatgpt.com/?mode=voice", "_blank");
      return;
    }
    const newMessage = {
      id: Date.now(),
      type: "user",
      content: inputMessage.trim(),
    };
    setMessages((prev) => [...prev, newMessage]);
    setInputMessage("");
    setTimeout(() => setIsMultiLine(false), 0);
    setIsTyping(true);
    setTimeout(() => {
      const aiMessage = {
        id: Date.now() + 1,
        type: "ai",
        content: "Sample response. Try selecting text.",
      };
      setMessages((prev) => [...prev, aiMessage]);
      setIsTyping(false);
    }, 1500);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleColorChange = (e) => {
    const CAP = 70;
    const newColorHex = e.target.value;
    const hsl = hexToHsl(newColorHex);
    if (hsl.l > CAP && hsl.l != 100) {
      hsl.l = CAP;
      const cappedColorHex = hslToHex(hsl.h, hsl.s, hsl.l);
      setThemeColor(cappedColorHex);
    } else {
      setThemeColor(newColorHex);
    }
  };

  // --- RENDER LOGIC ---
  if (!themeObject) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        Loading...
      </div>
    );
  }

  const currentTheme = themeObject[isDarkMode ? "dark" : "light"];

  const DynamicGlobalStyles = () => (
    <style>{`
    .theme-root {
      --submit-btn-bg: ${currentTheme["submit-btn-bg"]};
      --submit-btn-text: ${currentTheme["submit-btn-text"]};
      --user-msg-bg: ${currentTheme["user-msg-bg"]};
      --user-msg-text: ${currentTheme["user-msg-text"]};
      --secondary-btn-bg: ${currentTheme["secondary-btn-bg"]};
      --secondary-btn-text: ${currentTheme["secondary-btn-text"]};
      --header-text: ${isDarkMode ? "#ffffff" : "#18181b"};
      --ai-msg-bg: transparent;
      --ai-msg-text: ${isDarkMode ? "#ffffff" : "#18181b"};
      --input-bg: ${isDarkMode ? "#ffffff0d" : "#ffffff"};
      --input-text: ${isDarkMode ? "#ffffff" : "#18181b"};
      --input-border: ${isDarkMode ? "#ffffff0d" : "#0000000d"};
      --body-bg: ${isDarkMode ? "#212121" : "#ffffff0d"};
      --text-secondary: ${isDarkMode ? "#ffffffb3" : "#0009"};
    }
    /* Fix placeholder color for theme switching */
    .theme-root textarea::placeholder {
      color: var(--input-text);
      opacity: 0.5;
    }
    .theme-root textarea::-webkit-input-placeholder {
      color: var(--input-text);
      opacity: 0.5;
    }
    .theme-root textarea::-moz-placeholder {
      color: var(--input-text);
      opacity: 0.5;
    }
    .theme-root textarea:-ms-input-placeholder {
      color: var(--input-text);
      opacity: 0.5;
    }
    ::selection { background-color: ${currentTheme["user-selection-bg"]}; }
    ::-moz-selection { background-color: ${currentTheme["user-selection-bg"]}; }
    @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    .animate-bounce-dot { animation: bounce 1s infinite; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .fade-in { animation: fadeIn 0.5s ease-out forwards; }
  `}</style>
  );

  return (
    <>
      <DynamicGlobalStyles />
      <div
        className="flex flex-col items-center justify-center h-full w-full font-sans"
        style={{ backgroundColor: "var(--body-bg)" }}
      >
        <div
          className="theme-root w-full h-full mx-auto flex flex-col transition-colors duration-300"
          style={{ backgroundColor: "var(--body-bg)" }}
        >
          <Header
            isScriptingEnabled={isScriptingEnabled}
            handleScriptingToggle={handleScriptingToggle}
            themeColor={themeColor}
            handleColorChange={handleColorChange}
            isDarkMode={isDarkMode}
            setIsDarkMode={setIsDarkMode}
            pageName={"Theme"}
            toolStatus={isThemeActive}
            toggleTool={setIsThemeActive}
          />

          <main
            ref={chatContainerRef}
            className="flex-1 p-6 overflow-y-auto min-h-0 flex flex-col gap-1"
          >
            <input
              type="color"
              id="theme-color-picker"
              value={themeColor}
              onChange={handleColorChange}
              className="w-8 h-8 p-0 bg-transparent border-none rounded-md cursor-pointer hidden"
            />
            {messages.map((msg) => (
              <>
              <div
                key={msg.id}
                className={`flex items-start ${
                  msg.type === "user" ? "justify-end" : ""
                } fade-in`}
              >
                <div
                  className={`flex-1 ${
                    msg.type === "user" ? "text-right" : ""
                  }`}
                >
                  <div
                    className="inline-block px-4 py-3 rounded-[28px] font-medium transition-colors duration-300"
                    style={{
                      backgroundColor:
                        msg.type === "user"
                          ? "var(--user-msg-bg)"
                          : "var(--ai-msg-bg)",
                      color:
                        msg.type === "user"
                          ? "var(--user-msg-text)"
                          : "var(--ai-msg-text)",
                    }}
                    onClick={() => {
                      if (msg.type === "user") {
                        document.querySelector("input[type='color']").click();
                      }
                    }}
                  >
                    <p className="m-0 whitespace-pre-wrap">{msg.content}</p>
                  </div>            
                </div>   
              </div>
              <div
                  className={`token-count-display inline-block ml-8
                    ${msg.type === "user" ? "text-right" : ""
                    } fade-in
                      `}
                  style={{
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    fontWeight: "normal",
                  }}
                  onClick={() => {
                    const contextWindow =
                      parseFloat(window.prompt("Enter Context Window Length [per (K) tokens]:", "8")) 
                    const value =
                      contextWindow < 0 || Number.isNaN(contextWindow)
                        ? 0
                        : contextWindow * 2 ** 10;
                      setContextWindow(value);
                  }}
                  >
                    {`Click to set Context Window: ${contextWindow} tokens`}
                  </div>
              </>
            ))}
            {isTyping && (
              <div className="flex gap-3 items-start">
                <div
                  className="inline-block max-w-xl p-4 rounded-[28px]"
                  style={{ backgroundColor: "var(--ai-msg-bg)" }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce-dot"
                      style={{ animationDelay: "0s" }}
                    ></span>
                    <span
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce-dot"
                      style={{ animationDelay: "0.2s" }}
                    ></span>
                    <span
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce-dot"
                      style={{ animationDelay: "0.4s" }}
                    ></span>
                  </div>
                </div>
              </div>
            )}
          </main>
          <footer className="p-4">
            <div
              className={`flex items-center gap-4 border p-1 rounded-[28px] w-full shadow-2xs transition-colors duration-300 ${
                isMultiLine ? "flex-col" : "flex-row"
              }`}
              style={{
                borderColor: "var(--input-border)",
                backgroundColor: "var(--input-bg)",
              }}
            >
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask anything"
                className="flex-grow resize-none bg-transparent rounded-lg px-4 py-2 focus:outline-none w-full transition-colors duration-300"
                style={{
                  minHeight: "36px",
                  maxHeight: "100px",
                  color: "var(--input-text)",
                }}
              />
              <div className={`pr-1 ${isMultiLine ? "self-end pb-1" : ""}`}>
                <button
                  onClick={handleSendMessage}
                  className="font-semibold h-[36px] w-[36px] rounded-full transition-colors flex items-center justify-center"
                  style={{
                    backgroundColor:
                      inputMessage.length > 0
                        ? currentTheme["submit-btn-bg"]
                        : currentTheme["secondary-btn-bg"],
                    color:
                      inputMessage.length > 0
                        ? currentTheme["submit-btn-text"]
                        : currentTheme["secondary-btn-text"],
                  }}
                >
                  {inputMessage.length > 0 ? (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M8.99992 16V6.41407L5.70696 9.70704C5.31643 10.0976 4.68342 10.0976 4.29289 9.70704C3.90237 9.31652 3.90237 8.6835 4.29289 8.29298L9.29289 3.29298L9.36907 3.22462C9.76184 2.90427 10.3408 2.92686 10.707 3.29298L15.707 8.29298L15.7753 8.36915C16.0957 8.76192 16.0731 9.34092 15.707 9.70704C15.3408 10.0732 14.7618 10.0958 14.3691 9.7754L14.2929 9.70704L10.9999 6.41407V16C10.9999 16.5523 10.5522 17 9.99992 17C9.44764 17 8.99992 16.5523 8.99992 16Z" />
                    </svg>
                  ) : (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M7.167 15.416V4.583a.75.75 0 0 1 1.5 0v10.833a.75.75 0 0 1-1.5 0Zm4.166-2.5V7.083a.75.75 0 0 1 1.5 0v5.833a.75.75 0 0 1-1.5 0ZM3 11.25V8.75a.75.75 0 0 1 1.5 0v2.5a.75.75 0 0 1-1.5 0Zm12.5 0V8.75a.75.75 0 0 1 1.5 0v2.5a.75.75 0 0 1-1.5 0Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
};

export default ThemeableChatbot;
