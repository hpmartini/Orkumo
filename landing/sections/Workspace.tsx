import { Code2, Globe, Terminal } from 'lucide-react';
import { WORKSPACE } from '../copy';
import { WorkspaceIllustration } from '../illustrations/WorkspaceIllustration';

const ICONS = [Terminal, Code2, Globe];

export function Workspace() {
  return (
    <section id="workspace" aria-labelledby="workspace-h">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-9 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <h2 id="workspace-h" className="display-face head-section">
            {WORKSPACE.title}
          </h2>
          <p className="mt-5 max-w-[65ch] text-lg text-muted">{WORKSPACE.lead}</p>
          <ul className="mt-10 space-y-7">
            {WORKSPACE.items.map((item, i) => {
              const Icon = ICONS[i];
              return (
                <li key={item.name} className="flex gap-4">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[6px] border border-hairline bg-raised text-link">
                    <Icon size={17} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="display-face text-lg">{item.name}</h3>
                    <p className="mt-1.5 max-w-[65ch] text-[15px] text-muted">{item.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <div className="monitor">
            <WorkspaceIllustration />
          </div>
        </div>
      </div>
    </section>
  );
}
