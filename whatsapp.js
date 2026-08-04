const LOG_KEY = 'wab_ext_logs';

function appendLog(message) {
    const entry = `${new Date().toISOString()} | ${message}`;
    console.log(entry);
    try {
        chrome.storage.local.get({ [LOG_KEY]: [] }, (result) => {
            const logs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
            logs.push(entry);
            chrome.storage.local.set({ [LOG_KEY]: logs });
        });
    } catch (error) {
        console.error('Unable to persist log entry:', error);
    }
}

function logError(context, error) {
    appendLog(`${context}: ${error?.message || String(error)}`);
    console.error(context, error);
}

// Default delay range: 20 seconds to 30 seconds
function waitRandomDelay(minDelay = 20_000, maxDelay = 30_000) {
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    return new Promise((resolve) => setTimeout(resolve, delay));
}

// Retries searching for a DOM element across a list of selectors until found or timed out
function waitForElement(selectors, timeout = 5000) {
    const selectorString = Array.isArray(selectors) ? selectors.join(', ') : selectors;

    return new Promise((resolve) => {
        const existing = document.querySelector(selectorString);
        if (existing) return resolve(existing);

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selectorString);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

function changeReactInputState(input, value) {
    if (!input) {
        logError('Target input element is missing.', 'Null input element');
        return false;
    }

    // 1. Native Value Assignment
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
    )?.set;

    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
    } else {
        input.value = value;
    }

    // 2. Dispatch Standard DOM & Input Events (Triggers React 16+ listener delegation)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // 3. Fallback: Search for React props on the input or its ancestor chain
    const targets = [];
    let current = input;
    let depth = 0;

    while (current && depth < 8) {
        targets.push(current);
        current = current.parentElement;
        depth += 1;
    }

    for (const target of targets) {
        const reactPropsKey = Object.keys(target).find(
            (key) => key.startsWith('__reactProps') || key.startsWith('__reactEvents')
        );
        const reactProps = reactPropsKey ? target[reactPropsKey] : null;

        if (typeof reactProps?.onChange === 'function') {
            reactProps.onChange({ target: input, currentTarget: input, type: 'change' });
            break;
        }
    }

    return true;
}

function pressKey(element, key) {
    if (!element) return;
    const keyCode = key === 'Enter' ? 13 : 0;
    const eventOptions = {
        key,
        code: key === 'Enter' ? 'Enter' : key,
        keyCode,
        which: keyCode,
        bubbles: true
    };

    element.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
    element.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
}

async function openWhatsAppChat(phoneNumber) {
    appendLog(`Starting chat open flow for ${phoneNumber}`);

    // Combined selectors for new chat button from both scripts
    const newChatSelectors = [
        'span[data-testid="new-chat-outline"]',
        'span[data-icon="new-chat-outline"]',
        'div[title="New chat"]',
        'button span[data-testid="new-chat-outline"]',
        'button span[data-icon="new-chat-outline"]'
    ];

    const newChatElement = await waitForElement(newChatSelectors, 5000);
    const actualButton = newChatElement?.closest('button') || newChatElement;

    if (!actualButton) {
        logError('New chat button not found.', 'Missing button');
        return false;
    }

    await waitRandomDelay(20_000, 30_000);
    actualButton.click();
    appendLog('Clicked new chat button');

    // Combined selectors for search input from both scripts
    const searchSelectors = [
        'input[aria-label="Search name or number"]',
        'input[role="textbox"][aria-label="Search name or number"]',
        'input[aria-label="Search or start a new chat"]',
        'input[placeholder="Search or start a new chat"]',
        'input[role="textbox"][aria-label="Search or start a new chat"]',
        'div[contenteditable="true"][role="textbox"]',
        'input[role="textbox"][aria-label*="Search"]'
    ];

    const searchInput = await waitForElement(searchSelectors, 6000);

    if (!searchInput) {
        logError('Search input missing after waiting.', 'Timeout waiting for search input');
        return false;
    }

    await waitRandomDelay(20_000, 30_000);
    searchInput.focus();

    if (searchInput.tagName === 'INPUT') {
        changeReactInputState(searchInput, phoneNumber);
    } else {
        // Contenteditable search box handling
        document.execCommand('insertText', false, phoneNumber);
        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: phoneNumber }));
    }

    appendLog(`Set phone number in search input: ${phoneNumber}`);

    await waitRandomDelay(20_000, 30_000);
    pressKey(searchInput, 'Enter');
    appendLog('Pressed Enter in the search input');

    return true;
}

async function writeMessage(message) {
    appendLog(`Starting message write for: ${message}`);

    // Combined selectors for compose box from both scripts
    const composeSelectors = [
        'div[data-testid="conversation-compose-box-input"][contenteditable="true"]',
        'div[data-testid="conversation-compose-box-input"]',
        'div[role="textbox"][contenteditable="true"][aria-placeholder="Type a message"]',
        'div[contenteditable="true"][aria-placeholder*="Type a message"]',
        'div[contenteditable="true"][data-tab="10"]'
    ];

    const box = await waitForElement(composeSelectors, 6000);

    if (!box) {
        logError('Message box not found. Chat did not load.', 'Missing compose box');
        return false;
    }

    await waitRandomDelay(20_000, 30_000);
    box.focus();
    document.execCommand('insertText', false, message);
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
    appendLog('Inserted message text into compose box');
    return true;
}

async function sendMessage(composeBox) {
    appendLog('Preparing to send the message');

    // Combined selectors for send button from both scripts
    const sendBtnSelectors = [
        'button[aria-label="Send"]',
        'span[data-icon="wds-ic-send-filled"]',
        'span[data-icon="send"]',
        'button span[data-icon="send"]'
    ];

    const sendBtn = await waitForElement(sendBtnSelectors, 4000);
    const actualSendBtn = sendBtn?.closest('button') || sendBtn;

    await waitRandomDelay(20_000, 30_000);

    if (actualSendBtn) {
        actualSendBtn.click();
        appendLog('Clicked send button');
        return true;
    }

    // Fallback submission via KeyboardEvent if Send button is hidden
    if (composeBox) {
        appendLog('Send button not found. Falling back to Enter key press in compose box.');
        pressKey(composeBox, 'Enter');
        return true;
    }

    logError('Send button not found and no compose box provided for fallback.', 'Missing send trigger');
    return false;
}

async function handleWhatsAppMessage({ phone, message }) {
    appendLog(`Popup requested SEND_MESSAGE for ${phone}`);

    try {
        const opened = await openWhatsAppChat(phone);
        if (!opened) {
            appendLog('Chat open flow failed.');
            return { success: false };
        }

        const wrote = await writeMessage(message);
        if (!wrote) {
            appendLog('Write-message step failed.');
            return { success: false };
        }

        // Re-query or pass compose box as fallback trigger for sendMessage
        const composeBox = document.querySelector('div[contenteditable="true"]');
        const sent = await sendMessage(composeBox);
        appendLog(`Final send result = ${sent}`);
        return { success: sent };
    } catch (error) {
        logError('Unexpected send flow error.', error);
        return { success: false };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SEND_MESSAGE') {
        handleWhatsAppMessage(request).then((result) => {
            sendResponse(result);
        });
        return true;
    }
});