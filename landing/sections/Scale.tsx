import { Tick } from '../components/Tick';
import { DEMO_PROJECTS, SCALE } from '../copy';

const HOSTS = ['laptop', 'workstation'];

/** which machine runs the sessions of a project */
const HOSTS_OF: Record<string, string[]> = {
  storefront: ['laptop', 'workstation'],
  'billing-api': ['workstation'],
  'docs-site': ['laptop'],
  'mobile-app': ['laptop', 'workstation'],
};

export function Scale() {
  return (
    <section id="scale" aria-labelledby="scale-h">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-9 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <h2 id="scale-h" className="display-face head-section">
            {SCALE.title}
          </h2>
          <p className="mt-5 max-w-[65ch] text-lg text-muted">{SCALE.lead}</p>
          <ul className="mt-6 space-y-2.5">
            {SCALE.points.map((point) => (
              <li key={point} className="flex gap-2.5 text-[15px] text-muted">
                <Tick className="mt-1 shrink-0 text-link" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <div className="panel p-5 sm:p-6">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline">
                  <th scope="col" className="label-tape py-2 pr-4 font-semibold text-muted">
                    Project
                  </th>
                  {HOSTS.map((host) => (
                    <th
                      key={host}
                      scope="col"
                      className="label-tape py-2 pl-4 text-center font-semibold text-muted"
                    >
                      {host}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DEMO_PROJECTS.map((project) => (
                  <tr key={project} className="border-b border-hairline/50 last:border-0">
                    <td className="py-3 pr-4 font-mono text-[13px] text-text">{project}</td>
                    {HOSTS.map((host) => {
                      const active = HOSTS_OF[project].includes(host);
                      return (
                        <td key={host} className="py-3 pl-4 text-center">
                          <span className="sr-only">
                            {active
                              ? `${project} has a session on ${host}`
                              : `no session on ${host}`}
                          </span>
                          <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden>
                            <circle
                              cx={6}
                              cy={6}
                              r={4}
                              fill={active ? '#3b82f6' : 'none'}
                              stroke={active ? '#3b82f6' : '#a8bbe2'}
                              strokeWidth={1.5}
                              opacity={active ? 1 : 0.6}
                            />
                          </svg>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-xs text-muted">A session stays on the machine it runs on.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
