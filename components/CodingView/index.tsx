import { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { TerminalsPanel } from './TerminalsPanel';
import { WebIDEPanel } from './WebIDEPanel';
import { BrowserPreviewPanel } from './BrowserPreviewPanel';
import { AppConfig, AppStatus } from '../../types';
import './CodingView.css';

interface CodingViewProps {
  app: AppConfig;
}

export function CodingView({ app }: CodingViewProps) {
  const [isTerminalHidden, setIsTerminalHidden] = useState(false);

  return (
    <div className="coding-view-container">
      <Group orientation="horizontal" className="coding-view-group">
        {/* Terminals Panel - Hidden when isTerminalHidden is true */}
        {!isTerminalHidden && (
          <>
            <Panel defaultSize={25} minSize={15} className="coding-panel">
              <TerminalsPanel
                directory={app.path}
                logs={app.logs}
                isRunning={app.status === AppStatus.RUNNING}
                onHide={() => setIsTerminalHidden(true)}
              />
            </Panel>
            <Separator className="coding-separator" />
          </>
        )}

        {/* Web IDE Panel */}
        <Panel defaultSize={isTerminalHidden ? 55 : 45} minSize={20} className="coding-panel">
          <WebIDEPanel
            directory={app.path}
            showTerminalButton={isTerminalHidden}
            onShowTerminal={() => setIsTerminalHidden(false)}
          />
        </Panel>

        <Separator className="coding-separator" />

        {/* Browser Preview Panel */}
        <Panel defaultSize={30} minSize={15} className="coding-panel">
          <BrowserPreviewPanel url={app.addresses?.[0] || ''} appId={app.id} />
        </Panel>
      </Group>
    </div>
  );
}
