import { Plus } from 'lucide-react';
import { FAQ, FAQ_TITLE } from '../copy';

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-h" className="band-top">
      <div className="mx-auto max-w-7xl px-5 py-24 sm:px-9">
        <div className="max-w-4xl">
          <h2 id="faq-h" className="display-face head-section">
            {FAQ_TITLE}
          </h2>
          <div className="mt-10">
            {FAQ.map((item) => (
              <details key={item.question} className="group border-b border-hairline">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-semibold text-text [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <Plus
                    size={20}
                    aria-hidden
                    className="shrink-0 text-link transition-transform duration-200 group-open:rotate-45"
                  />
                </summary>
                <p className="max-w-2xl pb-5 text-[15px] text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
