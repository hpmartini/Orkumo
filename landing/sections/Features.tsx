import { Reveal } from '../components/Reveal';
import { Tick } from '../components/Tick';
import { FEATURES, FEATURES_INTRO, type Feature } from '../copy';
import { AgentsDemo } from '../demos/AgentsDemo';
import { BoardDemo } from '../demos/BoardDemo';
import { CodeDemo } from '../demos/CodeDemo';
import { PullsDemo } from '../demos/PullsDemo';
import { MonitorIllustration } from '../illustrations/MonitorIllustration';
import { cn } from '../lib/utils';

function Media({ feature }: { feature: Feature }) {
  switch (feature.media) {
    case 'board':
      return <BoardDemo />;
    case 'agents':
      return <AgentsDemo />;
    case 'pulls':
      return <PullsDemo />;
    case 'code':
      return <CodeDemo />;
    default:
      return <MonitorIllustration />;
  }
}

function FeatureRow({ feature, flip }: { feature: Feature; flip: boolean }) {
  // the portrait agents shot takes the narrow column so it is not lost in a wide empty frame
  const portrait = feature.media === 'agents';
  return (
    <article className="relative grid gap-8 border-l-[3px] border-blue/70 py-12 pl-6 sm:pl-10 lg:grid-cols-12 lg:gap-12 lg:py-16">
      {/* station tick on the one track that runs through all five jobs */}
      <span
        aria-hidden
        className="absolute top-[52px] -left-[9.5px] h-[22px] w-4 rounded-full border-[3px] border-[#0d1526] bg-text lg:top-[68px]"
      />
      <Reveal
        y={flip ? -14 : 14}
        className={cn(portrait ? 'lg:col-span-7' : 'lg:col-span-5', flip && 'lg:order-2')}
      >
        <h3 className="display-face text-2xl leading-tight">
          {/* station name plate; the title says the same in words */}
          <span
            aria-hidden
            className="mr-3 inline-block translate-y-[-3px] rounded-[4px] bg-blue-strong px-2 py-0.5 align-middle text-[15px] text-white"
          >
            {feature.verb}
          </span>
          {feature.title}
        </h3>
        <p className="mt-3 max-w-[68ch] text-[15px] text-muted">{feature.body}</p>
        <ul className="mt-5 space-y-2.5">
          {feature.points.map((point) => (
            <li key={point} className="flex gap-2.5 text-[14px] text-muted">
              <Tick className="mt-1 shrink-0 text-link" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </Reveal>
      <div
        className={cn(
          'min-w-0',
          portrait ? 'lg:col-span-5' : 'lg:col-span-7',
          flip && 'lg:order-1'
        )}
      >
        <div className={cn('monitor', portrait && 'mx-auto max-w-[440px]')}>
          <Media feature={feature} />
        </div>
      </div>
    </article>
  );
}

export function Features() {
  return (
    <section id="features" aria-labelledby="features-h">
      <div className="mx-auto max-w-7xl px-5 pt-24 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="features-h" className="display-face head-section">
            {FEATURES_INTRO.title}
          </h2>
          <p className="mt-5 text-lg text-muted">{FEATURES_INTRO.lead}</p>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-5 sm:px-9">
        {FEATURES.map((feature, i) => (
          <FeatureRow key={feature.id} feature={feature} flip={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}
