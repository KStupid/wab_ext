function openWhatsAppChat(phoneNumber) {

    const link = document.createElement('a');
    link.href = `https://web.whatsapp.com/send?phone=${phoneNumber}`;
    link.style.display = 'none';
    link.target = '_self';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function writeMessage(message) {
    const box = document.querySelector(
        'div[data-testid="conversation-compose-box-input"][contenteditable="true"]'
    );

    if (!box) {
        console.error('Message box not found. Make sure a chat is open.');
        return false;
    }

    box.focus();

    // WhatsApp Web runs on React — direct value assignment won't trigger its
    // internal state. Using execCommand ensures the input event fires properly.
    document.execCommand('insertText', false, message);

    return true;
}

function sendMessage() {
    const sendBtn = document.querySelector('button[aria-label="Send"]');

    if (!sendBtn) {
        console.error('Send button not found.');
        return false;
    }

    sendBtn.click();
    return true;
}
