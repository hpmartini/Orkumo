const PRINCIPLES = [
  {
    title: 'The unmodified claude CLI',
    text: 'DevOrbit drives the CLI you already have. It does not patch it, wrap it or read tokens out of it.',
  },
  {
    title: 'It runs on your machine',
    text: 'Your code, your keys, your network. Nothing is sent to a server we run.',
  },
  {
    title: 'Scoped to your projects',
    text: 'Sessions can only be dispatched into the project folders you configured. The server resolves symlinks before it checks.',
  },
  {
    title: 'Unsafe flags locked',
    text: 'Flags that widen a session’s reach — --dangerously-skip-permissions, custom settings, MCP configs — are refused unless you explicitly allow them.',
  },
];

export function Principles() {
  return (
    <section aria-labelledby="principles-h" className="band">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="principles-h" className="display-face head-section">
            What it will not do.
          </h2>
        </div>
        <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {PRINCIPLES.map((item) => (
            <div key={item.title} className="border-t border-hairline pt-4">
              <dt className="display-face text-lg text-paper">{item.title}</dt>
              <dd className="mt-2 text-[15px] text-muted">{item.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
