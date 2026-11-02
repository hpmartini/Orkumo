import { Github } from 'lucide-react';
import { MagneticButton } from '../components/ui/magnetic-button';
import { CLOSE } from '../copy';
import { RELEASES, REPO } from '../lib/links';
import { useReduceMotion } from '../lib/media';
import { useDownloadLabel } from '../lib/os';

export function Close() {
  const reduce = useReduceMotion();
  const label = useDownloadLabel();

  return (
    <>
      <section aria-labelledby="close-h" className="mx-auto max-w-7xl px-5 py-24 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="close-h" className="display-face head-close">
            {CLOSE.title}
          </h2>
          <p className="mt-5 max-w-[66ch] text-lg text-muted">{CLOSE.lead}</p>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <MagneticButton strength={reduce ? 0 : 0.3} maxDistance={16}>
            <a
              href={RELEASES}
              className="flex min-h-12 items-center gap-2 rounded-[5px] bg-blue-strong px-6 text-[15px] font-bold text-white shadow-[0_14px_28px_-18px_rgb(0_0_0/0.95)] transition-colors hover:bg-[#1d4ed8]"
            >
              {label}
            </a>
          </MagneticButton>
          <a
            href={REPO}
            className="flex min-h-12 items-center gap-2 rounded-[5px] border border-hairline px-5 text-[15px] font-semibold text-text transition-colors hover:border-link/60 hover:bg-white/5"
          >
            <Github size={16} aria-hidden />
            {CLOSE.secondary}
          </a>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 sm:px-9">
          <span className="display-face text-text">DevOrbit</span>
          <span className="text-xs text-muted">{CLOSE.footer}</span>
          <a
            href={REPO}
            className="label-tape ml-auto flex min-h-11 items-center gap-1.5 text-text transition-colors hover:text-link"
          >
            <Github size={15} aria-hidden />
            {CLOSE.secondary}
          </a>
        </div>
      </footer>
    </>
  );
}
