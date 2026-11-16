// Harness for the prompt field (Bug 2): the chat composer next to an optional right panel
// (browser / split), mounted hidden like an inactive tab. Driven by composer-e2e.cjs.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatComposer } from '../../../components/AgentsView/Chat/ChatComposer';

const App = () => {
  const params = new URLSearchParams(location.search);
  const [value, setValue] = useState('');
  const [split, setSplit] = useState(false);
  const [visible, setVisible] = useState(params.get('hidden') !== '1');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  (window as unknown as Record<string, unknown>).harness = { setSplit, setVisible };
  return (
    <div className="flex h-screen">
      <div
        className="flex min-w-0 flex-1 flex-col justify-end p-3"
        style={{ display: visible ? 'flex' : 'none' }}
      >
        <ChatComposer
          chatId={null}
          value={value}
          onChange={setValue}
          onSubmit={() => {}}
          onStop={() => {}}
          busy={false}
          disabled={false}
          submitKey="mod+enter"
          history={[]}
          commands={[]}
          agents={[]}
          inputRef={inputRef}
        />
      </div>
      {split && (
        <div className="w-[70%] border-l border-gray-700 bg-white text-black p-4">Browser</div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
