import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import { Panel, Group, Separator, useGroupRef } from 'react-resizable-panels';
import { TerminalsPanel } from './TerminalsPanel';
import { WebIDEPanel } from './WebIDEPanel';
import { WebIDEErrorBoundary } from './WebIDEErrorBoundary';
import { BrowserPreviewPanel } from './BrowserPreviewPanel';
import { AppConfig, EditorType, DevToolsTab, ConsoleFilter } from '../../types';
import './CodingView.css';

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
  const groupRef = useGroupRef();

  const handleHideTerminal = useCallback(() => {
    setIsTerminalHidden(true);
  }, []);

  const handleShowTerminal = useCallback(() => {
    setIsTerminalHidden(false);
  }, []);

  // Update panel layout when visibility changes
  useEffect(() => {
    if (!groupRef.current) return;

    // Calculate the target layout based on visibility
    const terminalSize = isTerminalHidden ? 0 : 25;
    const browserSize = isBrowserHidden ? 0 : isTerminalHidden ? 45 : 30;
    const ideSize = 100 - terminalSize - browserSize;

    // Set the layout with a small delay to ensure the Group is ready
    const timeout = setTimeout(() => {
      try {
        groupRef.current?.setLayout({
          'terminal-panel': terminalSize,
          'ide-panel': ideSize,
          'browser-panel': browserSize,
        });
      } catch {
        // Ignore errors if layout fails (e.g., panel not found when browser is hidden)
      }

      // Also trigger terminal fit after layout change
      if (!isTerminalHidden) {
        window.dispatchEvent(new Event('resize'));
      }
    }, 50);

    return () => clearTimeout(timeout);
  }, [isTerminalHidden, isBrowserHidden, groupRef]);

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

  // Move terminal from visibleSlot back to terminalSlotRef (offscreen)
  const moveTerminalToOffscreen = useCallback(() => {
    const terminalSlot = terminalSlotRef.current;
    const visibleSlot = visibleSlotRef.current;
    if (!terminalSlot) return;

    const terminalWrapper = visibleSlot?.firstElementChild;
    if (terminalWrapper && terminalWrapper.parentElement !== terminalSlot) {
      terminalSlot.appendChild(terminalWrapper);
    }
  }, [terminalSlotRef]);

  // When hiding, move terminal to offscreen holder
  useEffect(() => {
    if (isTerminalHidden) {
      moveTerminalToOffscreen();
    }
  }, [isTerminalHidden, moveTerminalToOffscreen]);

  // When panel becomes visible, move terminal into it
  // Use MutationObserver to detect when AppDetail moves terminal into terminalSlotRef
  useEffect(() => {
    if (isTerminalHidden) return;

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
  }, [isTerminalHidden, terminalSlotRef, moveTerminalToVisible]);

  // Compute panel sizes based on visibility
  const getIDESize = () => {
    if (isTerminalHidden && isBrowserHidden) return 100;
    if (isTerminalHidden) return 55;
    if (isBrowserHidden) return 75;
    return 45;
  };
  const getBrowserSize = () => {
    if (isBrowserHidden) return 0;
    if (isTerminalHidden) return 45;
    return 30;
  };

  return (
    <div className="coding-view-container">
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

      <Group orientation="horizontal" className="coding-view-group" groupRef={groupRef}>
        {/* Terminals Panel - Always mounted to preserve DOM and visibleSlotRef */}
        <Panel
          id="terminal-panel"
          defaultSize={isTerminalHidden ? 0.001 : 25}
          minSize={0}
          maxSize={isTerminalHidden ? 0.001 : 100}
          className={`coding-panel ${isTerminalHidden ? 'coding-panel-hidden' : ''}`}
          style={isTerminalHidden ? { overflow: 'hidden' } : undefined}
        >
          <div
            style={
              isTerminalHidden
                ? { position: 'absolute', left: '-9999px', width: '400px', height: '300px' }
                : { height: '100%' }
            }
          >
            <TerminalsPanel onHide={handleHideTerminal}>
              <div ref={visibleSlotRef} className="h-full" />
            </TerminalsPanel>
          </div>
        </Panel>
        {!isTerminalHidden && <Separator className="coding-separator" />}

        {/* Web IDE Panel */}
        <Panel id="ide-panel" defaultSize={getIDESize()} minSize={20} className="coding-panel">
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
            <Panel
              id="browser-panel"
              defaultSize={getBrowserSize()}
              minSize={15}
              className="coding-panel"
            >
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
  );
}
