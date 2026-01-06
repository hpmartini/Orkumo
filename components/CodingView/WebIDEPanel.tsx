import { Code } from 'lucide-react';

interface WebIDEPanelProps {
  appId: string;
  directory: string;
}

export function WebIDEPanel({ appId, directory }: WebIDEPanelProps) {
  return (
    <div className="h-full flex flex-col bg-gray-900 border-r border-gray-700">
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm">
        Web IDE
      </div>

      {/* Placeholder - will be replaced with Monaco/code-server */}
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center space-y-4">
          <Code className="w-16 h-16 mx-auto opacity-50" />
          <div>
            <div className="font-semibold">Editor Coming Soon</div>
            <div className="text-sm mt-2">
              Project: <span className="text-blue-400">{directory}</span>
            </div>
            <div className="text-xs mt-4 text-gray-600">
              This panel will integrate Monaco Editor or code-server
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
