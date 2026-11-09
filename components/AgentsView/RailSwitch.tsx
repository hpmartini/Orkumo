import React from 'react';

interface RailSwitchProps {
  id: string;
  label: string;
  /** Muted text after the label */
  hint?: string;
  checked: boolean;
  onToggle: () => void;
}

/** Labeled on/off switch in the rail footer */
export const RailSwitch: React.FC<RailSwitchProps> = ({ id, label, hint, checked, onToggle }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-800 text-xs text-gray-300">
    <span id={id}>{label}</span>
    {hint && <span className="text-gray-500 truncate">{hint}</span>}
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={id}
      onClick={onToggle}
      className={`ml-auto shrink-0 relative w-8 h-4 rounded-full transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 ${
        checked ? 'bg-blue-500' : 'bg-gray-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform motion-reduce:transition-none ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  </div>
);
