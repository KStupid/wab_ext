function parsePhoneNumbers(input) {
    const normalized = input
        .split(',')
        .map((item) => item.replace(/[^0-9]/g, '')) // Strip all non-digit characters
        .filter((item) => item.length >= 7 && item.length <= 15); // Require valid length (7-15 digits)
        
    return [...new Set(normalized)];
}

async function sendMessageFromPopup() {
    const phones = parsePhoneNumbers(document.getElementById('phone').value);
    const message = document.getElementById('message').value.trim();
    const statusEl = document.getElementById('status');

    if (phones.length === 0 || !message) {
        statusEl.textContent = 'Please enter at least one valid phone number (7-15 digits) and a message.';
        statusEl.style.color = 'red';
        return;
    }

    statusEl.textContent = `Sending ${phones.length} message(s)... Please wait.`;
    statusEl.style.color = 'blue';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('web.whatsapp.com')) {
        statusEl.textContent = 'Please open WhatsApp Web in the active tab first.';
        statusEl.style.color = 'red';
        return;
    }

    try {
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'SEND_MESSAGE_BATCH',
            phones: phones,
            message: message
        });

        console.log('phones:', phones, 'message:', message, 'response:', response);

        if (response && response.sent > 0) {
            const failedText = response.failedNumbers && response.failedNumbers.length > 0
                ? ` | Failed: ${response.failedNumbers.join(', ')}`
                : '';
            statusEl.textContent = `Sent ${response.sent} of ${phones.length}${failedText}`;
            statusEl.style.color = response.failedNumbers && response.failedNumbers.length > 0 ? 'orange' : 'green';
        } else {
            statusEl.textContent = 'Failed to send. Check console for details.';
            statusEl.style.color = 'red';
        }
    } catch (error) {
        console.error('Messaging failed:', error);
        statusEl.textContent = 'Could not connect to WhatsApp tab. Refresh the tab and try again.';
        statusEl.style.color = 'red';
    }
}

document.getElementById('sendBtn').addEventListener('click', sendMessageFromPopup);