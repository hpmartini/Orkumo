import { useState } from 'react';
import { AlertTriangle, Terminal, X } from 'lucide-react';
import type { ClaudeTerminalOptions, ClaudeCLIInfo } from '../types';

interface ClaudeTerminalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: ClaudeTerminalOptions) => void;
  claudeInfo: ClaudeCLIInfo;
}

export function ClaudeTerminalModal({
  isOpen,
  onClose,
  onConfirm,
  claudeInfo,
}: ClaudeTerminalModalProps) {
  const [continueSession, setContinueSession] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [acknowledgedWarning, setAcknowledgedWarning] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (skipPermissions && !acknowledgedWarning) {
      return; // Force user to acknowledge warning
    }
    onConfirm({ continueSession, skipPermissions });
    // Reset state
    setContinueSession(false);
    setSkipPermissions(false);
    setAcknowledgedWarning(false);
  };

  const handleClose = () => {
    // Reset state when closing
    setContinueSession(false);
    setSkipPermissions(false);
    setAcknowledgedWarning(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold">Open Claude Code Terminal</h3>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {!claudeInfo.installed && (
            <div className="bg-yellow-900/20 border border-yellow-700 rounded p-3 text-sm text-yellow-200">
              <AlertTriangle className="w-4 h-4 inline mr-2" />
              Claude CLI not detected. Please install it first.
            </div>
          )}

          {claudeInfo.installed && (
            <>
              <div className="text-sm text-gray-400">
                Claude CLI detected:{' '}
                <span className="text-green-400">
                  {claudeInfo.version || 'installed'}
                </span>
              </div>

              {/* Options */}
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={continueSession}
                    onChange={(e) => setContinueSession(e.target.checked)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Continue last session (-c)</div>
                    <div className="text-sm text-gray-400">
                      Resume your previous conversation with Claude
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={(e) => {
                      setSkipPermissions(e.target.checked);
                      if (!e.target.checked) setAcknowledgedWarning(false);
                    }}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-orange-400">
                      Skip permissions (--dangerously-skip-permissions)
                    </div>
                    <div className="text-sm text-gray-400">
                      Allow Claude to execute commands without confirmation
                    </div>
                  </div>
                </label>
              </div>

              {/* Warning for skip permissions */}
              {skipPermissions && (
                <div className="bg-red-900/20 border border-red-700 rounded p-4 space-y-3">
                  <div className="flex items-start gap-2 text-red-200">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <strong>Security Warning:</strong> This mode allows Claude
                      to execute commands without asking for confirmation. Only use
                      this in trusted environments where you understand the risks.
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={acknowledgedWarning}
                      onChange={(e) =>
                        setAcknowledgedWarning(e.target.checked)
                      }
                    />
                    <span>I understand the security implications</span>
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-gray-700">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              !claudeInfo.installed ||
              (skipPermissions && !acknowledgedWarning)
            }
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Open Terminal
          </button>
        </div>
      </div>
    </div>
  );
}
