import { PRINCIPLES } from '../copy';

export function Principles() {
  return (
    <section aria-labelledby="principles-h" className="band">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="principles-h" className="display-face head-section">
            {PRINCIPLES.title}
          </h2>
        </div>
        <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {PRINCIPLES.items.map((item) => (
            <div key={item.title} className="border-t border-hairline pt-4">
              <dt className="display-face text-lg text-text">{item.title}</dt>
              <dd className="mt-2 max-w-[65ch] text-[15px] text-muted">{item.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
