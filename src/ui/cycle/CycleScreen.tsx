import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getCycleContext } from '../../db/derived';
import { getCycleEvents } from '../../db/queries';
import { logCycleEvent, setCycleTracking } from '../../db/actions';
import {
  flagMessage,
  PHASE_LABEL,
  PHASE_NOTE,
  phaseForDay,
  periodStarts,
  type CyclePhase,
} from '../../domain/cycle';
import { addDays, dateKey, daysBetween } from '../../lib/date';

/**
 * The cycle screen.
 *
 * What it does: tracks periods, works out where she is in her own cycle, and
 * after a few months tells her what her own logs actually show.
 *
 * What it deliberately does not do: change a single working weight. That is
 * the one thing a women's training app is expected to do here, and the
 * evidence does not support it - fixed per-phase multipliers are not reliable
 * across individuals and they interrupt progressive overload, which is the
 * thing that actually works. The daily check-in handles how she feels today,
 * from her answers rather than from a calendar. This screen says so out loud,
 * because a user who has seen every other app do the opposite is entitled to
 * know it is a decision rather than an omission.
 */

const CONFIDENCE_NOTE: Record<string, string> = {
  none: 'Log a period start and this begins.',
  low: 'One or two cycles logged, so treat the prediction as a rough guess.',
  medium: 'Enough cycles logged to predict from, give or take a few days.',
  high: 'Your cycles are consistent, so this prediction is usually close.',
};

function PhaseStrip({
  days,
  starts,
  medianLength,
  periodDays,
  today,
}: {
  days: number;
  starts: string[];
  medianLength: number | null;
  periodDays: number;
  today: string;
}) {
  const cells = Array.from({ length: days }, (_, index) =>
    addDays(today, -(days - 1 - index)),
  );

  const phaseFor = (date: string): CyclePhase | null => {
    if (medianLength === null) return null;
    let index = -1;
    for (let i = 0; i < starts.length; i++) {
      if (daysBetween(starts[i]!, date) >= 0) index = i;
      else break;
    }
    if (index === -1) return null;
    const next = starts[index + 1];
    const observed = next ? daysBetween(starts[index]!, next) : medianLength;
    return phaseForDay(daysBetween(starts[index]!, date) + 1, observed, periodDays);
  };

  return (
    <div className="phase-strip" role="img" aria-label={`Your last ${days} days by cycle phase`}>
      {cells.map((date) => {
        const phase = phaseFor(date);
        return (
          <span
            key={date}
            className={`phase-cell ${phase ? `phase-${phase}` : 'phase-unknown'} ${
              date === today ? 'today' : ''
            }`}
            title={`${date}${phase ? `: ${PHASE_LABEL[phase]}` : ''}`}
          />
        );
      })}
    </div>
  );
}

/**
 * The screen when tracking is off.
 *
 * This used to be unreachable. The Cycle tab was only added to Progress when
 * tracking was on, so turning it off made the whole tab vanish - which reads
 * exactly like the app threw the data away, and left no way back in except
 * remembering that the switch is on the You screen.
 *
 * Nothing is ever deleted by turning this off, and now the screen says so and
 * counts what is being kept. It also tells the two answers apart: "no thanks"
 * and "I am on hormonal contraception" are different decisions and deserve
 * different sentences.
 */
function Paused({
  mode,
  logged,
}: {
  mode: 'contraception' | 'off';
  /** Period events already on the device. Zero is a normal answer. */
  logged: number;
}) {
  return (
    <section className="card">
      <header>
        <h2>
          {mode === 'contraception'
            ? 'Cycle tracking is off for hormonal contraception'
            : 'Cycle tracking is off'}
        </h2>
      </header>

      {mode === 'contraception' ? (
        <p className="lede">
          Most combined-pill users do not ovulate, so there is no natural cycle
          to follow and the predictions here would be describing something that
          is not happening. You can still turn it on if you want to log bleeding
          days.
        </p>
      ) : (
        <p className="lede">
          Turn it on and the app logs your periods, works out your own cycle
          length rather than assuming 28 days, and after about three months
          tells you what your own check-ins actually show across your cycle.
        </p>
      )}

      {logged > 0 && (
        <div className="message note">
          <p>
            Your {logged} logged {logged === 1 ? 'entry is' : 'entries are'} still
            here. Turning tracking off hides this screen; it has never deleted
            anything, and turning it back on picks up exactly where you left off.
          </p>
        </div>
      )}

      <p className="hint">
        It will never change your weights for you. Fixed per-phase adjustments
        are not supported by the evidence and they get in the way of progress.
        Your daily check-in already handles how today feels.
      </p>

      <p className="fineprint">
        This is health data, and it stays on your device unless you turn on
        backup yourself. To remove it for good, use Erase all data on the You
        screen.
      </p>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void setCycleTracking('track')}
        >
          {logged > 0 ? 'Turn tracking back on' : 'Track my cycle'}
        </button>
      </div>
    </section>
  );
}

export function CycleScreen() {
  const context = useLiveQuery(() => getCycleContext(), []);
  const events = useLiveQuery(() => getCycleEvents(), []);
  const [logDate, setLogDate] = useState(dateKey());

  if (!context || !events) return <p className="loading-note">Loading…</p>;
  if (!context.tracking) {
    return (
      <Paused
        mode={context.mode === 'contraception' ? 'contraception' : 'off'}
        logged={events.length}
      />
    );
  }

  const { status, patterns } = context;
  const starts = periodStarts(events);
  const bleedingToday = events.some(
    (event) => event.date === logDate && event.kind === 'period_start',
  );

  return (
    <>
      <section className="card">
        <header>
          <h2>Where you are</h2>
        </header>

        {status.dayOfCycle === null ? (
          <p className="lede">
            Nothing logged yet. Mark the first day of your next period below and the
            rest of this screen fills itself in.
          </p>
        ) : (
          <>
            <div className="cycle-headline">
              <span className="cycle-day">Day {status.dayOfCycle}</span>
              {status.phase && (
                <span className={`phase-pill phase-${status.phase}`}>
                  {PHASE_LABEL[status.phase]}
                </span>
              )}
            </div>

            {status.phase && <p className="hint">{PHASE_NOTE[status.phase]}</p>}

            <PhaseStrip
              days={35}
              starts={starts}
              medianLength={status.stats.medianLengthDays}
              periodDays={status.stats.medianPeriodDays ?? 5}
              today={dateKey()}
            />

            {status.predictedNextStart && status.predictedWindow && (
              <div className="row">
                <div className="row-text">
                  <div className="row-title">Next period</div>
                  <div className="row-hint">
                    Likely between {status.predictedWindow[0]} and{' '}
                    {status.predictedWindow[1]}
                  </div>
                </div>
                <span className="pill">
                  {status.daysUntilNext !== null && status.daysUntilNext >= 0
                    ? `in ${status.daysUntilNext} days`
                    : 'due'}
                </span>
              </div>
            )}

            <p className="fineprint">
              {CONFIDENCE_NOTE[status.stats.confidence]} Phase is estimated by
              counting back from your expected next period, not forwards from your
              last one. The second half of the cycle is the consistent one, so
              that is the accurate way round.
            </p>
          </>
        )}
      </section>

      {status.flags.map((flag) => {
        const message = flagMessage(flag);
        if (!message) return null;
        return (
          <div key={flag} className={`message ${flag === 'absent' ? 'warning' : ''}`}>
            <p>{message}</p>
          </div>
        );
      })}

      <section className="card">
        <header>
          <h2>Log a day</h2>
          <p className="hint">
            Tapping the same thing twice removes it, so a mis-tap is one tap to
            undo.
          </p>
        </header>

        <label className="number-field">
          <span className="number-label">Date</span>
          <span className="number-input">
            <input
              type="date"
              value={logDate}
              max={dateKey()}
              onChange={(event) => setLogDate(event.target.value || dateKey())}
            />
          </span>
        </label>

        <div className="chips">
          <button
            type="button"
            className={`chip ${bleedingToday ? 'selected' : ''}`}
            aria-pressed={bleedingToday}
            onClick={() => void logCycleEvent('period_start', logDate)}
          >
            Period started
          </button>
          <button
            type="button"
            className={`chip ${
              events.some((e) => e.date === logDate && e.kind === 'period_end')
                ? 'selected'
                : ''
            }`}
            onClick={() => void logCycleEvent('period_end', logDate)}
          >
            Period ended
          </button>
          <button
            type="button"
            className={`chip ${
              events.some((e) => e.date === logDate && e.kind === 'spotting')
                ? 'selected'
                : ''
            }`}
            onClick={() => void logCycleEvent('spotting', logDate)}
          >
            Spotting
          </button>
        </div>
      </section>

      {status.stats.completeCycles > 0 && (
        <section className="card">
          <header>
            <h2>Your cycle</h2>
          </header>
          <div className="stat-grid">
            <div className="stat">
              <span className="value">{status.stats.medianLengthDays}</span>
              <span className="label">Typical length</span>
            </div>
            <div className="stat">
              <span className="value">
                {status.stats.shortestDays} to {status.stats.longestDays}
              </span>
              <span className="label">Range</span>
            </div>
            <div className="stat">
              <span className="value">{status.stats.completeCycles}</span>
              <span className="label">Cycles logged</span>
            </div>
          </div>
          {status.stats.medianPeriodDays !== null && (
            <p className="hint">
              Your period usually runs about {status.stats.medianPeriodDays} days.
            </p>
          )}
        </section>
      )}

      <section className="card">
        <header>
          <h2>Your own pattern</h2>
          <p className="hint">
            Not what women in general report. What you have logged.
          </p>
        </header>

        {!patterns.ready && <p className="lede">{patterns.waitingFor}</p>}

        {patterns.ready && patterns.nothingStandsOut && (
          <p className="lede">
            Across {patterns.checkinsAssigned} check-ins and{' '}
            {patterns.completeCycles} cycles, nothing stands out. That is a real
            result, not a missing one. Plenty of women do not have a strong cycle
            pattern in how they train.
          </p>
        )}

        {patterns.ready &&
          patterns.findings.map((finding) => (
            <div key={finding.text} className="finding">
              <span className={`phase-pill phase-${finding.phase}`}>
                {PHASE_LABEL[finding.phase]}
              </span>
              <p>{finding.text}</p>
            </div>
          ))}

        <p className="fineprint">
          Whatever this says, your programme does not change because of it. Weights
          follow your logged sets and your daily check-in.
        </p>
      </section>

      <section className="card">
        <header>
          <h2>Turning it off</h2>
        </header>
        <div className="chips">
          <button
            type="button"
            className="chip"
            onClick={() => void setCycleTracking('contraception')}
          >
            I am on hormonal contraception
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => void setCycleTracking('off')}
          >
            Stop tracking
          </button>
        </div>
        <p className="fineprint">
          Turning it off hides these features. What you have logged stays until you
          delete it from the You screen.
        </p>
      </section>

      <p className="footnote">
        Not medical advice. Periods that stop, become very painful, or change a lot
        are worth a doctor&rsquo;s opinion.
      </p>
    </>
  );
}
