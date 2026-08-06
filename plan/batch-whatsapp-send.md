# Batch WhatsApp Message Sender — Implementation Plan

## Goal
Allow the popup to send the same message to multiple WhatsApp Web numbers entered as a comma-separated list, processed sequentially by a while loop inside `whatsapp.js`.

## Files to change
- `whatsapp.js` — add `handleWhatsAppBatchMessage` (while-loop) + wire listener
- `popup.js` — parse/validate/dedupe comma-separated numbers, send batch payload
- `popup.html` — plural label + comma-separated hint

Unchanged: `utils.js`, `manifest.json`, `background.js`.

## 1. `whatsapp.js` — new function using while loop
```js
async function handleWhatsAppBatchMessage({ phones, message }) {
    const results = { sent: 0, failed: 0, failedNumbers: [] };
    let i = 0;

    while (i < phones.length) {
        const phone = phones[i];
        appendLog(`Batch: processing ${i + 1}/${phones.length} -> ${phone}`);

        const result = await handleWhatsAppMessage({ phone, message });

        if (result && result.success) {
            results.sent += 1;
        } else {
            results.failed += 1;
            results.failedNumbers.push(phone);
        }

        i += 1;
    }

    appendLog(`Batch done: sent=${results.sent}, failed=${results.failed}`);
    return results;
}
```
- Sequential, no `Promise.all`.
- Reuses existing `handleWhatsAppMessage` → `openWhatsAppChat` → `writeMessage` → `sendMessage` (20-30s delays kept).
- Returns `{ sent, failed, failedNumbers }`.

## 2. `whatsapp.js` — listener (add before/after existing SEND_MESSAGE branch)
```js
if (request.action === 'SEND_MESSAGE_BATCH') {
    handleWhatsAppBatchMessage(request).then((result) => sendResponse(result));
    return true;
}
```
Keep existing `SEND_MESSAGE` branch untouched.

## 3. `popup.js`
- Parse input: `value.split(',')`, trim, strip spaces/dashes/parens, drop empties, dedupe via `Set`.
- Validate ≥1 usable number and non-empty message.
- Send `{ action: 'SEND_MESSAGE_BATCH', phones, message }`.
- On response: show `Sent X of Y` (green); if `failedNumbers.length`, show `Failed: ...` in red.
- Keep existing WhatsApp-tab check.

## 4. `popup.html`
- Label `Phone Number` → `Phone Numbers`
- Placeholder → `e.g., 9495342265, 918888888888`
- Helper text: `Separate numbers with commas` + example

## Data flow
1. User enters `919999999999, 918888888888`
2. Popup parses to `["919999999999", "918888888888"]`
3. Popup sends `{ action: 'SEND_MESSAGE_BATCH', phones, message }`
4. Content script while-loops, sending sequentially
5. Popup shows `Sent X of Y` + failures
