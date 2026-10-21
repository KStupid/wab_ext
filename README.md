# WAB Ext — WhatsApp Web bulk sender for screen-reader users

WAB Ext is a browser extension for [WhatsApp Web](https://web.whatsapp.com) that sends one message to many phone numbers without saving contacts.

It was built primarily for blind and low-vision users, so the UI and announcements are designed around keyboard use and screen readers such as Orca and NVDA. A sighted user can use it too, but accessibility is the first-class goal, not an afterthought.

## What it does

- Opens a chat on WhatsApp Web by phone number (no contact needed).
- Types the message and sends it.
- Repeats for each number in a comma-separated list, one after another.
- Speaks progress to screen-reader users while the batch runs, even if the popup is closed and reopened later.

## Why the delays are slow

Between steps the extension waits on the order of tens of seconds, and between recipients it waits again. This is intentional:

- It behaves more like a human than a script.
- It reduces the chance of sending too fast.

That also means a batch of several numbers can take a while. This is a known tradeoff and is part of the design.

## Keyboard shortcut

Open the popup with **Alt+W** (configurable in your browser's extension shortcut settings).

## Installation

This is a browser extension project. To try it from source:

1. Open the extension management page for your browser:
   - Chrome/Edge/Brave: `chrome://extensions`
   - Firefox: `about:debugging` → "This Firefox" → "Load Temporary Add-on"
2. Enable developer mode if your browser has it.
3. Load the folder containing this project as an unpacked extension (Chrome family) or load `manifest.json` as a temporary add-on (Firefox).
4. Pin or otherwise make the extension easy to reach, then open WhatsApp Web in a tab.

Exactly how you load an unpacked extension depends on the browser and version. If you publish this to the Chrome Web Store or Firefox Add-ons, follow that store's packaging and review process instead of loading from source.

## How to use

1. Open WhatsApp Web in the active tab.
2. Open the extension popup with **Alt+W**.
3. Enter one or more phone numbers, separated by commas.
4. Type the message.
5. Choose **Send Message**, or press **Ctrl+Enter**.

The popup announces what it is doing. You can close the popup during a batch and reopen it later to hear progress or the final result.

## Accessibility

This extension targets screen-reader users. A few of the things that matter for that audience:

- Form fields are real `<label>` + input/textarea pairs.
- Status changes are announced through ARIA live regions.
- The popup uses visually-hidden live regions and a serialized announcer so repeated progress is not dropped or double-spoken by Orca.
- There is a cancel button for stopping a batch.
- Focus is managed so the popup can open, announce, and let the user continue without losing their place in the form unnecessarily.

Accessibility is the main reason this extension exists. If something in the screen-reader experience is broken, that is a high-priority issue.

## Architecture (short)

- **popup** — the small panel the user interacts with. It validates input, hands the batch to the background worker, and mirrors announcements.
- **background service worker** — owns the batch loop as a resumable state machine, so a batch can survive the popup closing, worker eviction, and some tab-reload situations.
- **content script** — runs in the WhatsApp Web page and performs the actual DOM automation for one recipient at a time.

The content script is re-injected only as needed, and the worker keeps a watchdog so a batch does not silently die if the worker is evicted between recipients.

## Limitations and known behavior

- The extension works against WhatsApp Web's current DOM. If WhatsApp Web changes its markup, selectors may need updating.
- Phone numbers are entered as text and used to open chats on WhatsApp Web. The extension does not verify whether a number is registered on WhatsApp before sending.
- Pacing is intentionally slow. If you need faster sends, that is a design decision to reconsider rather than a bug to flip off.
- The update-check path in the current codebase is a placeholder. For now, updates are manual unless a real update source is wired in.
- This is automation against a live messaging service. Use it responsibly and only for recipients who expect the message.

## Privacy and security

Phone numbers and messages are sensitive. A few notes about how this extension handles that:

- Logs keep a masked form of phone numbers rather than the full number.
- Raw phone numbers and message text are stored only while a batch is running and are removed when the batch finishes.
- The extension runs only against `https://web.whatsapp.com` per its manifest host permissions.
- As with any extension that automates a logged-in service, install only from a source you trust and review the code if you can.

## Project status

This is a personal project with a strong accessibility focus. It is functional for its intended use case, but it is not a commercial product and it is not guaranteed to keep working if WhatsApp Web changes.

## Contributing

If you want to contribute, the most useful things are:

- Testing with a real screen reader and reporting what breaks.
- Keeping the WhatsApp Web selectors current when the site changes.
- Improving the popup's keyboard and announcement behavior.
- Updating documentation if anything here is wrong or outdated.

Before sending a PR, please check that the change does not make the screen-reader experience worse. That is the point of this project.

## License

This project does not yet have a chosen license. If you want to reuse or redistribute it, check the repository for a license file or ask the maintainer before doing so.
