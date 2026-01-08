import type { RefObject } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { TerminalsPanel } from './TerminalsPanel';
import { WebIDEPanel } from './WebIDEPanel';
import { BrowserPreviewPanel } from './BrowserPreviewPanel';
import { AppConfig } from '../../types';
import './CodingView.css';

interface CodingViewProps {
  app: AppConfig;
  /** Ref for the terminal slot - the terminal wrapper will be moved here */
  terminalSlotRef: RefObject<HTMLDivElement | null>;
}

export function CodingView({ app, terminalSlotRef }: CodingViewProps) {
  return (
    <div className="coding-view-container">
      <Group orientation="horizontal" className="coding-view-group">
        {/* Terminals Panel - Always visible to preserve terminal session */}
        <Panel defaultSize={25} minSize={15} className="coding-panel">
          <TerminalsPanel>
            {/* Terminal slot - the terminal wrapper will be moved here from AppDetail */}
            <div ref={terminalSlotRef} className="h-full" />
          </TerminalsPanel>
        </Panel>
        <Separator className="coding-separator" />

        {/* Web IDE Panel */}
        <Panel defaultSize={45} minSize={20} className="coding-panel">
          <WebIDEPanel directory={app.path} />
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
