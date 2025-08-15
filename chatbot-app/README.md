Supercharge your ChatGPT workflow with a powerful history manager and real-time token counter 🚀. **Organize your chats with custom labels**, instantly search your entire history, and **manage your conversations in bulk**.

This all-in-one tool helps you clean up your workspace, manage what the AI remembers in long conversations, and keep your entire chat history organized and accessible. The extension integrates seamlessly into the ChatGPT UI, giving you the insights and control you need for more accurate and effective interactions.

## ✨ Features

  - 🗂️ **Advanced History Manager:** Search, filter, and **manage your conversations in bulk**. Select multiple chats at once to **archive or delete**, cleaning up your workspace with just a few clicks. No more one-by-one actions\!
  - 🏷️ **Custom Labels:** Tag any conversation with custom labels and colors to organize your chats by project, topic, or priority.
  - ⏱️ **Real-time Token Analysis:** Calculates and displays the token count for each message in the conversation using the `o200k_base` tokenizer.
  - 📊 **Comprehensive Breakdown:** Provides a detailed breakdown of token usage, including:
      - The current user prompt.
      - The chat history.
      - Custom instructions (both user profile and model instructions).
      - Uploaded files.
      - Canvases (formerly known as Code Interpreter files).
  - 🖱️ **Interactive Context Management:** Features a hover-activated popup that allows you to selectively include or exclude files and canvases from the token calculation, letting you simulate different context scenarios.
  - 🖼️ **Multi-Canvas Support:** Intelligently parses the conversation's message tree to correctly associate multiple canvases created in a single turn with the final assistant message.
  - 📏 **Context Window Visualization:** Shows how the current conversation fits within a user-defined token limit and clearly indicates when and where content is truncated.
  - 🧩 **Seamless UI Integration:** Injects UI elements directly into the page, including the history manager, search modal, and token counters, matching the look and feel of the ChatGPT interface.
  - 🌗 **Dynamic Theming:** Automatically adapts to both light and dark modes.
  - 🎨 **Accent Colors:** Pick more than the selected few official accent colors.

-----

## 🛠️ How It Works

1.  **Data Fetching:** The script retrieves conversation data from two sources: the browser's IndexedDB for message content and the official `backend-api` for metadata and management actions like archiving or deleting.
2.  **Local Data Storage:** Securely saves your custom labels and conversation associations in `chrome.storage.local`, keeping your organization system private and browser-synced.
3.  **Tokenization:** It uses the `js-tiktoken` library to accurately count tokens for all text content.
4.  **DOM Injection:** The script dynamically creates and injects UI elements into the ChatGPT DOM to display the history manager, search modal, token counts, and the interactive popup.
5.  **State Monitoring:** A `MutationObserver` watches for changes in the conversation (new messages, edits) and triggers a recalculation to keep all information up-to-date. All checks are debounced to ensure performance.

-----

## How to compile and run

```bash
npm install // install packages
npm run build // build the extension
```

1.  Open `chrome://extensions` and enable developer mode.
2.  Load the `dist` folder as an [unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).