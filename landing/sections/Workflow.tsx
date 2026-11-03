import { Tick } from '../components/Tick';
import { WORKFLOW } from '../copy';
import { WorkflowDemo } from '../demos/WorkflowDemo';

export function Workflow() {
  return (
    <section id="workflow" aria-labelledby="workflow-h">
      <div className="mx-auto max-w-7xl px-5 py-24 sm:px-9">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <h2 id="workflow-h" className="display-face head-section">
              <span className="align-middle">{WORKFLOW.title}</span>
              <span className="ml-3 inline-block align-middle rounded-full bg-violet px-3 py-1 text-[13px] font-bold tracking-wide text-ground">
                {WORKFLOW.badge}
              </span>
            </h2>
            <p className="mt-5 max-w-[65ch] text-lg text-muted">{WORKFLOW.lead}</p>
            <ul className="mt-6 space-y-2.5">
              {WORKFLOW.points.map((point) => (
                <li key={point} className="flex gap-2.5 text-[15px] text-muted">
                  <Tick className="mt-1 shrink-0 text-violet" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-muted">{WORKFLOW.note}</p>
          </div>
          <div className="min-w-0 lg:col-span-7">
            <div className="monitor">
              <WorkflowDemo />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
