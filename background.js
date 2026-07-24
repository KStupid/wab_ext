// whatsapp.js is loaded first via manifest.json — functions are in scope

const PHONE = '9495342265';
const MESSAGE = 'ignore this message';

// open the chat, wait for WhatsApp to load it, then write + send
openWhatsAppChat(PHONE);

setTimeout(() => {
    const wrote = writeMessage(MESSAGE);

    if (wrote) {
        sendMessage();
    }
}); // 3s for the chat to load
