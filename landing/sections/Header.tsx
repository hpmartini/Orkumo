import { Github } from 'lucide-react';
import { REPO } from '../lib/links';

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#modes', label: 'Modes' },
  { href: '#mesh', label: 'Mesh' },
  { href: '#install', label: 'Install' },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-ground/85 backdrop-blur-md">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-7xl items-center gap-5 px-5 sm:px-9"
      >
        <a href="#top" className="display-face text-xl text-paper">
          DevOrbit
        </a>
        <div className="ml-auto hidden items-center gap-6 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="label-tape flex min-h-11 items-center text-muted transition-colors hover:text-paper"
            >
              {link.label}
            </a>
          ))}
        </div>
        <a
          href="#install"
          className="label-tape ml-auto flex min-h-11 items-center text-signal-yellow md:hidden"
        >
          Install
        </a>
        <a
          href={REPO}
          className="label-tape flex min-h-11 items-center gap-1.5 text-paper transition-colors hover:text-signal-yellow md:ml-6"
        >
          <Github size={15} aria-hidden />
          GitHub
        </a>
      </nav>
    </header>
  );
}
