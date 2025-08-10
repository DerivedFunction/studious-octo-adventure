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
    { id: 1, type: "user", content: "Hello, who are you?" },
    {
      id: 2,
      type: "ai",
      content:
        "Choose a theme. If you pick a very dark color, the theme will adjust to neutral grays.",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [themeColor, setThemeColor] = useState("#0285FF");
  const [themeObject, setThemeObject] = useState(null); // Will hold { light: {...}, dark: {...} }
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const chatContainerRef = useRef(null);
  const textareaRef = useRef(null);

  // --- COLOR CONVERSION UTILITIES ---

  const hslToHex = (h, s, l) => {
    l /= 100;
    const a = (s * Math.min(l, 1 - l)) / 100;
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, "0"); // Convert to Hex and pad with a zero if needed
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

  // --- THEME GENERATION LOGIC ---
  const generateFullThemeObject = (mainColorHex) => {
    const hsl = hexToHsl(mainColorHex);
    const rgb = hexToRgb(mainColorHex);
    if (!rgb) return null;

    const { h, s, l } = hsl;

    // Check if the color is very dark (near black) to switch to neutral colors
    const isNearBlack = l < 15;
    // Check if the color is desaturated (grey)
    const isGrey = s < 20;

    // Light Mode Palette
    const lightTheme = {
      primary: mainColorHex,
      "submit-btn-bg": mainColorHex,
      "submit-btn-text": l > 65 ? "#000000" : "#ffffff",
      "user-msg-bg": isNearBlack ? `hsl(0, 0%, 95%)` : `hsl(${h}, ${s}%, 95%)`,
      "user-msg-text":
        isNearBlack || isGrey ? `hsl(0, 0%, 15%)` : `hsl(${h}, 100%, 15%)`,
      "secondary-btn-bg": isNearBlack
        ? `hsl(0, 0%, 95%)`
        : `hsl(${h}, ${s}%, 95%)`,
      "secondary-btn-text":
        isNearBlack || isGrey ? `hsl(0, 0%, 15%)` : `hsl(${h}, 100%, 15%)`,
      "user-selection-bg": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`,
      bodyBg: "#ffffff",
      headerText: "#18181b",
      aiMsgBg: "transparent",
      aiMsgText: "#18181b",
      inputBg: "#ffffff",
      inputText: "#18181b",
      inputBorder: "#d4d4d8",
    };

    // Dark Mode Palette
    const darkTheme = {
      primary: mainColorHex,
      "submit-btn-bg": mainColorHex,
      "submit-btn-text": l > 65 ? "#000000" : "#ffffff",
      "user-msg-bg": isNearBlack
        ? `hsl(0, 0%, 20%)`
        : `hsl(${h}, ${s}%, ${l * 0.5}%)`,
      "user-msg-text":
        isNearBlack || isGrey ? `hsl(0, 0%, 98%)` : `hsl(${h}, ${s}%, 98%)`,
      "secondary-btn-bg": isNearBlack
        ? `hsl(0, 0%, 25%)`
        : `hsl(${h}, ${s}%, ${l * 0.6}%)`,
      "secondary-btn-text":
        isNearBlack || isGrey ? `hsl(0, 0%, 98%)` : `hsl(${h}, ${s}%, 98%)`,
      "user-selection-bg": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`,
      bodyBg: "#18181b",
      headerText: "#f4f4f5",
      aiMsgBg: "transparent",
      aiMsgText: "#f4f4f5",
      inputBg: "#18181b",
      inputText: "#f4f4f5",
      inputBorder: "#52525b",
    };

    return { light: lightTheme, dark: darkTheme };
  };

  // --- SIDE EFFECTS ---
  useEffect(() => {
    getInitialDarkMode(setIsDarkMode);
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get(["themeColor"], (result) => {
          if (result.themeColor) setThemeColor(result.themeColor);
        });
      }
    } catch (error) {
      console.error("Error reading from chrome.storage on init:", error);
    }
  }, []);

  useEffect(() => {
    const newThemeObject = generateFullThemeObject(themeColor);
    setThemeObject(newThemeObject);
    try {
      if (chrome?.storage?.local && newThemeObject) {
        chrome.storage.local.set({
          themeColor,
          isDarkMode,
          themeObject: newThemeObject,
        });
      }
    } catch (error) {
      console.error("Error writing to chrome.storage:", error);
    }
  }, [themeColor, isDarkMode]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      setIsMultiLine(textarea.value.length > 110);
    }
  }, [inputMessage]);

  // --- EVENT HANDLERS ---
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
    const newColorHex = e.target.value;
    const hsl = hexToHsl(newColorHex);

    // If the lightness is greater than 70, cap it at 70.
    if (hsl.l > 70) {
      hsl.l = 70;
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
        --body-bg: ${currentTheme.bodyBg};
        --header-text: ${currentTheme.headerText};
        --ai-msg-bg: ${currentTheme.aiMsgBg};
        --ai-msg-text: ${currentTheme.aiMsgText};
        --input-bg: ${currentTheme.inputBg};
        --input-text: ${currentTheme.inputText};
        --input-border: ${currentTheme.inputBorder};
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
          className="theme-root w-full h-full mx-auto shadow-lg flex flex-col transition-colors duration-300"
          style={{ backgroundColor: "var(--body-bg)" }}
        >
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
                  onChange={handleColorChange}
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
          <main
            ref={chatContainerRef}
            className="flex-1 p-6 overflow-y-auto min-h-0 flex flex-col gap-6"
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
                          ? "var(--user-msg-bg)"
                          : "var(--ai-msg-bg)",
                      color:
                        msg.type === "user"
                          ? "var(--user-msg-text)"
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
          <footer className="p-4">
            <div
              className={`flex items-center gap-4 border p-1 rounded-[28px] w-full shadow-md transition-colors duration-300 ${isMultiLine ? "flex-col" : "flex-row"}`}
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
