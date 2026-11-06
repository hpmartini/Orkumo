import React, { useRef, useState } from 'react';
import { Rocket } from 'lucide-react';
import type { StartResult } from '../../types';
import { startText } from '../../utils/issueControls';

/** Toast text after a sent GO; `note`: what the provider did besides starting, `start`: the start */
export const goDoneText = (key: string, start?: StartResult, note?: string) =>
  `${key}: ${note ? `${note}, ` : ''}${start ? startText(start) : 'gesendet'}`;

/** Two-step GO: the first click arms, the second sends; arming expires after 4 s */
export const GoButton: React.FC<{ label: string; onGo: () => Promise<void> }> = ({
  label,
  onGo,
}) => {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setArmed(false), 4000);
          return;
        }
        clearTimeout(timer.current);
        setBusy(true);
        try {
          await onGo();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
      className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-wait disabled:opacity-60 ${
        armed
          ? 'bg-amber-300 text-gray-950 hover:bg-amber-200'
          : 'bg-amber-300/15 text-amber-100 hover:bg-amber-300/25'
      }`}
    >
      <Rocket size={13} />
      {busy ? 'Sende…' : armed ? 'Wirklich? Nochmal klicken' : label}
    </button>
  );
};
