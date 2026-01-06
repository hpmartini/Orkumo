import { Panel, Group, Separator } from 'react-resizable-panels';
import { TerminalsPanel } from './TerminalsPanel';
import { WebIDEPanel } from './WebIDEPanel';
import { BrowserPreviewPanel } from './BrowserPreviewPanel';
import { AppConfig } from '../../types';

interface CodingViewProps {
  app: AppConfig;
}

export function CodingView({ app }: CodingViewProps) {
  return (
    <div className="h-full bg-gray-900">
      <Group direction="horizontal" id={`coding-layout-${app.id}`}>
        {/* Terminals Panel */}
        <Panel defaultSize={25} minSize={15} maxSize={40}>
          <TerminalsPanel appId={app.id} directory={app.path} />
        </Panel>

        <Separator className="w-1 bg-gray-700 hover:bg-blue-500 transition-colors" />

        {/* Web IDE Panel */}
        <Panel defaultSize={40} minSize={20}>
          <WebIDEPanel appId={app.id} directory={app.path} />
        </Panel>

        <Separator className="w-1 bg-gray-700 hover:bg-blue-500 transition-colors" />

        {/* Browser Preview Panel */}
        <Panel defaultSize={35} minSize={20}>
          <BrowserPreviewPanel url={app.addresses?.[0] || ''} appId={app.id} />
        </Panel>
      </Group>
    </div>
  );
}
