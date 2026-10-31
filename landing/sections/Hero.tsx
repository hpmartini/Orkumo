import { useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { animate, useMotionValue } from 'motion/react';
import { useReduceMotion } from '../lib/media';
import { Board } from '../Board';
import { CopyBlock } from '../components/CopyBlock';
import { MagneticButton } from '../components/ui/magnetic-button';
import { QUICKSTART_SHORT, RELEASES } from '../lib/links';
import { useDownloadLabel } from '../lib/os';

const LEAD =
  'DevOrbit keeps the issue, the agent, the branch, the pull request and the code on one card. The links are read back from what your tools already write down — nobody keeps them up to date by hand.';

const NOTE = 'Pre-release · macOS & Linux · open source on GitHub';

export function Hero() {
  const reduce = useReduceMotion();
  const label = useDownloadLabel();
  // the card starts in its slot, so the prerendered HTML matches; the effect walks it in
  const index = useMotionValue(1);

  useEffect(() => {
    if (reduce) {
      index.set(1);
      return;
    }
    index.set(0);
    const controls = animate(index, 1, {
      duration: 0.9,
      delay: 0.4,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [index, reduce]);

  return (
    <section
      id="top"
      className="mx-auto grid max-w-7xl gap-12 px-5 pt-14 pb-20 sm:px-9 lg:grid-cols-12 lg:items-center lg:pt-20"
    >
      <div className="min-w-0 lg:col-span-6">
        <h1 className="display-face head-hero">Every agent task on one card.</h1>
        <p className="mt-6 max-w-xl text-lg text-muted">{LEAD}</p>
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
            href="#install"
            className="flex min-h-12 items-center gap-1.5 rounded-[5px] border border-hairline px-5 text-[15px] font-semibold text-paper transition-colors hover:border-paper/50 hover:bg-white/5"
          >
            Run from source <ArrowUpRight size={16} aria-hidden />
          </a>
        </div>
        <CopyBlock commands={QUICKSTART_SHORT} className="mt-6" />
        <p className="mt-4 text-xs text-muted">{NOTE}</p>
      </div>
      <div className="lg:col-span-6">
        <Board index={index} andon="red" caption="Example" />
      </div>
    </section>
  );
}
