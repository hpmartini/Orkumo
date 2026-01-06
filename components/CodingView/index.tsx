import { Group, Panel, Separator } from 'react-resizable-panels';
import { TerminalsPanel } from './TerminalsPanel';
import { WebIDEPanel } from './WebIDEPanel';
import { BrowserPreviewPanel } from './BrowserPreviewPanel';
import { AppConfig, AppStatus } from '../../types';

interface CodingViewProps {
  app: AppConfig;
}

export function CodingView({ app }: CodingViewProps) {
  return (
    <div className="h-full w-full flex flex-col bg-gray-900">
      <Group orientation="horizontal" className="flex-1">
        {/* Terminals Panel */}
        <Panel defaultSize={25} minSize={15} maxSize={40}>
          <TerminalsPanel
            appId={app.id}
            directory={app.path}
            logs={app.logs}
            isRunning={app.status === AppStatus.RUNNING}
          />
        </Panel>

        <Separator className="w-1 bg-gray-700 hover:bg-blue-500 transition-colors cursor-col-resize" />

        {/* Web IDE Panel */}
        <Panel defaultSize={40} minSize={20}>
          <WebIDEPanel appId={app.id} directory={app.path} />
        </Panel>

        <Separator className="w-1 bg-gray-700 hover:bg-blue-500 transition-colors cursor-col-resize" />

        {/* Browser Preview Panel */}
        <Panel defaultSize={35} minSize={20}>
          <BrowserPreviewPanel url={app.addresses?.[0] || ''} appId={app.id} />
        </Panel>
      </Group>
    </div>
  );
}
