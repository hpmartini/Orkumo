import { useState, useEffect } from 'react';
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

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [isOpen, onClose]);

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
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="claude-modal-title"
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-blue-400" />
            <h3 id="claude-modal-title" className="text-lg font-semibold">Open Claude Code Terminal</h3>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close modal"
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
                <label htmlFor="continue-session" className="flex items-start gap-3 cursor-pointer">
                  <input
                    id="continue-session"
                    type="checkbox"
                    checked={continueSession}
                    onChange={(e) => setContinueSession(e.target.checked)}
                    className="mt-1"
                    aria-describedby="continue-session-description"
                  />
                  <div>
                    <div className="font-medium">Continue last session (-c)</div>
                    <div id="continue-session-description" className="text-sm text-gray-400">
                      Resume your previous conversation with Claude
                    </div>
                  </div>
                </label>

                <label htmlFor="skip-permissions" className="flex items-start gap-3 cursor-pointer">
                  <input
                    id="skip-permissions"
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={(e) => {
                      setSkipPermissions(e.target.checked);
                      if (!e.target.checked) setAcknowledgedWarning(false);
                    }}
                    className="mt-1"
                    aria-describedby="skip-permissions-description"
                  />
                  <div>
                    <div className="font-medium text-orange-400">
                      Skip permissions (--dangerously-skip-permissions)
                    </div>
                    <div id="skip-permissions-description" className="text-sm text-gray-400">
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
                  <label htmlFor="acknowledge-warning" className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      id="acknowledge-warning"
                      type="checkbox"
                      checked={acknowledgedWarning}
                      onChange={(e) =>
                        setAcknowledgedWarning(e.target.checked)
                      }
                      aria-label="Acknowledge security warning"
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
