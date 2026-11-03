import { ArrowUpRight, Download } from 'lucide-react';
import { CopyBlock } from '../components/CopyBlock';
import { MagneticButton } from '../components/ui/magnetic-button';
import { HERO } from '../copy';
import { LineDiagram } from '../LineDiagram';
import { QUICKSTART_SHORT, RELEASES } from '../lib/links';
import { useReduceMotion } from '../lib/media';
import { useDownloadLabel } from '../lib/os';

export function Hero() {
  const reduce = useReduceMotion();
  const label = useDownloadLabel();

  return (
    <section
      id="top"
      className="mx-auto grid max-w-7xl gap-12 px-5 pt-8 pb-20 sm:px-9 sm:pt-14 lg:grid-cols-12 lg:items-center lg:pt-20"
    >
      <div className="min-w-0 lg:col-span-6">
        <h1 className="display-face head-hero max-w-[15ch]">{HERO.title}</h1>
        <p className="mt-4 max-w-[66ch] text-lg text-muted sm:mt-6">{HERO.lead}</p>
        <p className="mt-3 text-lg font-semibold text-text">{HERO.claim}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <MagneticButton strength={reduce ? 0 : 0.3} maxDistance={16}>
            <a
              href={RELEASES}
              className="flex min-h-12 items-center gap-2 rounded-[5px] bg-blue-strong px-6 text-[15px] font-bold text-white shadow-[0_14px_28px_-18px_rgb(0_0_0/0.95)] transition-colors hover:bg-[#1d4ed8]"
            >
              {label}
              <Download size={16} aria-hidden />
            </a>
          </MagneticButton>
          <a
            href="#install"
            className="flex min-h-12 items-center gap-1.5 rounded-[5px] border border-hairline px-5 text-[15px] font-semibold text-text transition-colors hover:border-link/60 hover:bg-white/5"
          >
            {HERO.secondary}
            <ArrowUpRight size={16} aria-hidden />
          </a>
        </div>
        <CopyBlock commands={QUICKSTART_SHORT} className="mt-6" />
        <p className="mt-4 text-xs text-muted">{HERO.note}</p>
      </div>
      <div className="min-w-0 lg:col-span-6">
        <LineDiagram />
      </div>
    </section>
  );
}
