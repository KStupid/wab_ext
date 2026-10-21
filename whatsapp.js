// ============================================================================
// WAB Ext — content script (page agent)
//
// v2 role: the batch LOOP no longer lives here. The service worker owns the
// loop (it survives popup closes and worker evictions via persisted state).
// This file now executes exactly ONE recipient per request and keeps a small
// in-memory tracker so the worker's watchdog can recover results after an
// eviction or a broken message channel.
//
// Page-context notes:
// - Timers here belong to the PAGE, so 20–30 s human delays are safe in this
//   context (unlike the service worker, where setTimeout dies with the worker).
// - When this tab is hidden/backgrounded, browsers throttle page timers —
//   delays stretch but still fire; the watchdog's patience accounts for that.
// - If the page reloads, this context (and the tracker) dies — that is
//   EXPECTED and handled by the worker's watchdog, not something to fix here.
// ============================================================================

// Re-injection guard: if utils.js + whatsapp.js are injected again into an
// already-loaded page (e.g. after a failed PING), the guard in utils.js
// prevents a second cleanupOldLogs() call, but we need our own guard here to
// prevent registering a SECOND chrome.runtime.onMessage listener — which would
// cause every batch to be processed twice.
if (globalThis.__WAB_EXT_CONTENT_LOADED__) {
    // Already loaded in this page — skip re-initialization entirely.
    // The existing listener is still active and will handle messages.
    // eslint-disable-next-line no-throw-literal
    throw '__WAB_EXT_CONTENT_LOADED__ guard: skipping duplicate whatsapp.js execution';
}
globalThis.__WAB_EXT_CONTENT_LOADED__ = true;

let contentLastAnnouncedKey = '';
let pageAnnouncer = null;

// In-memory record of the recipient step this page is running / last ran.
// The service worker queries it via GET_STEP_STATUS for crash recovery.
let currentStep = null;

function getPageAnnouncer() {
    if (!pageAnnouncer) {
        ensureStatusAnnouncers();
        pageAnnouncer = createAnnouncer(() => {
            const regions = ensureStatusAnnouncers();
            return { polite: [regions.primary, regions.secondary].filter(Boolean), assertive: [] };
        });
    }
    return pageAnnouncer;
}

function mirrorStatusToPopup(message) {
    try {
        const p = chrome.runtime.sendMessage({ action: 'WAB_STATUS_UPDATE', message: message });
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (error) {
        wabLog('mirror to popup failed (popup closed or context invalidated):', error);
    }
}

// Announce free-form progress (e.g. "Sending message 1 of 3."), deduped,
// spoken in-page (when the WhatsApp tab has focus) AND mirrored to the popup
// (when the popup has focus — Orca only speaks live regions of the focused
// window).
function announceProgress(message, dedupKey) {
    if (!message || dedupKey === contentLastAnnouncedKey) return;
    contentLastAnnouncedKey = dedupKey;
    getPageAnnouncer().announce(message);
    mirrorStatusToPopup(message);
}

async function openWhatsAppChat(phoneNumber) {
    appendLog(`Starting chat open flow for ${maskPhone(phoneNumber)}`);
    const newChatSelectors = [
        'button[aria-label="New chat"]',
        'button[data-tab="2"][aria-label="New chat"]',
        'span[data-testid="new-chat-outline"]',
        'span[data-icon="new-chat-outline"]',
        'div[title="New chat"]',
        'button span[data-testid="new-chat-outline"]',
        'button span[data-icon="new-chat-outline"]'
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
        const newChatElement = await waitForElement(newChatSelectors, 15000);
        const actualButton = newChatElement?.closest('button') || newChatElement;
        if (actualButton) {
            await waitRandomDelay();
            actualButton.click();
            appendLog('Clicked new chat button');
            break;
        }
        if (attempt === 0) {
            appendLog('New chat button not found, retrying...');
            await waitRandomDelay(5000, 10000);
        } else {
            logError('New chat button not found after retry.', 'Missing button');
            return false;
        }
    }

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
    await waitRandomDelay();
    searchInput.focus();
    if (searchInput.tagName === 'INPUT') {
        changeReactInputState(searchInput, phoneNumber);
    } else {
        document.execCommand('insertText', false, phoneNumber);
        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: phoneNumber }));
    }
    appendLog(`Set phone number in search input: ${maskPhone(phoneNumber)}`);
    await waitRandomDelay();
    pressKey(searchInput, 'Enter');
    appendLog('Pressed Enter in the search input');
    return true;
}

// Returns the compose box element on success, null on failure.
// (Old version returned true/false and the caller then re-queried
// `div[contenteditable="true"]`, which can match the SEARCH box instead of the
// compose box — the Enter fallback then went to the wrong element.)
async function writeMessage(message) {
    appendLog(`Starting message write (${String(message || '').length} characters)`);
    const composeSelectors = [
        'div[data-testid="conversation-compose-box-input"][contenteditable="true"]',
        'div[data-testid="conversation-compose-box-input"]',
        'div[role="textbox"][contenteditable="true"][aria-placeholder="Type a message"]',
        'div[contenteditable="true"][aria-placeholder*="Type a message"]',
        'div[contenteditable="true"][data-tab="10"]'
    ];
    const box = await waitForElement(composeSelectors, 15000);
    if (!box) {
        logError('Message box not found. Chat did not load.', 'Missing compose box');
        return null;
    }
    await waitRandomDelay();
    box.focus();
    document.execCommand('insertText', false, message);
    appendLog('Inserted message text into compose box');
    return box;
}

async function sendMessage(composeBox) {
    appendLog('Preparing to send the message');
    const sendBtnSelectors = [
        'button[aria-label="Send"]',
        'span[data-icon="wds-ic-send-filled"]',
        'span[data-icon="send"]',
        'button span[data-icon="send"]'
    ];
    const sendBtn = await waitForElement(sendBtnSelectors, 4000);
    const actualSendBtn = sendBtn?.closest('button') || sendBtn;
    await waitRandomDelay();
    if (actualSendBtn) {
        actualSendBtn.click();
        appendLog('Clicked send button');
        return true;
    }
    if (composeBox) {
        appendLog('Send button not found. Falling back to Enter key press in compose box.');
        pressKey(composeBox, 'Enter');
        return true;
    }
    logError('Send button not found and no compose box provided for fallback.', 'Missing send trigger');
    return false;
}

async function handleWhatsAppMessage({ phone, message }) {
    appendLog(`Processing SEND_MESSAGE for ${maskPhone(phone)}`);

    try {
        const opened = await openWhatsAppChat(phone);
        if (!opened) {
            appendLog('Chat open flow failed.');
            return { success: false };
        }

        // writeMessage returns the compose box element (or null) instead of
        // true/false. Pass it directly to sendMessage so the Enter-key fallback
        // targets the correct element, not a re-queried element that might
        // resolve to the search box.
        const composeBox = await writeMessage(message);
        if (!composeBox) {
            appendLog('Write-message step failed.');
            return { success: false };
        }

        const sent = await sendMessage(composeBox);
        appendLog(`Final send result = ${sent}`);
        return { success: sent };
    } catch (error) {
        logError('Unexpected send flow error.', error);
        return { success: false };
    }
}

// Execute exactly one recipient for the batch orchestrator. Records progress
// in `currentStep` so the worker's watchdog can recover the result via
// GET_STEP_STATUS after a worker eviction or channel drop.
async function handleProcessRecipient({ operationId, index, total, phone, message }) {
    if (!chrome.runtime?.id) {
        console.error('Extension context invalidated — content script is stale. Refresh WhatsApp Web.');
        return { success: false };
    }
    appendLog(`PROCESS_RECIPIENT received: index=${index}/${total - 1} phone=${maskPhone(phone)}`);
    currentStep = { operationId, index, done: false, success: false };
    announceProgress(
        `Sending message ${index + 1} of ${total}.`,
        `${operationId}:progress:${index}`
    );
    const result = await handleWhatsAppMessage({ phone, message });
    const success = !!(result && result.success);
    currentStep = { operationId, index, done: true, success };
    // Regression fix: announce the OUTCOME of each recipient, not just the start.
    // Without this, screen-reader users get ~2 minutes of silence per recipient.
    // Distinct dedupe key (:result:) so it is never suppressed by the :progress: line.
    announceProgress(
        `Message ${index + 1} of ${total} ${success ? 'sent' : 'failed'}.`,
        `${operationId}:result:${index}`
    );
    appendLog(`PROCESS_RECIPIENT done: index=${index} success=${success}`);
    return { success };
}

// Message listener — registered exactly once thanks to the re-injection guard
// at the top of this file.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    appendLog(`Message received: action=${request.action}`);

    if (request.action === 'PROCESS_RECIPIENT') {
        handleProcessRecipient(request).then((result) => {
            appendLog(`PROCESS_RECIPIENT response: success=${result.success}`);
            sendResponse(result);
        });
        return true; // keep channel open for async response
    }

    if (request.action === 'GET_STEP_STATUS') {
        // The worker's watchdog calls this to recover after an eviction.
        const { operationId, index } = request;
        if (
            currentStep &&
            currentStep.operationId === operationId &&
            currentStep.index === index
        ) {
            sendResponse({
                operationId: currentStep.operationId,
                index: currentStep.index,
                done: currentStep.done,
                success: currentStep.success
            });
        } else {
            // Page context is fresh (reloaded) — no record of this step.
            sendResponse({ done: false, missing: true });
        }
        return true;
    }

    if (request.action === 'PING') {
        sendResponse({ ready: true });
        return true;
    }

    if (request.action === 'SEND_MESSAGE') {
        // Single-message path retained for any direct callers.
        handleWhatsAppMessage(request).then((result) => {
            appendLog(`SEND_MESSAGE response: success=${result.success}`);
            sendResponse(result);
        });
        return true;
    }

    appendLog(`Unknown action received: ${request.action}`);
});

// Create the live regions immediately when the content script initializes,
// so they are primed (empty) before the first announcement fires.
ensureStatusAnnouncers();
appendLog('WhatsApp content script loaded and ready for messages');
