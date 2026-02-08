import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import { Panel, Group, Separator, useGroupRef } from 'react-resizable-panels';
import { TerminalsPanel } from './TerminalsPanel';
import { WebIDEPanel } from './WebIDEPanel';
import { WebIDEErrorBoundary } from './WebIDEErrorBoundary';
import { BrowserPreviewPanel } from './BrowserPreviewPanel';
import { AppConfig, EditorType, DevToolsTab, ConsoleFilter } from '../../types';
import './CodingView.css';

// Custom resize hook for terminal panel (bypasses react-resizable-panels constraints bug)
function useTerminalResize(
  containerRef: RefObject<HTMLDivElement | null>,
  initialWidth: number,
  minWidth: number,
  maxWidthPercent: number
) {
  const [terminalWidth, setTerminalWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault(); // Prevent text selection
      setIsDragging(true);
      startX.current = e.clientX;
      startWidth.current = terminalWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [terminalWidth]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const maxWidth = containerWidth * (maxWidthPercent / 100);
      const delta = e.clientX - startX.current;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth.current + delta));

      setTerminalWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.dispatchEvent(new Event('resize')); // Trigger xterm fit
    };

    // Add listeners only when dragging
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, containerRef, minWidth, maxWidthPercent]);

  return { terminalWidth, setTerminalWidth, handleMouseDown, isDragging };
}

interface CodingViewProps {
  app: AppConfig;
  /** Ref for the terminal slot - the terminal wrapper will be moved here */
  terminalSlotRef: RefObject<HTMLDivElement | null>;
  /** Controlled editor type (Monaco or VS Code) */
  editorType?: EditorType;
  /** Callback when editor type changes */
  onEditorTypeChange?: (type: EditorType) => void;
  /** Controlled devtools visibility */
  showDevTools?: boolean;
  /** Callback when devtools visibility changes */
  onShowDevToolsChange?: (show: boolean) => void;
  /** Controlled devtools active tab */
  devToolsTab?: DevToolsTab;
  /** Callback when devtools tab changes */
  onDevToolsTabChange?: (tab: DevToolsTab) => void;
  /** Controlled console filter */
  consoleFilter?: ConsoleFilter;
  /** Callback when console filter changes */
  onConsoleFilterChange?: (filter: ConsoleFilter) => void;
  /** Controlled browser panel visibility */
  isBrowserHidden?: boolean;
  /** Callback when browser panel visibility changes */
  onBrowserHiddenChange?: (hidden: boolean) => void;
  /** Controlled terminal panel visibility */
  isTerminalHidden?: boolean;
  /** Callback when terminal panel visibility changes */
  onTerminalHiddenChange?: (hidden: boolean) => void;
  /** Flow control callbacks */
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  /** Switch to details view */
  onSwitchToDetails?: () => void;
}

export function CodingView({
  app,
  terminalSlotRef,
  editorType,
  onEditorTypeChange,
  showDevTools,
  onShowDevToolsChange,
  devToolsTab,
  onDevToolsTabChange,
  consoleFilter,
  onConsoleFilterChange,
  isBrowserHidden: controlledBrowserHidden,
  onBrowserHiddenChange,
  isTerminalHidden: controlledTerminalHidden,
  onTerminalHiddenChange,
  onStart,
  onStop,
  onRestart,
  onSwitchToDetails,
}: CodingViewProps) {
  // Use controlled or uncontrolled terminal visibility
  // Default to hidden (true) when first entering coding view
  const [internalTerminalHidden, setInternalTerminalHidden] = useState(true);
  const isTerminalHidden = controlledTerminalHidden ?? internalTerminalHidden;
  const setIsTerminalHidden = (hidden: boolean) => {
    if (onTerminalHiddenChange) {
      onTerminalHiddenChange(hidden);
    } else {
      setInternalTerminalHidden(hidden);
    }
  };

  // Use controlled or uncontrolled browser visibility
  const [internalBrowserHidden, setInternalBrowserHidden] = useState(false);
  const isBrowserHidden = controlledBrowserHidden ?? internalBrowserHidden;
  const setIsBrowserHidden = (hidden: boolean) => {
    if (onBrowserHiddenChange) {
      onBrowserHiddenChange(hidden);
    } else {
      setInternalBrowserHidden(hidden);
    }
  };
  const visibleSlotRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useGroupRef();

  // Custom terminal resize (bypasses react-resizable-panels constraint bug)
  const { terminalWidth, handleMouseDown, isDragging } = useTerminalResize(
    containerRef,
    300, // initial width in pixels
    150, // min width
    60 // max width as percentage
  );

  const handleHideTerminal = useCallback(() => {
    setIsTerminalHidden(true);
  }, []);

  const handleShowTerminal = useCallback(() => {
    setIsTerminalHidden(false);
    // Trigger resize after showing terminal
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  }, []);

  // Move terminal from terminalSlotRef to visibleSlot
  const moveTerminalToVisible = useCallback(() => {
    const terminalSlot = terminalSlotRef.current;
    const visibleSlot = visibleSlotRef.current;
    if (!terminalSlot || !visibleSlot) return;

    const terminalWrapper = terminalSlot.firstElementChild;
    if (terminalWrapper && terminalWrapper.parentElement !== visibleSlot) {
      visibleSlot.appendChild(terminalWrapper);
    }
  }, [terminalSlotRef]);

  // Keep terminal in visibleSlot at all times (panel is now always mounted, just hidden via CSS)
  // Use MutationObserver to detect when AppDetail moves terminal into terminalSlotRef
  useEffect(() => {
    const terminalSlot = terminalSlotRef.current;
    if (!terminalSlot) return;

    // Try to move immediately
    moveTerminalToVisible();

    // Also observe for when AppDetail moves the terminal in
    const observer = new MutationObserver(() => {
      moveTerminalToVisible();
    });

    observer.observe(terminalSlot, { childList: true });

    return () => observer.disconnect();
  }, [terminalSlotRef, moveTerminalToVisible]);

  return (
    <div className="coding-view-container" ref={containerRef}>
      {/* Drag overlay - prevents iframes from capturing mouse events during resize */}
      {isDragging && (
        <div
          className="coding-drag-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 9999,
            cursor: 'col-resize',
          }}
        />
      )}

      {/* Offscreen slot - AppDetail moves terminal wrapper here, we then move it to visibleSlotRef when panel is open */}
      <div
        ref={terminalSlotRef}
        className="terminal-slot-offscreen"
        style={{
          position: 'absolute',
          left: '-9999px',
          width: '400px',
          height: '300px',
          overflow: 'hidden',
        }}
      />

      <div className="coding-view-flex">
        {/* Terminal Panel - Custom resizable (bypasses react-resizable-panels bug) */}
        {/* Always render the panel structure to preserve visibleSlotRef, use CSS to hide */}
        <div
          className="coding-panel-terminals"
          style={{
            width: isTerminalHidden ? 0 : terminalWidth,
            minWidth: isTerminalHidden ? 0 : undefined,
            flex: isTerminalHidden ? '0 0 0px' : `0 0 ${terminalWidth}px`,
            overflow: 'hidden',
            visibility: isTerminalHidden ? 'hidden' : 'visible',
          }}
        >
          <TerminalsPanel onHide={handleHideTerminal}>
            <div ref={visibleSlotRef} className="h-full" />
          </TerminalsPanel>
        </div>
        {/* Custom resize handle - only show when terminal is visible */}
        {!isTerminalHidden && (
          <div className="coding-separator-draggable" onMouseDown={handleMouseDown} />
        )}

        {/* IDE and Browser use react-resizable-panels */}
        <Group orientation="horizontal" className="coding-view-group-inner" groupRef={groupRef}>
          {/* Web IDE Panel */}
          <Panel
            id="ide-panel"
            defaultSize={isBrowserHidden ? 100 : 60}
            minSize={20}
            className="coding-panel"
          >
            <WebIDEErrorBoundary>
              <WebIDEPanel
                directory={app.path}
                showTerminalButton={isTerminalHidden}
                onShowTerminal={handleShowTerminal}
                showBrowserButton={isBrowserHidden}
                onShowBrowser={() => setIsBrowserHidden(false)}
                editorType={editorType}
                onEditorTypeChange={onEditorTypeChange}
                appStatus={app.status}
                onStart={onStart}
                onStop={onStop}
                onRestart={onRestart}
                onSwitchToDetails={onSwitchToDetails}
              />
            </WebIDEErrorBoundary>
          </Panel>

          {/* Browser Preview Panel - Conditionally rendered */}
          {!isBrowserHidden && (
            <>
              <Separator className="coding-separator" />
              <Panel id="browser-panel" defaultSize={40} minSize={15} className="coding-panel">
                <BrowserPreviewPanel
                  url={app.addresses?.[0] || ''}
                  appId={app.id}
                  showDevTools={showDevTools}
                  onShowDevToolsChange={onShowDevToolsChange}
                  activeTab={devToolsTab}
                  onActiveTabChange={onDevToolsTabChange}
                  filter={consoleFilter}
                  onFilterChange={onConsoleFilterChange}
                  onHide={() => setIsBrowserHidden(true)}
                />
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  );
}
