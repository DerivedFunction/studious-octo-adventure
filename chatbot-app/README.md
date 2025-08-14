# ChatGPT Token Counter & Context Manager

This browser script enhances the ChatGPT web interface by providing a detailed, real-time token count for conversations. It helps users understand and manage the context window size by analyzing messages, attachments, and custom instructions.

The script is designed to be injected into the ChatGPT page as a content script for a browser extension.

---

## ✨ Features

-   **Real-time Token Analysis:** Calculates and displays the token count for each message in the conversation using the `o200k_base` tokenizer.
-   **Comprehensive Breakdown:** Provides a detailed breakdown of token usage, including:
    -   The current user prompt.
    -   The chat history.
    -   Custom instructions (both user profile and model instructions).
    -   Uploaded files.
    -   Canvases (formerly known as Code Interpreter files).
-   **Interactive Context Management:** Features a hover-activated popup that allows you to selectively include or exclude files and canvases from the token calculation, letting you simulate different context scenarios.
-   **Multi-Canvas Support:** Intelligently parses the conversation's message tree to correctly associate multiple canvases created in a single turn with the final assistant message.
-   **Context Window Visualization:** Shows how the current conversation fits within a user-defined token limit and clearly indicates when and where content is truncated.
-   **Seamless UI Integration:** Injects token counts directly onto message bubbles and adds a summary status to the footer, matching the look and feel of the ChatGPT interface.
-   **Dynamic Theming:** Automatically adapts to both light and dark modes.
-   **Accent Colors:** Pick more than the selected few official accent colors.

---

## 🛠️ How It Works

1.  **Data Fetching:** The script retrieves conversation data from two sources: the browser's IndexedDB for message content and the official `backend-api` for metadata about attachments like files and canvases.
2.  **Tokenization:** It uses the `js-tiktoken` library to accurately count tokens for all text content.
3.  **DOM Injection:** The script dynamically creates and injects HTML elements and CSS into the ChatGPT DOM to display the token counts and the interactive popup.
4.  **State Monitoring:** A `MutationObserver` watches for changes in the conversation (new messages, edits) and triggers a recalculation to keep the token counts up-to-date. All checks are debounced to ensure performance.