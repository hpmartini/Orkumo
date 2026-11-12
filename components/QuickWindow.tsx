import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';

/**
 * Quick window (#251): the whole content of the small always-on-top Electron window a
 * system-wide shortcut toggles. Enter hands the prompt to the main window, which opens the chat
 * composer with it; Escape hides the window.
 */
export const QuickWindow: React.FC = () => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // The window is hidden, not closed: start empty and focused every time it shows
  useEffect(() => {
    const onFocus = () => {
      setText('');
      inputRef.current?.focus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <form
      className="h-screen flex items-center gap-3 px-4 bg-gray-900 border border-gray-700"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) window.electronAPI?.quickSubmit(text);
      }}
    >
      <MessageSquare size={18} className="text-blue-400 shrink-0" aria-hidden />
      <input
        ref={inputRef}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') window.electronAPI?.quickHide();
        }}
        aria-label="Quick prompt"
        placeholder="Frag etwas … (Enter öffnet den Chat in Orkumo, Esc schließt)"
        className="flex-1 bg-transparent text-base text-gray-100 placeholder:text-gray-500 focus:outline-none"
      />
    </form>
  );
};
