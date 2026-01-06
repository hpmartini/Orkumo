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
  return (
    <div className="coding-view-container">
      <Group orientation="horizontal" className="coding-view-group">
        {/* Terminals Panel */}
        <Panel defaultSize="25" minSize="10" maxSize="70" className="coding-panel">
          <TerminalsPanel
            appId={app.id}
            directory={app.path}
            logs={app.logs}
            isRunning={app.status === AppStatus.RUNNING}
          />
        </Panel>

        <Separator className="coding-separator" />

        {/* Web IDE Panel */}
        <Panel defaultSize="45" minSize="20" className="coding-panel">
          <WebIDEPanel appId={app.id} directory={app.path} />
        </Panel>

        <Separator className="coding-separator" />

        {/* Browser Preview Panel */}
        <Panel defaultSize="30" minSize="15" className="coding-panel">
          <BrowserPreviewPanel url={app.addresses?.[0] || ''} appId={app.id} />
        </Panel>
      </Group>
    </div>
  );
}
