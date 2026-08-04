async function sendMessageFromPopup() {
    const phone = document.getElementById('phone').value.trim();
    const message = document.getElementById('message').value.trim();
    const statusEl = document.getElementById('status');

    if (!phone || !message) {
        statusEl.textContent = 'Please enter both phone number and message.';
        statusEl.style.color = 'red';
        return;
    }

    statusEl.textContent = 'Sending... Please wait.';
    statusEl.style.color = 'blue';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('web.whatsapp.com')) {
        statusEl.textContent = 'Please open WhatsApp Web in the active tab first.';
        statusEl.style.color = 'red';
        return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'SEND_MESSAGE',
        phone: phone,
        message: message
    });

    console.log('phone:', phone, 'message:', message, 'response:', response);
    
    if (response && response.success) {
        statusEl.textContent = 'Message sent successfully!';
        statusEl.style.color = 'green';
    } else {
        statusEl.textContent = 'Failed to send. Check console for details.';
        statusEl.style.color = 'red';
    }
}

document.getElementById('sendBtn').addEventListener('click', sendMessageFromPopup);
