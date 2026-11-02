import { Close } from './sections/Close';
import { Faq } from './sections/Faq';
import { Features } from './sections/Features';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { Install } from './sections/Install';
import { Principles } from './sections/Principles';
import { Scale } from './sections/Scale';
import { Workflow } from './sections/Workflow';
import { Workspace } from './sections/Workspace';

export function Page() {
  return (
    <>
      <a
        href="#features"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-blue-strong focus:px-4 focus:py-3 focus:text-white"
      >
        Skip to content
      </a>
      <Header />
      <main>
        <Hero />
        <Features />
        <Workspace />
        <Workflow />
        <Scale />
        <Principles />
        <Install />
        <Faq />
      </main>
      <Close />
    </>
  );
}
