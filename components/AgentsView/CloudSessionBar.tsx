import React, { useState } from 'react';
import { Cloud } from 'lucide-react';
import { parseCloudTarget } from '../../utils/cloudSession';

interface CloudSessionBarProps {
  /** Open a PTY tab: with a target `claude --cloud <id|url>`, without `claude --teleport` */
  onOpen: (target?: string) => Promise<void>;
}

/** Attach to a cloud session by ID/URL, or pick one with `claude --teleport`. */
export const CloudSessionBar: React.FC<CloudSessionBarProps> = ({ onOpen }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async (target?: string) => {
    setError(null);
    try {
      await onOpen(target);
      if (target) setValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open session');
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseCloudTarget(value);
    if (!parsed.ok) return setError(parsed.error);
    void run(value.trim());
  };

  return (
    <form onSubmit={submit} className="px-3 py-2 border-t border-gray-800 text-xs space-y-1.5">
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Cloud session ID or claude.ai/code URL"
          className="flex-1 min-w-0 px-2 py-1 rounded bg-gray-900 border border-gray-800 text-gray-200 placeholder-gray-600"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="px-2 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-40"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => void run()}
          className="px-2 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 flex items-center gap-1"
          title="claude --teleport"
        >
          <Cloud size={12} /> Cloud-Sessions
        </button>
      </div>
      {error && <div className="text-red-400">{error}</div>}
      <div className="text-gray-500">
        Sessions on other machines only show up if started there with{' '}
        <code className="font-mono text-gray-400">claude --remote-control</code>.
      </div>
    </form>
  );
};
