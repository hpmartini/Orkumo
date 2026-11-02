import { CopyBlock } from '../components/CopyBlock';
import { Reveal } from '../components/Reveal';
import { INSTALL } from '../copy';
import { QUICKSTART, RELEASES } from '../lib/links';

export function Install() {
  return (
    <section id="install" aria-labelledby="install-h">
      <div className="mx-auto max-w-7xl px-5 py-24 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="install-h" className="display-face head-section">
            {INSTALL.title}
          </h2>
          <p className="mt-5 text-lg text-muted">{INSTALL.lead}</p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <Reveal y={-14} className="min-w-0">
            <div className="panel flex h-full flex-col p-6">
              <h3 className="display-face text-2xl leading-tight">{INSTALL.desktopTitle}</h3>
              <p className="mt-2 max-w-[65ch] text-[15px] text-muted">{INSTALL.desktopLead}</p>
              <ul className="mt-5 divide-y divide-hairline border-y border-hairline">
                {INSTALL.builds.map((build) => (
                  <li key={build.label}>
                    <a
                      href={RELEASES}
                      className="flex min-h-12 items-center justify-between gap-4 px-1 text-[15px] text-text transition-colors hover:text-link"
                    >
                      <span>{build.label}</span>
                      <span className="font-mono text-xs text-muted">{build.note}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted">{INSTALL.buildNote}</p>
            </div>
          </Reveal>

          <Reveal y={14} delay={0.06} className="min-w-0">
            <div className="panel flex h-full flex-col p-6">
              <h3 className="display-face text-2xl leading-tight">{INSTALL.sourceTitle}</h3>
              <p className="mt-2 max-w-[65ch] text-[15px] text-muted">{INSTALL.sourceLead}</p>
              <div className="mt-5">
                <CopyBlock commands={QUICKSTART} />
              </div>
              <p className="mt-4 font-mono text-xs text-text/90">{INSTALL.sourceUrl}</p>
              <p className="mt-3 text-xs text-muted">{INSTALL.sourceNote}</p>
            </div>
          </Reveal>
        </div>

        <Reveal y={14} className="mt-5">
          <div className="panel grid grid-cols-1 gap-4 p-6 lg:grid-cols-12 lg:items-center">
            <div className="min-w-0 lg:col-span-6">
              <h3 className="display-face text-xl leading-tight">{INSTALL.dockerTitle}</h3>
              <p className="mt-2 max-w-[65ch] text-[15px] text-muted">{INSTALL.dockerLead}</p>
              <p className="mt-2 text-xs text-muted">{INSTALL.dockerNote}</p>
            </div>
            <div className="min-w-0 lg:col-span-6">
              <CopyBlock commands={INSTALL.dockerCommand} />
              <p className="mt-3 font-mono text-xs text-text/90">{INSTALL.dockerUrl}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
