import { Close } from './sections/Close';
import { Faq } from './sections/Faq';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { Install } from './sections/Install';
import { Mesh } from './sections/Mesh';
import { Modes } from './sections/Modes';
import { Principles } from './sections/Principles';

export function Page() {
  return (
    <>
      <a
        href="#modes"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-paper focus:px-4 focus:py-3 focus:text-ground"
      >
        Skip to content
      </a>
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Modes />
        <Mesh />
        <Principles />
        <Install />
        <Faq />
      </main>
      <Close />
    </>
  );
}
