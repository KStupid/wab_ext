// ============================================================================
// WAB Ext — popup (v2: thin remote control)
//
// The popup no longer drives or awaits the batch. It:
//   1. validates inputs,
//   2. hands the batch to the service worker (START_BATCH) and gets a fast ack,
//   3. announces live progress mirrored from the worker/content script,
//   4. can be CLOSED AT ANY TIME — reopening catches up from storage
//      (rehydrateOperationState + polling) and speaks the final result.
// Live-region mechanics (delayed first announcement, serialized announcer,
// mirror de-dupe) are unchanged from the Orca fix.
// ============================================================================

const OPENED_AT = Date.now();
// Orca needs a moment to attach to a freshly opened popup panel; the first
// announcement is held until this delay has elapsed since open.
const INITIAL_ANNOUNCE_DELAY_MS = 700;
// The worker writes a heartbeat to the operation state on every watchdog tick
// (≤ ~1 min), so a running batch with no update for 3 min is genuinely dead.
const OPERATION_STALE_MS = 3 * 60 * 1000;
const RECENT_RESULT_WINDOW_MS = 90 * 1000;
const OPERATION_POLL_MS = 2500;
const MIRROR_DEDUP_WINDOW_MS = 5000;

// Status colors chosen for WCAG AA contrast on white.
const STATUS_COLORS = {
    blue: '#0b4fc4',
    green: '#0b6e2f',
    orange: '#8a5300',
    red: '#b00020',
    black: '#111111'
};

let announcer = null;
let updateCheckComplete = false;
let isStarting = false;
let operationPollTimer = null;
let lastMirror = { text: '', at: 0 };

function getPopupRegions() {
    const polite = ['status-announcer', 'status-announcer-2']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    const assertive = ['error-announcer']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    return { polite, assertive };
}

function setVisibleStatus(message, colorKey) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = STATUS_COLORS[colorKey] || colorKey || STATUS_COLORS.black;
}

function announce(message, options = {}) {
    if (!message) return Promise.resolve();
    setVisibleStatus(message, options.color || 'black');
    if (!announcer) announcer = createAnnouncer(getPopupRegions);
    return announcer.announce(message, {
        priority: options.priority || 'polite',
        minDelay: options.minDelay || 0,
        force: options.force === true
    });
}

// The worker and content script mirror announcements to the popup; this stops
// the popup speaking the identical sentence a second time from its own path.
function announceUnlessRecentlyMirrored(message, options = {}) {
    if (lastMirror.text === message && (Date.now() - lastMirror.at) < MIRROR_DEDUP_WINDOW_MS) {
        wabLog('skipping duplicate of mirrored announcement:', message);
        return Promise.resolve();
    }
    return announce(message, options);
}

function updateStatus(message, color = 'black') {
    return announce(message, { color: color });
}

function setSendEnabled(enabled) {
    const sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) return;
    sendBtn.disabled = !enabled;
    if (enabled) {
        sendBtn.removeAttribute('aria-disabled');
    } else {
        sendBtn.setAttribute('aria-disabled', 'true');
    }
}

function showCancelButton(visible) {
    const cancelBtn = document.getElementById('cancelBtn');
    if (!cancelBtn) return;
    cancelBtn.hidden = !visible;
    if (!visible) cancelBtn.disabled = false;
}

function showFormError(text, focusTarget, flags = {}) {
    const formError = document.getElementById('form-error');
    if (formError) formError.textContent = text;
    const phoneInput = document.getElementById('phone');
    const messageInput = document.getElementById('message');
    if (phoneInput) phoneInput.setAttribute('aria-invalid', flags.phoneInvalid ? 'true' : 'false');
    if (messageInput) messageInput.setAttribute('aria-invalid', flags.messageInvalid ? 'true' : 'false');
    if (focusTarget) focusTarget.focus();
}

function clearFormErrors() {
    const formError = document.getElementById('form-error');
    if (formError) formError.textContent = '';
    const phoneInput = document.getElementById('phone');
    const messageInput = document.getElementById('message');
    if (phoneInput) phoneInput.removeAttribute('aria-invalid');
    if (messageInput) messageInput.removeAttribute('aria-invalid');
}

async function checkForUpdatesOnLoad() {
    const initialDelay = Math.max(0, OPENED_AT + INITIAL_ANNOUNCE_DELAY_MS - Date.now());
    try {
        const status = await getUpdateStatus();
        if (status.hasUpdate) {
            const message = `Update available${status.message ? ': ' + status.message : ''}. Please update the extension and restart.`;
            announce(message, { color: 'orange', priority: 'assertive', minDelay: initialDelay });
            setSendEnabled(false);
            appendLog('Extension update available. Send button disabled.');
            return false;
        }
        announce('WhatsApp message sender is ready.', { minDelay: initialDelay });
        appendLog('Update check complete. No updates available.');
        return true;
    } catch (error) {
        console.error('Error checking updates:', error);
        appendLog(`Update check error: ${error.message}`);
        announce('WhatsApp message sender is ready.', { minDelay: initialDelay });
        return true;
    }
}

// Catch-up for a batch that is running (or just finished) while this popup was
// closed — the common case now that the worker owns the loop.
async function rehydrateOperationState() {
    const op = await getOperationState();
    if (!op || !op.updatedAt) return;
    const age = Date.now() - op.updatedAt;
    if (op.state === 'completed') {
        if (age <= RECENT_RESULT_WINDOW_MS && op.resultMessage) {
            announceUnlessRecentlyMirrored(`Last send result: ${op.resultMessage}`, {
                color: op.failed > 0 ? 'orange' : 'green'
            });
        }
        return;
    }
    if (op.state === 'running' && age <= OPERATION_STALE_MS) {
        const progress = `${op.sent || 0} of ${op.total || 0} sent so far.`;
        announce(`A send is already in progress. ${progress} It continues in the background even if this window closes.`, {
            color: 'blue',
            priority: 'assertive'
        });
        setSendEnabled(false);
        showCancelButton(true);
        startOperationPolling();
    }
}

function stopOperationPolling() {
    if (operationPollTimer !== null) {
        clearInterval(operationPollTimer);
        operationPollTimer = null;
    }
}

function startOperationPolling() {
    stopOperationPolling();
    operationPollTimer = setInterval(async () => {
        const op = await getOperationState();
        if (op && op.state === 'completed') {
            stopOperationPolling();
            setSendEnabled(true);
            showCancelButton(false);
            if (op.resultMessage) {
                announceUnlessRecentlyMirrored(op.resultMessage, {
                    color: op.failed > 0 ? 'orange' : 'green',
                    priority: op.failed > 0 ? 'assertive' : 'polite'
                });
            }
        } else if (!op || !op.updatedAt || (Date.now() - op.updatedAt) > OPERATION_STALE_MS) {
            // No heartbeat for 3 minutes — the worker watchdog itself is gone
            // (e.g. browser restarted mid-batch and resume failed).
            stopOperationPolling();
            setSendEnabled(true);
            showCancelButton(false);
            announce('The running batch stopped reporting and may have been interrupted. Please check WhatsApp Web and try again if needed.', {
                color: 'red',
                priority: 'assertive'
            });
        }
    }, OPERATION_POLL_MS);
}

async function initializePopup() {
    updateCheckComplete = false;
    // Focus the phone field early so Orca locks onto the popup document; the
    // first announcement is delayed so it lands AFTER the reader attached.
    setTimeout(() => {
        const phoneInput = document.getElementById('phone');
        if (phoneInput) phoneInput.focus();
    }, 120);
    const canProceed = await checkForUpdatesOnLoad();
    updateCheckComplete = true;
    if (canProceed) {
        await rehydrateOperationState();
    }
}

function parsePhoneNumbers(input) {
    const normalized = input
        .split(',')
        .map((item) => item.replace(/[^0-9]/g, ''))
        .filter((item) => item.length >= 7 && item.length <= 15);
    return [...new Set(normalized)];
}

// Validate, then hand the whole batch to the service worker. This function
// returns as soon as the worker ACKs — no long await, no dependency on this
// popup staying open.
async function sendMessageFromPopup() {
    if (isStarting) {
        wabLog('start already in flight, ignoring extra click');
        return;
    }
    const phoneInput = document.getElementById('phone');
    const messageInput = document.getElementById('message');
    if (!phoneInput || !messageInput) {
        announce('Unable to find the input fields. Please try reopening the extension.', { color: 'red', priority: 'assertive' });
        appendLog('Error: Input elements not found in popup');
        return;
    }
    clearFormErrors();
    const phones = parsePhoneNumbers(phoneInput.value);
    const message = messageInput.value.trim();
    if (phones.length === 0 || !message) {
        const errorText = 'Please enter at least one valid phone number and a message.';
        showFormError(errorText, phones.length === 0 ? phoneInput : messageInput, {
            phoneInvalid: phones.length === 0,
            messageInvalid: !message
        });
        announce(errorText, { color: 'red', priority: 'assertive' });
        return;
    }

    isStarting = true;
    setSendEnabled(false);
    const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
        const api = storageApi();
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];
        if (!tab?.url?.includes('web.whatsapp.com')) {
            announce('Please open WhatsApp Web in the active tab first.', { color: 'red', priority: 'assertive' });
            appendLog('WhatsApp Web tab not found');
            return;
        }
        const ack = await api.runtime.sendMessage({
            action: 'START_BATCH',
            operationId: operationId,
            tabId: tab.id,
            phones: phones,
            message: message
        });
        if (!ack || !ack.ok) {
            announce((ack && ack.error) || 'Unable to start the batch. Please try again.', { color: 'red', priority: 'assertive' });
            return;
        }
        const word = phones.length === 1 ? 'message' : 'messages';
        appendLog(`Batch ${operationId} handed to service worker (${phones.length} recipient(s))`);
        announce(`Batch started. Sending ${phones.length} ${word}. You can close this window and reopen it any time to hear progress.`, { color: 'blue' });
        showCancelButton(true);
        startOperationPolling();
    } catch (error) {
        console.error('Unable to start batch:', error);
        appendLog(`Start batch error: ${error.message}`);
        announce('Unable to reach the extension background worker. Please try again.', { color: 'red', priority: 'assertive' });
    } finally {
        isStarting = false;
        // Keep Send disabled only while a batch is actually running; polling
        // re-enables it when the batch completes.
        const op = await getOperationState();
        if (!op || op.state !== 'running') setSendEnabled(true);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    announcer = createAnnouncer(getPopupRegions);
    initializePopup();

    const closeBtn = document.getElementById('closeBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.close();
        });
    }

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', async () => {
            if (!updateCheckComplete) {
                updateStatus('Please wait while the extension initializes.', 'blue');
                return;
            }
            const status = await getUpdateStatus();
            if (status.hasUpdate) {
                updateStatus('An extension update is required. Please update and restart before sending.', 'red');
                return;
            }
            await sendMessageFromPopup();
        });
    }

    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
            cancelBtn.disabled = true;
            try {
                await storageApi().runtime.sendMessage({ action: 'CANCEL_BATCH' });
            } catch (error) {
                wabLog('cancel request failed:', error);
            }
            // The worker stops after the in-flight recipient finishes (a page
            // step cannot be aborted mid-click); polling picks up the result.
            announce('Cancelling. The batch will stop after the current message finishes.', { color: 'orange' });
        });
    }

    // Ctrl+Enter sends from anywhere in the popup.
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            const btn = document.getElementById('sendBtn');
            if (btn && !btn.disabled) btn.click();
        }
    });
});

// Live mirror from the service worker and the content script. This is what the
// user hears while the popup has focus — page-side live regions in the
// WhatsApp tab are NOT spoken by Orca while a different window (the popup)
// has focus.
chrome.runtime.onMessage.addListener((request) => {
    if (request && request.action === 'WAB_STATUS_UPDATE' && request.message) {
        lastMirror = { text: request.message, at: Date.now() };
        announce(request.message);
    }
});
