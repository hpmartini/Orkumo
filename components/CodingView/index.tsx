import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
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
}: CodingViewProps) {
  const [isTerminalHidden, setIsTerminalHidden] = useState(false);
  const visibleSlotRef = useRef<HTMLDivElement>(null);

  const handleHideTerminal = () => {
    setIsTerminalHidden(true);
  };

  const handleShowTerminal = () => {
    setIsTerminalHidden(false);
  };

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

  return (
    <div className="coding-view-container">
      {/* terminalSlotRef - always mounted, AppDetail moves terminal here, we move it to visible slot */}
      <div
        ref={terminalSlotRef}
        className="terminal-slot-persistent"
        style={{
          position: 'absolute',
          left: '-9999px',
          width: '400px',
          height: '300px',
          overflow: 'hidden',
        }}
      />

      <Group orientation="horizontal" className="coding-view-group">
        {/* Terminals Panel - Conditionally rendered */}
        {!isTerminalHidden && (
          <>
            <Panel defaultSize={25} minSize={15} className="coding-panel">
              <TerminalsPanel onHide={handleHideTerminal}>
                <div ref={visibleSlotRef} className="h-full" />
              </TerminalsPanel>
            </Panel>
            <Separator className="coding-separator" />
          </>
        )}

        {/* Web IDE Panel */}
        <Panel defaultSize={isTerminalHidden ? 55 : 45} minSize={20} className="coding-panel">
          <WebIDEErrorBoundary>
            <WebIDEPanel
              directory={app.path}
              showTerminalButton={isTerminalHidden}
              onShowTerminal={handleShowTerminal}
              editorType={editorType}
              onEditorTypeChange={onEditorTypeChange}
            />
          </WebIDEErrorBoundary>
        </Panel>

        <Separator className="coding-separator" />

        {/* Browser Preview Panel */}
        <Panel defaultSize={isTerminalHidden ? 45 : 30} minSize={15} className="coding-panel">
          <BrowserPreviewPanel
            url={app.addresses?.[0] || ''}
            appId={app.id}
            showDevTools={showDevTools}
            onShowDevToolsChange={onShowDevToolsChange}
            activeTab={devToolsTab}
            onActiveTabChange={onDevToolsTabChange}
            filter={consoleFilter}
            onFilterChange={onConsoleFilterChange}
          />
        </Panel>
      </Group>
    </div>
  );
}
