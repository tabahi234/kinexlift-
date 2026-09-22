import { useEffect, useState } from 'react';
import type { TodayState } from '../../db/derived';
import { describeOpensAt, praiseFor, type SessionGate } from '../../domain/schedule';
import { dateKey } from '../../lib/date';
import { TODAY_CHANGED_EVENT } from '../useTodaysPlan';
import { dismissGapNoteOn, overrideGateOn } from '../../lib/storage';
import { IconCheck, IconClock, IconSpark } from '../icons';
import { useNav } from '../nav';

/**
 * What the Today screen shows instead of a Start button.
 *
 * Finishing a session used to reveal the next one with a Start button under
 * it. Testers read that two ways, both wrong: that they were supposed to
 * carry on, or that the app had not noticed they were done. So there is now
 * a card that says what she did, and the next session opens eight hours
 * later. A rest day gets its own card for the same reason.
 *
 * Both have a small way round, because a week does not always fit a plan.
 */

/** Re-renders once a minute so the countdown stays honest. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function SessionDoneCard({
  finished,
  gate,
  nextName,
}: {
  finished: NonNullable<TodayState['finishedToday']>;
  gate: SessionGate;
  nextName: string;
}) {
  const now = useNow();
  const { summary, conditioning } = finished;

  return (
    <section className="card done-card">
      <header className="done-head">
        <span className="done-mark" aria-hidden="true">
          <IconCheck size={22} />
        </span>
        <div>
          <p className="eyebrow">Today</p>
          <h2>Session done</h2>
        </div>
      </header>

      <p className="done-praise">{praiseFor(summary, conditioning)}</p>

      {!conditioning && (
        <div className="done-stats">
          <div className="done-stat">
            <span className="done-value">{summary.sets}</span>
            <span className="done-label">sets</span>
          </div>
          <div className="done-stat">
            <span className="done-value">{summary.reps}</span>
            <span className="done-label">reps</span>
          </div>
          <div className="done-stat">
            <span className="done-value">{summary.volumeKg.toLocaleString()}</span>
            <span className="done-label">kg moved</span>
          </div>
          <div className="done-stat">
            <span className="done-value">{summary.exercises}</span>
            <span className="done-label">exercises</span>
          </div>
        </div>
      )}

      {summary.bests.length > 0 && (
        <p className="done-bests">
          <IconSpark size={15} />
          {summary.bests.length === 1
            ? `New best: ${summary.bests[0]}`
            : `New bests: ${summary.bests.join(', ')}`}
        </p>
      )}

      <p className="done-next">
        <IconClock size={15} />
        {gate.kind === 'cooldown'
          ? `${nextName} ${describeOpensAt(gate.opensAt, now)}. Eat, sleep, and it will be ready.`
          : gate.kind === 'rest-day'
            ? `${nextName} is ${gate.next}.`
            : `${nextName} is ready below whenever you want it.`}
      </p>

      {gate.kind !== 'open' && <Override label="I know. Let me train again anyway" />}
    </section>
  );
}

/** She finished late last night; the gate is still closed this morning. */
export function CooldownCard({ gate, nextName }: { gate: Extract<SessionGate, { kind: 'cooldown' }>; nextName: string }) {
  const now = useNow();
  return (
    <section className="card done-card">
      <header className="done-head">
        <span className="done-mark quiet" aria-hidden="true">
          <IconClock size={20} />
        </span>
        <div>
          <p className="eyebrow">Not yet</p>
          <h2>{nextName} {describeOpensAt(gate.opensAt, now)}</h2>
        </div>
      </header>
      <p className="hint">
        Eight hours between sessions is the minimum the programme assumes. The
        weights on the other side of it are already worked out.
      </p>
      <Override label="I know. Start it anyway" />
    </section>
  );
}

export function RestDayCard({ gate, nextName }: { gate: Extract<SessionGate, { kind: 'rest-day' }>; nextName: string }) {
  const nav = useNav();
  return (
    <section className="card done-card">
      <header className="done-head">
        <span className="done-mark quiet" aria-hidden="true">
          <IconClock size={20} />
        </span>
        <div>
          <p className="eyebrow">Rest day</p>
          <h2>{nextName} is {gate.next}</h2>
        </div>
      </header>
      <p className="hint">
        Nothing to lift today. Log your food, weigh in if it is the day for it,
        and the session will be waiting.{' '}
        <button type="button" className="link-btn inline" onClick={() => nav.go('you', 'training')}>
          Change your training days
        </button>
      </p>
      <Override label="Life moved. Train today instead" />
    </section>
  );
}

/**
 * The way round the gate. A link, not a button, and last on the card: it is
 * there for the day the plan does not fit, not as an equal option.
 */
function Override({ label }: { label: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className="link-btn gate-override" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="btn-row gate-override">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          overrideGateOn(dateKey());
          // localStorage is invisible to the live query, so tell it.
          window.dispatchEvent(new Event(TODAY_CHANGED_EVENT));
        }}
      >
        Yes, open it
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => setArmed(false)}>
        Never mind
      </button>
    </div>
  );
}

export function GapNote({ note }: { note: string }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="message gap-note" role="status">
      <p>{note}</p>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          dismissGapNoteOn(dateKey());
          setGone(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
