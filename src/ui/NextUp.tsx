import { useLiveQuery } from 'dexie-react-hooks';
import { getNextUpInput } from '../db/derived';
import { nextSteps, summariseSteps, type NextStep, type StepId } from '../domain/nextUp';
import { useNav } from './nav';
import {
  Dial,
  IconBowl,
  IconCheck,
  IconChevron,
  IconDroplet,
  IconDumbbell,
  IconBolt,
  IconPulse,
  IconScale,
  type IconProps,
} from './icons';

/**
 * The answer to "what now?".
 *
 * One thing to do, in a button, at the top of the first screen she sees - and
 * under it the whole of today's shape, so the app is never asking her to trust
 * that there is a plan without showing her what it is.
 *
 * Every row is a link. That is the point of the component: nothing here tells
 * her where something lives and then leaves her to find it.
 */

const STEP_ICON: Record<StepId, (props: IconProps) => React.ReactElement> = {
  'fuel-setup': IconScale,
  checkin: IconPulse,
  session: IconDumbbell,
  food: IconBowl,
  protein: IconBolt,
  'weigh-in': IconScale,
  period: IconDroplet,
};

function StepRow({ step, onGo }: { step: NextStep; onGo: () => void }) {
  const Icon = STEP_ICON[step.id];

  return (
    <li className={`step ${step.done ? 'done' : ''}`}>
      <button type="button" className="step-row" onClick={onGo}>
        <span className="step-mark">
          {step.done ? <IconCheck size={13} /> : <Icon size={16} />}
        </span>
        {/*
          Title only. The hint for whatever is next is already sitting in the
          header two lines above, and printing it twice turned a checklist into
          a paragraph.
        */}
        <span className="step-text">
          <span className="step-title">{step.title}</span>
        </span>
        {!step.done && <IconChevron size={16} className="step-go" />}
      </button>
    </li>
  );
}

export function NextUp() {
  const input = useLiveQuery(() => getNextUpInput(), []);
  const nav = useNav();

  if (!input) return null;

  const { steps, next, done, total } = summariseSteps(nextSteps(input));
  const go = (step: NextStep) => nav.go(step.screen, step.focus);

  // A button that scrolls you to a button you can already see is clutter. When
  // the next thing is on this screen and there is nothing to open, the card
  // says what it is and gets out of the way.
  const here = next !== null && next.screen === nav.view && !next.focus;

  return (
    <section className="card next-up">
      <div className="next-up-head">
        <Dial
          size={64}
          rings={[{ value: done, max: total, color: 'var(--accent)' }]}
        >
          <span className="dial-fraction">
            {done}
            <span className="dial-of">/{total}</span>
          </span>
        </Dial>

        <header>
          <p className="eyebrow">{next ? 'Next' : 'All done'}</p>
          <h2>{next ? next.title : 'That is today done'}</h2>
          <p className="hint">
            {next
              ? here
                ? `${next.hint} It is right below.`
                : next.hint
              : 'Session, food and this week’s weigh-in are all logged. Nothing else is asked of you.'}
          </p>
        </header>
      </div>

      {next && !here && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => go(next)}
        >
          {next.cta}
        </button>
      )}

      <ol className="step-list">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} onGo={() => go(step)} />
        ))}
      </ol>
    </section>
  );
}
