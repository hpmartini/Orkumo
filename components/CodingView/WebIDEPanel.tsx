import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Save,
  RefreshCw,
  X,
  Code2,
  Box,
} from 'lucide-react';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  modified: boolean;
}

interface WebIDEPanelProps {
  directory: string;
}

type EditorType = 'monaco' | 'code-server';

export const WebIDEPanel = ({ directory }: WebIDEPanelProps) => {
  const [editorType, setEditorType] = useState<EditorType>('monaco');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([directory]));
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeServerLoading, setCodeServerLoading] = useState(true);
  const [codeServerError, setCodeServerError] = useState<string | null>(null);
  const [loadTimeout, setLoadTimeout] = useState<NodeJS.Timeout | null>(null);

  // Ref for iframe to enable manual reload
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Get code-server URL from environment or use default (memoized)
  const codeServerUrl = useMemo(() => {
    return import.meta.env.VITE_CODE_SERVER_URL || 'http://localhost:8443';
  }, []);

  // Get iframe load timeout from environment or use default (15 seconds)
  const iframeTimeout = useMemo(() => {
    const timeout = import.meta.env.VITE_CODE_SERVER_TIMEOUT;
    return timeout ? parseInt(timeout, 10) : 15000;
  }, []);

  // Validate that a path is safe and within allowed directories
  const validatePath = useCallback((path: string): boolean => {
    const normalizedPath = path.replace(/\\/g, '/');

    // Check for path traversal attempts
    if (normalizedPath.includes('..')) {
      console.error(`[WebIDEPanel] Path traversal attempt blocked: ${path}`);
      return false;
    }

    // Ensure path starts with allowed prefixes
    const allowedPrefixes = [
      '/home/coder/Projects/',
      '/home/coder/PROJECTS/',
      '/Users/', // macOS
      '/home/', // Linux
      'C:/', // Windows
    ];

    const isAllowed = allowedPrefixes.some(prefix => {
      const normalizedPrefix = prefix.replace(/\\/g, '/');
      return normalizedPath.startsWith(normalizedPrefix);
    });

    if (!isAllowed) {
      console.error(`[WebIDEPanel] Path not in allowed directories: ${path}`);
      return false;
    }

    return true;
  }, []);

  // Convert host path to container path for code-server (memoized)
  const getContainerPath = useCallback((hostPath: string) => {
    // Validate path first to prevent path traversal attacks
    if (!validatePath(hostPath)) {
      throw new Error(`Invalid or unsafe path: ${hostPath}`);
    }

    // code-server mounts volumes at /home/coder/Projects and /home/coder/PROJECTS
    // Convert host path to container path
    const normalizedPath = hostPath.replace(/\\/g, '/');

    // Extract the project name from the path - match LAST occurrence to handle nested Projects folders
    // Use separate patterns for case-sensitive matching
    const projectsMatches = normalizedPath.match(/\/Projects\//g);
    const PROJECTSMatches = normalizedPath.match(/\/PROJECTS\//g);

    // Determine which pattern to use and find last occurrence
    let containerPath: string | null = null;

    if (projectsMatches && projectsMatches.length > 0) {
      const lastIndex = normalizedPath.lastIndexOf('/Projects/');
      const relativePath = normalizedPath.substring(lastIndex + '/Projects/'.length);
      containerPath = `/home/coder/Projects/${relativePath}`;
      if (import.meta.env.DEV) {
        console.log(`[WebIDEPanel] Mapped path: ${hostPath} -> ${containerPath}`);
      }
    } else if (PROJECTSMatches && PROJECTSMatches.length > 0) {
      const lastIndex = normalizedPath.lastIndexOf('/PROJECTS/');
      const relativePath = normalizedPath.substring(lastIndex + '/PROJECTS/'.length);
      containerPath = `/home/coder/PROJECTS/${relativePath}`;
      if (import.meta.env.DEV) {
        console.log(`[WebIDEPanel] Mapped path: ${hostPath} -> ${containerPath}`);
      }
    }

    if (!containerPath) {
      // Fallback: assume it's already a container path or use as-is
      if (import.meta.env.DEV) {
        console.warn(`[WebIDEPanel] Could not map path to container: ${hostPath}`);
      }
      return normalizedPath;
    }

    return containerPath;
  }, [validatePath]);

  // Memoize iframe src URL to avoid unnecessary recalculations
  const iframeSrc = useMemo(() => {
    const containerPath = getContainerPath(directory);
    return `${codeServerUrl}/?folder=${encodeURIComponent(containerPath)}`;
  }, [codeServerUrl, directory, getContainerPath]);

  // Handle iframe load
  const handleIframeLoad = () => {
    // Clear timeout since iframe loaded successfully
    if (loadTimeout) {
      clearTimeout(loadTimeout);
      setLoadTimeout(null);
    }
    setCodeServerLoading(false);
    setCodeServerError(null);
  };

  // Handle iframe error
  const handleIframeError = () => {
    // Clear timeout since we got an error
    if (loadTimeout) {
      clearTimeout(loadTimeout);
      setLoadTimeout(null);
    }
    setCodeServerLoading(false);
    setCodeServerError(
      'Failed to load VS Code. Make sure code-server is running (docker compose up code-server)'
    );
  };

  // Reset code-server state when switching to it with timeout fallback
  useEffect(() => {
    if (editorType === 'code-server') {
      setCodeServerLoading(true);
      setCodeServerError(null);

      // Set a timeout to detect if iframe never loads
      // iframe onError doesn't reliably fire for content loading failures
      const timeout = setTimeout(() => {
        setCodeServerLoading(false);
        setCodeServerError(
          'Failed to load VS Code (timeout). Make sure code-server is running (docker compose up code-server)'
        );
      }, iframeTimeout);

      setLoadTimeout(timeout);

      // Clean up timeout when component unmounts or editor type changes
      return () => {
        clearTimeout(timeout);
        setLoadTimeout(null);
      };
    } else {
      // Cleanup: When switching away from code-server, reset iframe src to free resources
      if (iframeRef.current) {
        iframeRef.current.src = 'about:blank';
      }
    }
  }, [editorType, iframeTimeout]);

  // Fetch file tree
  const fetchFileTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/tree?path=${encodeURIComponent(directory)}&depth=4`);
      if (!res.ok) throw new Error('Failed to load file tree');
      const data = await res.json();
      setFileTree(data.tree || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [directory]);

  useEffect(() => {
    fetchFileTree();
  }, [fetchFileTree]);

  // Open a file
  const openFile = async (path: string, name: string) => {
    // Check if already open
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      setActiveFile(path);
      return;
    }

    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error('Failed to read file');
      const data = await res.json();

      const newFile: OpenFile = {
        path,
        name,
        content: data.content,
        language: data.language,
        modified: false,
      };

      setOpenFiles((prev) => [...prev, newFile]);
      setActiveFile(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file');
    }
  };

  // Close a file
  const closeFile = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const file = openFiles.find((f) => f.path === path);
    if (file?.modified) {
      if (!confirm('Unsaved changes will be lost. Close anyway?')) return;
    }

    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    if (activeFile === path) {
      const remaining = openFiles.filter((f) => f.path !== path);
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  };

  // Save file
  const saveFile = async (path: string) => {
    const file = openFiles.find((f) => f.path === path);
    if (!file) return;

    setSaving(true);
    try {
      const res = await fetch('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: file.content }),
      });
      if (!res.ok) throw new Error('Failed to save file');

      setOpenFiles((prev) =>
        prev.map((f) => (f.path === path ? { ...f, modified: false } : f))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  // Handle editor content change
  const handleEditorChange = (value: string | undefined, path: string) => {
    if (value === undefined) return;
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, content: value, modified: true } : f))
    );
  };

  // Toggle directory expansion
  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Render file tree node
  const renderTreeNode = (node: FileNode, depth: number = 0) => {
    const isExpanded = expandedDirs.has(node.path);
    const isActive = activeFile === node.path;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-gray-800 text-sm ${
            isActive ? 'bg-blue-900/30 text-blue-300' : 'text-gray-300'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            if (node.isDirectory) {
              toggleDir(node.path);
            } else {
              openFile(node.path, node.name);
            }
          }}
        >
          {node.isDirectory ? (
            <>
              {isExpanded ? (
                <ChevronDown size={14} className="text-gray-500 shrink-0" />
              ) : (
                <ChevronRight size={14} className="text-gray-500 shrink-0" />
              )}
              <Folder size={14} className="text-yellow-500 shrink-0" />
            </>
          ) : (
            <>
              <span className="w-[14px]" />
              <File size={14} className="text-gray-500 shrink-0" />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </div>
        {node.isDirectory && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const currentFile = openFiles.find((f) => f.path === activeFile);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span>Web IDE</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Editor Type Switcher */}
          <div className="flex items-center gap-1 bg-gray-900 rounded p-0.5" role="group" aria-label="Editor type selector">
            <button
              onClick={() => setEditorType('monaco')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                editorType === 'monaco'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
              title="Monaco Editor (Lightweight)"
              aria-label="Switch to Monaco Editor"
              aria-pressed={editorType === 'monaco'}
            >
              <Code2 size={12} />
              Monaco
            </button>
            <button
              onClick={() => setEditorType('code-server')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                editorType === 'code-server'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
              title="VS Code (Full IDE)"
              aria-label="Switch to VS Code Server"
              aria-pressed={editorType === 'code-server'}
            >
              <Box size={12} />
              VS Code
            </button>
          </div>
          <button
            onClick={fetchFileTree}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            title="Refresh"
            aria-label="Refresh file tree"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 bg-red-900/30 text-red-400 text-xs border-b border-red-800">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Render code-server or Monaco based on editor type */}
      {editorType === 'code-server' ? (
        <div className="flex-1 min-h-0 relative">
          {/* Loading state */}
          {codeServerLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin text-blue-500" />
                <div className="text-sm text-gray-400">Loading VS Code...</div>
              </div>
            </div>
          )}

          {/* Error state */}
          {codeServerError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
              <div className="text-center max-w-md px-4">
                <Box className="w-12 h-12 mx-auto mb-3 text-red-500" />
                <div className="text-sm text-red-400 mb-3">{codeServerError}</div>
                <button
                  onClick={() => {
                    // Reset state
                    setCodeServerLoading(true);
                    setCodeServerError(null);
                    // Force iframe reload by changing src
                    if (iframeRef.current) {
                      iframeRef.current.src = iframeSrc;
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
                  aria-label="Retry loading VS Code Server"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="w-full h-full border-0"
            title="VS Code Server"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            // Security: Removed allow-same-origin for better isolation
            // This prevents iframe from accessing parent origin's storage/cookies
            // Note: code-server may need to use token-based auth instead of cookie auth
            sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-modals"
            allow="clipboard-read; clipboard-write"
            aria-label="VS Code web editor"
          />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* File Explorer */}
          <div className="w-48 border-r border-gray-700 overflow-y-auto shrink-0">
            <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Explorer
            </div>
            {loading && fileTree.length === 0 ? (
              <div className="px-3 py-2 text-gray-500 text-sm">Loading...</div>
            ) : fileTree.length === 0 ? (
              <div className="px-3 py-2 text-gray-500 text-sm">No files found</div>
            ) : (
              <div className="pb-4">{fileTree.map((node) => renderTreeNode(node))}</div>
            )}
          </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          {openFiles.length > 0 && (
            <div className="flex items-center bg-gray-850 border-b border-gray-700 overflow-x-auto">
              {openFiles.map((file) => (
                <div
                  key={file.path}
                  onClick={() => setActiveFile(file.path)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-gray-700 shrink-0 ${
                    activeFile === file.path
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-850 text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  <File size={12} />
                  <span className={file.modified ? 'italic' : ''}>
                    {file.name}
                    {file.modified && ' *'}
                  </span>
                  <button
                    onClick={(e) => closeFile(file.path, e)}
                    className="hover:bg-gray-700 rounded p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 min-h-0">
            {currentFile ? (
              <div className="h-full flex flex-col">
                {/* Save button */}
                <div className="px-2 py-1 bg-gray-850 border-b border-gray-700 flex items-center justify-end">
                  <button
                    onClick={() => saveFile(currentFile.path)}
                    disabled={!currentFile.modified || saving}
                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                      currentFile.modified
                        ? 'bg-blue-600 hover:bg-blue-500 text-white'
                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <Save size={12} />
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
                <div className="flex-1">
                  <Editor
                    height="100%"
                    language={currentFile.language}
                    value={currentFile.content}
                    onChange={(value) => handleEditorChange(value, currentFile.path)}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: 'on',
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <File className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <div className="text-sm">Select a file to edit</div>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      )}
    </div>
  );
};
