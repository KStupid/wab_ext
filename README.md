# WAB Ext — WhatsApp Web bulk sender for screen-reader users

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](manifest.json)
[![Manifest V3](https://img.shields.io/badge/Manifest%20V3-enabled-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Accessibility](https://img.shields.io/badge/accessibility-focus-brightgreen.svg)](https://webaim.org/)

WAB Ext is a browser extension for [WhatsApp Web](https://web.whatsapp.com) that sends one message to many phone numbers without saving contacts.

It was built primarily for blind and low-vision users, so the UI and announcements are designed around keyboard use and screen readers such as Orca and NVDA. A sighted user can use it too, but accessibility is the first-class goal, not an afterthought.

---

## What it does

- Opens a chat on WhatsApp Web by phone number (no contact needed)
- Types the message and sends it
- Repeats for each number in a comma-separated list, one after another
- Speaks progress to screen-reader users while the batch runs, even if the popup is closed and reopened later

## Why the delays are slow

Between steps the extension waits on the order of tens of seconds, and between recipients it waits again. This is intentional:

- It behaves more like a human than a script
- It reduces the chance of sending too fast

That also means a batch of several numbers can take a while. This is a known tradeoff and is part of the design.

## Keyboard shortcut

Open the popup with **Alt+W** (configurable in your browser's extension shortcut settings).

---

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

### Quick key reference

| Key | Action |
|-----|--------|
| **Alt+W** | Open/close the popup |
| **Ctrl+Enter** | Send the message |
| **Esc** | Close the popup |

## Accessibility

This extension targets screen-reader users. A few of the things that matter for that audience:

- Form fields are real `<label>` + input/textarea pairs
- Status changes are announced through ARIA live regions
- The popup uses visually-hidden live regions and a serialized announcer so repeated progress is not dropped or double-spoken by Orca
- There is a cancel button for stopping a batch
- Focus is managed so the popup can open, announce, and let the user continue without losing their place in the form unnecessarily

**Critical:** If something in the screen-reader experience is broken, that is a high-priority issue.

## Architecture (short)

- **popup** — the small panel the user interacts with. It validates input, hands the batch to the background worker, and mirrors announcements.
- **background service worker** — owns the batch loop as a resumable state machine, so a batch can survive the popup closing, worker eviction, and some tab-reload situations.
- **content script** — runs in the WhatsApp Web page and performs the actual DOM automation for one recipient at a time.

The content script is re-injected only as needed, and the worker keeps a watchdog so a batch does not silently die if the worker is evicted between recipients.

## Limitations and known behavior

| Limitation | Details |
|------------|---------|
| DOM changes | Works against WhatsApp Web's current markup. If WhatsApp Web changes, selectors may need updating. |
| Phone number verification | Numbers are entered as text to open chats. The extension does not verify whether a number is registered on WhatsApp before sending. |
| Pacing | Intentionally slow. If you need faster sends, that is a design decision to reconsider. |
| Update checks | The update-check path is a placeholder. For now, updates are manual unless a real update source is wired in. |
| Responsible use | This is automation against a live messaging service. Use it responsibly and only for recipients who expect the message. |

## Privacy and security

- Phone numbers and messages are sensitive. Logs keep a masked form of phone numbers rather than the full number.
- Raw phone numbers and message text are stored only while a batch is running and are removed when the batch finishes.
- The extension runs only against `https://web.whatsapp.com` per its manifest host permissions.
- As with any extension that automates a logged-in service, install only from a source you trust and review the code if you can.

## Project status

This is a personal project with a strong accessibility focus. It is functional for its intended use case, but it is not a commercial product and it is not guaranteed to keep working if WhatsApp Web changes.

## Contributing

If you want to contribute, the most useful things are:

- Testing with a real screen reader and reporting what breaks
- Keeping the WhatsApp Web selectors current when the site changes
- Improving the popup's keyboard and announcement behavior
- Updating documentation if anything here is wrong or outdated

**Before sending a PR, please check that the change does not make the screen-reader experience worse.** That is the point of this project.

A few ways to contribute:

1. **Accessibility testing** — Use Orca, NVDA, or VoiceOver and report any issues
2. **Selector maintenance** — WhatsApp Web changes frequently; help keep selectors updated
3. **Keyboard flow** — Improve focus management and announcement timing
4. **Documentation** — Fix typos, add examples, improve formatting

Please open an issue first to discuss your intended changes, or submit a PR with a clear description.

## License

This project is licensed under the [MIT License](LICENSE). See the LICENSE file for details.

Copyright (c) 2026 Karan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Footer

Built with ❤️ for the accessibility community. <br>
Questions? Open an issue or reach out on the discussion forum.