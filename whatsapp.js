function openWhatsAppChat(phoneNumber) {
    const newChatButton =
        document.querySelector('span[data-testid="new-chat-outline"]')?.closest('button') ||
        document.querySelector('span[data-icon="new-chat-outline"]')?.closest('button');

    if (!newChatButton) {
        console.error('New chat button not found.');
        return false;
    }

    newChatButton.click();

    const searchInput = document.querySelector(
        'input[role="textbox"][aria-label="Search name or number"]'
    );

    if (!searchInput) {
        console.error('Search input not found.');
        return false;
    }

    if (!changeReactInputState(searchInput, phoneNumber)) {
        return false;
    }

    setTimeout(() => {
        pressKey(searchInput, 'Enter');
    }, 300);

    return true;
}

function changeReactInputState(input, value) {
    const reactPropsKey = Object.keys(input).find((key) =>
        key.startsWith('__reactProps')
    );
    const reactProps = reactPropsKey && input[reactPropsKey];
    const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
    ).set;

    valueSetter.call(input, value);

    if (typeof reactProps?.onChange !== 'function') {
        console.error('WhatsApp React change handler not found.');
        return false;
    }

    reactProps.onChange({
        target: input,
        currentTarget: input,
        type: 'change'
    });

    return true;
}

function pressKey(element, key) {
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

function writeMessage(message) {
    const box = document.querySelector(
        'div[data-testid="conversation-compose-box-input"][contenteditable="true"]'
    );
    if (!box) {
        console.error('Message box not found. Make sure a chat is open.');
        return false;
    }
    box.focus();
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
