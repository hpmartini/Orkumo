import { Github } from 'lucide-react';
import { useReduceMotion } from '../lib/media';
import { CopyBlock } from '../components/CopyBlock';
import { MagneticButton } from '../components/ui/magnetic-button';
import { QUICKSTART, RELEASES, REPO } from '../lib/links';
import { useDownloadLabel } from '../lib/os';

const LEAD =
  'Download the pre-release for your machine, or clone the repository and start it yourself. One issue is enough to see the card move.';

export function Close() {
  const reduce = useReduceMotion();
  const label = useDownloadLabel();

  return (
    <>
      <section aria-labelledby="close-h" className="mx-auto max-w-7xl px-5 py-24 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="close-h" className="display-face head-close">
            Get DevOrbit running.
          </h2>
          <p className="mt-5 max-w-xl text-lg text-muted">{LEAD}</p>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <MagneticButton strength={reduce ? 0 : 0.3} maxDistance={16}>
            <a
              href={RELEASES}
              className="flex min-h-12 items-center gap-2 rounded-[5px] border border-black/70 bg-signal-yellow px-6 text-[15px] font-bold text-ground shadow-[0_6px_14px_-6px_rgb(0_0_0/0.8)] transition-colors hover:bg-[#ffd43b]"
            >
              {label}
            </a>
          </MagneticButton>
          <a
            href={REPO}
            className="flex min-h-12 items-center gap-2 rounded-[5px] border border-hairline px-5 text-[15px] font-semibold text-paper transition-colors hover:border-paper/50 hover:bg-white/5"
          >
            <Github size={16} aria-hidden />
            Source on GitHub
          </a>
        </div>
        <CopyBlock commands={QUICKSTART} className="mt-6 max-w-2xl" />
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 sm:px-9">
          <span className="display-face text-paper">DevOrbit</span>
          <span className="text-xs text-muted">
            Built on the unmodified claude CLI. Your code stays on your machine.
          </span>
          <a
            href={REPO}
            className="label-tape ml-auto flex min-h-11 items-center gap-1.5 text-paper transition-colors hover:text-signal-yellow"
          >
            <Github size={15} aria-hidden />
            Source on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
