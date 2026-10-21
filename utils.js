const LOG_KEY = 'wab_ext_logs';
const UPDATE_KEY = 'wab_ext_update_status';
const OPERATION_KEY = 'wab_ext_operation';
const STORAGE_LIMIT = 5242880;
const LOG_RETENTION_DAYS = 7;

// Flip to true for verbose diagnostics in the console.
const WAB_DEBUG = false;

// Human-likeness delays between automation steps.
// Original defaults (20-30 s per step, ~2 minutes per message) are preserved
// so behavior does not change unexpectedly. If sends feel too slow, lower
// these — 1500-4000 ms is the usual "human but usable" range.
const HUMAN_DELAY_MIN_MS = 20000;
const HUMAN_DELAY_MAX_MS = 30000;

// --- Screen reader announcement engine -------------------------------------
// Design rules (learned the hard way, see REVIEW.md):
// 1. Regions must exist, be visible to AT (never display:none) and be EMPTY
//    before the first change — AT only announces *changes*.
// 2. Never clear all regions on every announcement: that erases messages that
//    are still waiting to be spoken (the old code did this — a race that could
//    swallow announcements entirely).
// 3. Serialize announcements and keep a minimum gap: Orca treats every live
//    region as polite and can drop back-to-back updates.
// 4. Identical text twice in a row is not a "change": alternate between two
//    regions, and when a region must repeat itself, clear it, wait, then set.
const ANNOUNCE_MIN_GAP_MS = 350;
const ANNOUNCE_SET_DELAY_MS = 120;
const ANNOUNCE_CLEAR_DELAY_MS = 50;

function wabLog(...args) {
    if (WAB_DEBUG) console.log('[WAB]', ...args);
}

function wabSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
}

// Phone numbers are PII — logs store a masked form only.
function maskPhone(phone) {
    const p = String(phone || '');
    if (p.length <= 4) return '*'.repeat(p.length);
    return p.slice(0, 2) + '*'.repeat(Math.max(2, p.length - 4)) + p.slice(-2);
}

// One canonical wording builder shared by popup + content script, so mirrored
// announcements and direct announcements dedupe cleanly (identical strings).
function buildStateMessage(state) {
    const total = state.total || 0;
    const msgWord = total === 1 ? 'message' : 'messages';
    switch (state.state) {
        case 'sending':
            return `Sending ${total} ${msgWord}. Please wait.`;
        case 'success':
            return `All ${total} ${msgWord} have been sent successfully.`;
        case 'partial':
            return `Message sending completed. ${state.sent} of ${total} messages were sent successfully. ${state.failed} failed.`;
        case 'error':
            return `Message sending failed. 0 of ${total} messages were sent.`;
        default:
            return state.message || '';
    }
}

function createAnnouncer(getRegions, options = {}) {
    const onAnnounced = typeof options.onAnnounced === 'function' ? options.onAnnounced : null;
    let idx = 0;
    let lastTime = 0;
    let chain = Promise.resolve();

    function announce(text, opts = {}) {
        if (!text) return Promise.resolve();
        const priority = opts.priority === 'assertive' ? 'assertive' : 'polite';
        const minDelay = Math.max(0, opts.minDelay || 0);
        const force = opts.force === true;

        chain = chain.then(async () => {
            try {
                const sinceLast = lastTime ? Date.now() - lastTime : Infinity;
                const wait = Math.max(minDelay, ANNOUNCE_MIN_GAP_MS - sinceLast);
                if (wait > 0) await wabSleep(wait);

                const regions = getRegions() || {};
                const useAssertive = priority === 'assertive'
                    && Array.isArray(regions.assertive) && regions.assertive.length > 0;
                const pool = useAssertive ? regions.assertive : (regions.polite || []);
                const el = pool.length ? pool[idx++ % pool.length] : null;
                if (!el) return;

                const repeatOfSameRegion = el.textContent === text;
                el.textContent = '';
                await wabSleep(repeatOfSameRegion || force ? ANNOUNCE_SET_DELAY_MS : ANNOUNCE_CLEAR_DELAY_MS);
                el.textContent = text;
                lastTime = Date.now();
                wabLog(`announced (${priority}):`, text);
                if (onAnnounced) onAnnounced(text, priority);
            } catch (error) {
                console.error('Announcement failed:', error);
            }
        }).catch(() => {});
        return chain;
    }

    return { announce };
}

// --- Persistent page live regions (content script context) ------------------
function ensureStatusAnnouncers() {
    const ids = ['wab-ext-status-announcer', 'wab-ext-status-announcer-2'];
    const out = [];
    for (const id of ids) {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            // Deliberately NO role="status" (broken in Firefox < 128,
            // Bugzilla 1810596) and NO aria-atomic (Bugzilla 1885011).
            el.setAttribute('aria-live', 'polite');
            el.style.position = 'fixed';
            el.style.width = '1px';
            el.style.height = '1px';
            el.style.padding = '0';
            el.style.margin = '-1px';
            el.style.overflow = 'hidden';
            el.style.clip = 'rect(0 0 0 0)';
            el.style.whiteSpace = 'nowrap';
            el.style.border = '0';
            (document.body || document.documentElement).appendChild(el);
        }
        out.push(el);
    }
    return { primary: out[0], secondary: out[1] };
}

let sharedPageAnnouncer = null;
function notifyScreenReader(text, priority) {
    if (!sharedPageAnnouncer) {
        ensureStatusAnnouncers();
        sharedPageAnnouncer = createAnnouncer(() => {
            const regions = ensureStatusAnnouncers();
            return { polite: [regions.primary, regions.secondary].filter(Boolean), assertive: [] };
        });
    }
    sharedPageAnnouncer.announce(text, { priority });
}
if (typeof window !== 'undefined') {
    window.notifyScreenReader = notifyScreenReader;
    // Keep the old (misspelled) name as an alias so any lingering references
    // or snippets keep working.
    window.notifySreenReader = notifyScreenReader;
}

// --- Logging (buffered + privacy-safe) --------------------------------------
// Old code rewrote the whole log array in storage on every single call
// (dozens of times per batch). Now entries are buffered and flushed at most
// every 2 s, and callers must pass masked data (see maskPhone).
let logBuffer = [];
let logFlushTimer = null;

function appendLog(message) {
    const entry = `${new Date().toISOString()} | ${message}`;
    wabLog(entry);
    logBuffer.push(entry);
    if (logFlushTimer === null) {
        logFlushTimer = setTimeout(flushLogs, 2000);
    }
}

async function flushLogs() {
    if (logFlushTimer !== null) {
        clearTimeout(logFlushTimer);
        logFlushTimer = null;
    }
    if (!logBuffer.length) return;
    const pending = logBuffer.splice(0, logBuffer.length);
    const api = storageApi();
    try {
        const result = await api.storage.local.get({ [LOG_KEY]: [] });
        const logs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
        logs.push(...pending);
        await api.storage.local.set({ [LOG_KEY]: logs.slice(-1000) });
    } catch (error) {
        console.error('Unable to persist log entries:', error);
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { flushLogs(); });
}

function cleanupOldLogs() {
    const api = storageApi();
    const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoffTime = new Date(Date.now() - retentionMs).toISOString();
    api.storage.local.get({ [LOG_KEY]: [] }, (result) => {
        const logs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
        const filteredLogs = logs.filter(log => {
            const timestamp = log.split(' | ')[0];
            return timestamp > cutoffTime;
        });
        if (filteredLogs.length < logs.length) {
            api.storage.local.set({ [LOG_KEY]: filteredLogs });
            console.log(`Cleaned up ${logs.length - filteredLogs.length} old log entries`);
        }
    });
}

// --- Update status helpers (API unchanged) -----------------------------------
async function setUpdateStatus(hasUpdate, updateMessage = '') {
    return new Promise((resolve) => {
        const api = storageApi();
        const statusData = {
            hasUpdate: hasUpdate,
            message: updateMessage,
            timestamp: new Date().toISOString(),
            extensionVersion: '1.0'
        };
        api.storage.local.set({ [UPDATE_KEY]: statusData }, () => {
            appendLog(`Update status set: hasUpdate=${hasUpdate}`);
            resolve(statusData);
        });
    });
}

async function getUpdateStatus() {
    return new Promise((resolve) => {
        const api = storageApi();
        api.storage.local.get({ [UPDATE_KEY]: null }, (result) => {
            const status = result[UPDATE_KEY] || {
                hasUpdate: false,
                message: '',
                timestamp: new Date().toISOString()
            };
            resolve(status);
        });
    });
}

async function clearUpdateStatus() {
    return new Promise((resolve) => {
        const api = storageApi();
        api.storage.local.remove([UPDATE_KEY], () => {
            appendLog('Update status cleared');
            resolve();
        });
    });
}

// --- Operation state (lets a reopened popup resume/catch up) ------------------
function persistOperationState(state) {
    const api = storageApi();
    try {
        Promise.resolve(api.storage.local.set({
            [OPERATION_KEY]: { ...state, updatedAt: Date.now() }
        })).catch(() => {});
    } catch (error) {
        wabLog('persistOperationState failed:', error);
    }
}

async function getOperationState() {
    const api = storageApi();
    try {
        const result = await api.storage.local.get({ [OPERATION_KEY]: null });
        return result[OPERATION_KEY];
    } catch (error) {
        return null;
    }
}

// --- Storage usage ------------------------------------------------------------
async function getStorageUsage() {
    return new Promise((resolve) => {
        storageApi().storage.local.get(null, (allItems) => {
            try {
                const usage = JSON.stringify(allItems).length;
                resolve(usage);
            } catch (error) {
                console.error('Error calculating storage usage:', error);
                resolve(0);
            }
        });
    });
}

async function checkStorageWarning() {
    const usage = await getStorageUsage();
    const percentUsed = (usage / STORAGE_LIMIT) * 100;
    if (percentUsed > 80) {
        appendLog(`WARNING: Storage usage at ${percentUsed.toFixed(2)}%`);
        cleanupOldLogs();
    }
    return {
        usedBytes: usage,
        limitBytes: STORAGE_LIMIT,
        percentUsed: percentUsed
    };
}

function logError(context, error) {
    appendLog(`${context}: ${error?.message || String(error)}`);
    console.error(context, error);
}

// --- DOM / automation helpers (unchanged behavior) -----------------------------
function waitRandomDelay(minDelay = HUMAN_DELAY_MIN_MS, maxDelay = HUMAN_DELAY_MAX_MS) {
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    return new Promise((resolve) => setTimeout(resolve, delay));
}

function waitForElement(selectors, timeout = 15000) {
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
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
    )?.set;
    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
    } else {
        input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const targets = [input, input.parentElement].filter(Boolean);
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

if (!globalThis.__WAB_EXT_UTILS_LOADED__) {
    globalThis.__WAB_EXT_UTILS_LOADED__ = true;
    cleanupOldLogs();
}
