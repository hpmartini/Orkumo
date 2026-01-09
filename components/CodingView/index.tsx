import { useState, type RefObject } from 'react';
import { TerminalsPanel } from './TerminalsPanel';
import { WebIDEPanel } from './WebIDEPanel';
import { WebIDEErrorBoundary } from './WebIDEErrorBoundary';
import { BrowserPreviewPanel } from './BrowserPreviewPanel';
import { AppConfig } from '../../types';
import './CodingView.css';

interface CodingViewProps {
  app: AppConfig;
  /** Ref for the terminal slot - the terminal wrapper will be moved here */
  terminalSlotRef: RefObject<HTMLDivElement | null>;
}

export function CodingView({ app, terminalSlotRef }: CodingViewProps) {
  const [isTerminalHidden, setIsTerminalHidden] = useState(false);

  const handleHideTerminal = () => {
    setIsTerminalHidden(true);
  };

  const handleShowTerminal = () => {
    setIsTerminalHidden(false);
  };

  return (
    <div className="coding-view-container">
      {/* Custom flex layout for hide/show terminal functionality */}
      <div className="coding-view-flex">
        {/* Terminals Panel - Always mounted, positioned offscreen when hidden */}
        <div
          className="coding-panel-terminals"
          style={isTerminalHidden ? {
            position: 'absolute',
            left: '-9999px',
            width: '400px',
            height: '300px',
          } : {
            flex: '0 0 25%',
          }}
        >
          <TerminalsPanel onHide={handleHideTerminal}>
            <div ref={terminalSlotRef} className="h-full" />
          </TerminalsPanel>
        </div>

        {/* Resizable separator - only shown when terminal is visible */}
        {!isTerminalHidden && <div className="coding-separator-static" />}

        {/* Web IDE Panel */}
        <div className="coding-panel-webide" style={{ flex: isTerminalHidden ? '1 1 60%' : '1 1 45%' }}>
          <WebIDEErrorBoundary>
            <WebIDEPanel
              directory={app.path}
              showTerminalButton={isTerminalHidden}
              onShowTerminal={handleShowTerminal}
            />
          </WebIDEErrorBoundary>
        </div>

        <div className="coding-separator-static" />

        {/* Browser Preview Panel */}
        <div className="coding-panel-browser" style={{ flex: isTerminalHidden ? '1 1 40%' : '1 1 30%' }}>
          <BrowserPreviewPanel url={app.addresses?.[0] || ''} appId={app.id} />
        </div>
      </div>
    </div>
  );
}
