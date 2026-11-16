/**
 * "Continue writing" in the chat view (Chats mode): a prompt goes to claude.ai / chatgpt.com
 * through the provider's own page, open in a built-in browser pane with the user's login. No
 * request is forged here: the text is typed into the page's prompt field and its send button is
 * pressed, so the provider sees exactly what the user would have done, on their subscription.
 *
 * Why not the providers' web APIs: sending is undocumented, ChatGPT guards it with page-made
 * challenge tokens, and the sync (chatSync.js) is deliberately read-only. When the page changes
 * its markup, the text is still typed (or not found): the user then sends it in the page.
 */

/* global document, window, HTMLTextAreaElement, Event, InputEvent -- typeIntoPage runs in the page */

export const CHAT_SITES = { claude: 'claude.ai', chatgpt: 'chatgpt.com' };

/** Path of a conversation on its site; the view showing it is found by this */
const chatPath = (provider, id) => (provider === 'claude' ? `/chat/${id}` : `/c/${id}`);

/**
 * The built-in browser view that shows conversation `id` of `provider`, or null.
 * @param {Iterable<{ url: string, target: unknown }>} views
 */
export function findChatView(views, provider, id) {
  if (!CHAT_SITES[provider] || !/^[\w-]{1,100}$/.test(id ?? '')) return null;
  for (const view of views) {
    try {
      const url = new URL(view.url);
      if (url.hostname === CHAT_SITES[provider] && url.pathname === chatPath(provider, id))
        return view.target;
    } catch {
      // a view without a url yet
    }
  }
  return null;
}

/**
 * Runs inside the provider's page (stringified, so self-contained). Types `text` into the prompt
 * field and, with `submit`, presses send once the page enabled it.
 * @returns {Promise<'sent'|'typed'|'no-field'>}
 */
export function typeIntoPage(text, submit) {
  const field = document.querySelector(
    '#prompt-textarea, div.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"], textarea'
  );
  if (!field) return Promise.resolve('no-field');
  field.focus();
  if (field instanceof HTMLTextAreaElement) {
    // React keeps its own copy of the value: go through the native setter so it sees the change
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const range = document.createRange();
    range.selectNodeContents(field);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    // the editors (ProseMirror) take text as typed input; the fallback is for anything else
    if (!document.execCommand?.('insertText', false, text)) {
      field.textContent = text;
      field.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
      );
    }
  }
  if (!submit) return Promise.resolve('typed');
  const sendButton = () =>
    document.querySelector(
      '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send prompt"], button[aria-label*="Send" i], button[aria-label*="Senden" i]'
    );
  return new Promise((resolve) => {
    let tries = 0;
    const press = () => {
      const button = sendButton();
      if (button && !button.disabled) {
        button.click();
        resolve('sent');
      } else if (++tries < 10) setTimeout(press, 150);
      else resolve('typed');
    };
    press();
  });
}

/** Script for `webContents.executeJavaScript` */
export const typeScript = (text, submit) =>
  `(${typeIntoPage.toString()})(${JSON.stringify(String(text))}, ${submit ? 'true' : 'false'})`;
