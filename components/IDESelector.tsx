import React, { useState, useEffect, useRef } from 'react';
import { Code, ChevronDown, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { IDE } from '../types';
import { fetchInstalledIDEs, openInIDE } from '../services/api';

interface IDESelectorProps {
  appId: string;
  preferredIDE?: string | null;
  onSuccess?: () => void;
}

export const IDESelector: React.FC<IDESelectorProps> = ({
  appId,
  preferredIDE,
  onSuccess,
}) => {
  const [installedIDEs, setInstalledIDEs] = useState<IDE[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(true);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchIDEs = async () => {
    setDetecting(true);
    setDetectionError(null);
    try {
      const ides = await fetchInstalledIDEs();
      setInstalledIDEs(ides);
      setDetectionError(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to detect IDEs';
      setDetectionError(errorMessage);
      setInstalledIDEs([]);
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    fetchIDEs();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleOpenIDE = async (ideId: string) => {
    // Prevent multiple simultaneous launches using the loading state
    if (loading) {
      return;
    }

    setLoading(true);
    try {
      const result = await openInIDE(appId, ideId);
      setIsOpen(false);
      toast.success(result.message || `Opened in ${result.ide}`);
      onSuccess?.();
    } catch (error) {
      // Display user-friendly error messages without exposing sensitive paths
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const sanitizedMessage = errorMessage.includes('Permission denied') ?
        'Permission denied. Please check directory access.' :
        errorMessage.includes('does not exist') ?
        'Project directory not found.' :
        `Failed to open IDE: ${errorMessage}`;
      toast.error(sanitizedMessage);
    } finally {
      setLoading(false);
    }
  };

  // Show loading state during detection
  if (detecting) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 text-gray-400 text-sm rounded-lg">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Detecting IDEs...</span>
      </div>
    );
  }

  // Show error with retry button if detection failed
  if (detectionError) {
    return (
      <button
        onClick={fetchIDEs}
        className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
        title="Click to retry IDE detection"
      >
        <Code className="w-4 h-4" />
        <span>Retry IDE Detection</span>
      </button>
    );
  }

  // Don't render if no IDEs are installed
  if (installedIDEs.length === 0) {
    return null;
  }

  // Find the default IDE (preferred or first available)
  // If preferred IDE is not found, fall back to first available IDE
  const defaultIDE = preferredIDE
    ? installedIDEs.find(ide => ide.id === preferredIDE) || installedIDEs[0]
    : installedIDEs[0];

  // If only one IDE is installed, show simple button
  if (installedIDEs.length === 1) {
    return (
      <button
        onClick={() => handleOpenIDE(installedIDEs[0].id)}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={`Open in ${installedIDEs[0].name}`}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Code className="w-4 h-4" />
        )}
        <span>Open in {installedIDEs[0].name}</span>
      </button>
    );
  }

  // Multiple IDEs available - show dropdown
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={`Open in ${defaultIDE?.name || 'IDE'}`}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Code className="w-4 h-4" />
        )}
        <span>Open in {defaultIDE?.name || 'IDE'}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-1 right-0 bg-gray-800 border border-gray-700 rounded-lg shadow-lg min-w-48 z-50 py-1">
          {installedIDEs.map(ide => (
            <button
              key={ide.id}
              onClick={() => handleOpenIDE(ide.id)}
              disabled={loading}
              className="w-full text-left px-4 py-2 hover:bg-gray-700 transition-colors flex items-center justify-between disabled:opacity-50"
            >
              <span className="text-sm text-white">{ide.name}</span>
              {ide.id === preferredIDE && (
                <span className="text-blue-400 text-xs">✓ Default</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
