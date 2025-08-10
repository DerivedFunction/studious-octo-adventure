/* eslint-disable no-undef */
import { useState, useEffect, useRef } from "react";
import chatgpt from "../assets/chatgpt.png"; // Assuming you have this asset locally

// Helper to get initial dark mode preference from chrome.storage or system settings
const getInitialDarkMode = (callback) => {
  try {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(["isDarkMode"], (result) => {
        if (result.isDarkMode !== undefined) {
          callback(result.isDarkMode);
        } else {
          callback(
            window.matchMedia &&
              window.matchMedia("(prefers-color-scheme: dark)").matches
          );
        }
      });
    } else {
      // Fallback for non-extension environment
      callback(
        window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    }
  } catch (error) {
    console.error("Error getting initial dark mode:", error);
    callback(false); // Default to light mode on error
  }
};

const ThemeableChatbot = () => {
  // --- STATE MANAGEMENT ---
  const [messages, setMessages] = useState([
    { id: 1, type: "user", content: "Hello, who are you?" },
    {
      id: 2,
      type: "ai",
      content:
        "Choose a theme. Select text. Supporting light and dark modes!",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [themeColor, setThemeColor] = useState("#0285FF");
  const [themeColors, setThemeColors] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const chatContainerRef = useRef(null);
  const textareaRef = useRef(null);

  // --- COLOR CONVERSION UTILITIES ---
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

  // --- THEME GENERATION LOGIC ---
  const getThemeColors = (mainColorHex, isDark) => {
    const hsl = hexToHsl(mainColorHex);
    const rgb = hexToRgb(mainColorHex);
    if (!rgb) return null;

    const { h, s, l } = hsl;

    if (isDark) {
      const submitBtnText = l * 0.8 > 65 ? "#000000" : "#ffffff";
      return {
        isDark,
        primary: mainColorHex,
        submitBtnBg: `hsl(${h}, ${s}%, ${l * 0.8}%)`,
        submitBtnText,
        userBg: `hsl(${h}, ${s}%, ${l * 0.5}%)`,
        userText: `hsl(${h}, ${s}%, 98%)`,
        secondaryBtnBg: `hsl(${h}, ${s}%, ${l * 0.6}%)`,
        selectionBg: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`,
        bodyBg: "#18181b",
        headerText: "#f4f4f5",
        aiMsgBg: "#303033",
        aiMsgText: "#f4f4f5",
        inputBg: "#18181b",
        inputText: "#f4f4f5",
        inputBorder: "#52525b",
      };
    } else {
      const submitBtnText = l > 65 ? "#000000" : "#ffffff";
      return {
        isDark,
        primary: mainColorHex,
        submitBtnBg: mainColorHex,
        submitBtnText,
        userBg: `hsl(${h}, ${s}%, 95%)`,
        userText: `hsl(${h}, 100%, 15%)`,
        secondaryBtnBg: `hsl(${h}, ${s}%, 95%)`,
        selectionBg: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`,
        bodyBg: "#ffffff",
        headerText: "#18181b",
        aiMsgBg: "#f1f2f3",
        aiMsgText: "#18181b",
        inputBg: "#ffffff",
        inputText: "#18181b",
        inputBorder: "#d4d4d8",
      };
    }
  };

  // --- SIDE EFFECTS ---

  // Initialize theme and dark mode from storage on first load
  useEffect(() => {
    getInitialDarkMode(setIsDarkMode);
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get(["themeColor"], (result) => {
          if (result.themeColor) {
            setThemeColor(result.themeColor);
          }
        });
      }
    } catch (error) {
      console.error("Error reading from chrome.storage on init:", error);
    }
  }, []);

  // Update theme colors and save to storage when dependencies change
  useEffect(() => {
    const newThemeColors = getThemeColors(themeColor, isDarkMode);
    setThemeColors(newThemeColors);

    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ themeColor, isDarkMode });
      }
    } catch (error) {
      console.error("Error writing to chrome.storage:", error);
    }
  }, [themeColor, isDarkMode]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
      setIsMultiLine(textarea.scrollHeight > textarea.clientHeight); // Check if content wraps
    }
  }, [inputMessage]);

  // --- EVENT HANDLERS ---
  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    const newMessage = {
      id: Date.now(),
      type: "user",
      content: inputMessage.trim(),
    };
    setMessages((prev) => [...prev, newMessage]);
    setInputMessage("");

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

  // --- RENDER LOGIC ---
  if (!themeColors) {
    return (
      <div className="flex items-center justify-center h-screen">
        Loading...
      </div>
    );
  }

  const DynamicGlobalStyles = () => (
    <style>{`
      .theme-root {
        --submit-btn-bg: ${themeColors.submitBtnBg};
        --submit-btn-text: ${themeColors.submitBtnText};
        --user-msg-bg: ${themeColors.userBg};
        --user-msg-text: ${themeColors.userText};
        --body-bg: ${themeColors.bodyBg};
        --header-text: ${themeColors.headerText};
        --ai-msg-bg: ${themeColors.aiMsgBg};
        --ai-msg-text: ${themeColors.aiMsgText};
        --input-bg: ${themeColors.inputBg};
        --input-text: ${themeColors.inputText};
        --input-border: ${themeColors.inputBorder};
      }
      ::selection { background-color: ${themeColors.selectionBg}; }
      ::-moz-selection { background-color: ${themeColors.selectionBg}; }
      
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
          className="theme-root w-full h-full mx-auto shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] flex flex-col transition-colors duration-300"
          style={{ backgroundColor: "var(--body-bg)" }}
        >
          {/* Header */}
          <header
            className="flex items-center justify-between p-4 border-b transition-colors duration-300"
            style={{ borderColor: "var(--input-border)" }}
          >
            <img src={chatgpt} width={24} height={24} alt="ChatGPT Logo" />
            <h1
              className="text-xl font-bold m-0"
              style={{ color: "var(--header-text)" }}
            >
              Accent Color Override
            </h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <label
                  htmlFor="theme-color-picker"
                  className="text-sm font-medium"
                  style={{ color: "var(--header-text)" }}
                >
                  Theme:
                </label>
                <input
                  type="color"
                  id="theme-color-picker"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="w-8 h-8 p-0 bg-transparent border-none rounded-md cursor-pointer"
                />
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

          {/* Chat Area */}
          <main
            ref={chatContainerRef}
            className="flex-1 p-6 overflow-y-auto min-h-[450px] flex flex-col gap-6"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 items-start ${
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
                          ? themeColors.userBg
                          : "var(--ai-msg-bg)",
                      color:
                        msg.type === "user"
                          ? themeColors.userText
                          : "var(--ai-msg-text)",
                    }}
                  >
                    <p className="m-0 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              </div>
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

          {/* Footer */}
          <footer className="p-4">
            <div
              className={`flex items-center gap-4 border p-1 rounded-[28px] w-full shadow-md transition-colors duration-300`}
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
              <div className={`pr-1 ${isMultiLine ? "self-end" : ""}`}>
                <button
                  onClick={handleSendMessage}
                  className="font-semibold h-[36px] w-[36px] rounded-full transition-colors flex items-center justify-center"
                  style={{
                    backgroundColor:
                      inputMessage.length > 0
                        ? themeColors.primary
                        : themeColors.userBg,
                    color:
                      inputMessage.length > 0 ? "white" : themeColors.userText,
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
