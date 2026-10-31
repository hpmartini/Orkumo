const FAQ = [
  {
    question: 'Do I need an API key?',
    answer:
      'Not for the agents. DevOrbit drives the claude CLI you are already signed in with, so it uses that session — no second key, no token scraping. The Docker release compose file accepts an optional GEMINI_API_KEY; nothing else is required.',
  },
  {
    question: 'Does DevOrbit change the claude CLI?',
    answer:
      'No. It only uses the unmodified CLI and the state the CLI already keeps under your home directory. Nothing is patched, wrapped or bypassed.',
  },
  {
    question: 'Does this run in the cloud?',
    answer:
      'No. The dashboard, the database and the terminals run on your own machine, and agents on other machines stay on those machines in your tailnet.',
  },
  {
    question: 'Does it work on Windows?',
    answer:
      'There is no native Windows build in the releases. macOS and Linux are supported; on Windows, run the server in WSL.',
  },
  {
    question: 'Is it finished?',
    answer:
      'It is a pre-release. The context chain and all five modes work today; the desktop build is still being shaped.',
  },
  {
    question: 'What does the from-source setup need?',
    answer:
      'Bun, Node.js, Docker for Postgres and Redis, and the claude CLI signed in once. The dashboard then serves on port 3098; the Code mode additionally needs code-server on the machine (README, "Web IDE").',
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-h" className="band-top">
      <div className="mx-auto max-w-7xl px-5 py-24 sm:px-9">
        <div className="max-w-4xl">
          <h2 id="faq-h" className="display-face head-section">
            Questions worth asking.
          </h2>
          <div className="mt-10">
            {FAQ.map((item) => (
              <details key={item.question} className="group border-b border-hairline">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-semibold text-paper [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span
                    aria-hidden
                    className="text-xl text-signal-yellow transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
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
