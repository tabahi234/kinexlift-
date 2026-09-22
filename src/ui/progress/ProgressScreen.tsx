import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  getBodyMetrics,
  getConditioningLogs,
  getE1rmSeries,
  getLoggedExerciseIds,
  getTrainingSummary,
  type ProgressPoint,
} from '../../db/queries';
import { getWeightTrend } from '../../db/derived';
import { getProfile } from '../../db/repo';
import { deleteWeight, logWeight } from '../../db/actions';
import { exerciseName } from '../../domain/exercises';
import { modalityLabel, weeklyLoad } from '../../domain/conditioning';
import { readBmi } from '../../domain/nutrition';
import { trainingStyleOf } from '../../domain/profile';
import { dateKey, daysBetween } from '../../lib/date';
import { CycleScreen } from '../cycle/CycleScreen';
import { useFocusEffect } from '../nav';
import { PageHeader, SectionTabs, type SectionTab } from '../PageHeader';

const CHART_WIDTH = 320;
const CHART_HEIGHT = 96;
const PAD_Y = 10;

/**
 * A line drawn from her own logged numbers.
 *
 * Points are spaced evenly by entry rather than by calendar date: a two-week
 * holiday should not read as a cliff in the line when nothing was lost.
 */
function Sparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (index: number) => (index / (values.length - 1)) * CHART_WIDTH;
  const y = (value: number) =>
    CHART_HEIGHT - PAD_Y - ((value - min) / span) * (CHART_HEIGHT - PAD_Y * 2);

  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const area = `0,${CHART_HEIGHT} ${line} ${CHART_WIDTH},${CHART_HEIGHT}`;

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polygon className="chart-area" points={area} />
      <polyline className="chart-line" points={line} />
      <circle
        className="chart-dot"
        cx={x(values.length - 1)}
        cy={y(values.at(-1)!)}
        r="3.5"
      />
    </svg>
  );
}

function E1rmChart({ points }: { points: ProgressPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="chart-empty">
        One session logged. The line appears once there are two to compare.
      </p>
    );
  }

  const values = points.map((point) => point.e1rm);
  const last = points.at(-1)!;
  const first = points[0]!;
  const change = last.e1rm - first.e1rm;

  return (
    <div className="chart">
      <Sparkline
        values={values}
        label={`Estimated one-rep max from ${Math.round(first.e1rm)} to ${Math.round(last.e1rm)} kilograms across ${points.length} sessions`}
      />
      <div className="chart-footer">
        <span className="chart-value">{Math.round(last.e1rm)} kg</span>
        <span className={`chart-change ${change >= 0 ? 'up' : 'down'}`}>
          {change >= 0 ? '+' : ''}
          {Math.round(change * 10) / 10} kg over {points.length} sessions
        </span>
      </div>
    </div>
  );
}

function ExerciseProgress({ exerciseId }: { exerciseId: string }) {
  const points = useLiveQuery(() => getE1rmSeries(exerciseId), [exerciseId]);
  if (!points || points.length === 0) return null;

  return (
    <section className="card">
      <header>
        <h3>{exerciseName(exerciseId)}</h3>
        <p className="hint">Estimated one-rep max, worked out from your logged sets.</p>
      </header>
      <E1rmChart points={points} />
    </section>
  );
}

/* --------------------------------- lifts --------------------------------- */

function LiftsPanel() {
  const summary = useLiveQuery(() => getTrainingSummary(), []);
  const exerciseIds = useLiveQuery(() => getLoggedExerciseIds(), []);

  if (!summary || !exerciseIds) return <p className="loading-note">Loading…</p>;

  if (summary.sessionsAllTime === 0 && summary.setsAllTime === 0) {
    return (
      <section className="card">
        <p className="lede">Nothing logged yet.</p>
        <p className="hint">
          Women lose roughly 3 to 8% of muscle mass per decade after 30 without
          resistance training. Two sessions a week is enough to change that.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <div className="stat-grid">
          <div className="stat">
            <span className="value">{summary.sessionsThisMonth}</span>
            <span className="label">This month</span>
          </div>
          <div className="stat">
            <span className="value">{summary.sessionsAllTime}</span>
            <span className="label">Sessions</span>
          </div>
          <div className="stat">
            <span className="value">{summary.setsAllTime}</span>
            <span className="label">Sets</span>
          </div>
        </div>
        <p className="hint">
          Counted by month rather than as a streak. A rest week should never look
          like failure.
        </p>
      </section>

      {exerciseIds.slice(0, 8).map((exerciseId) => (
        <ExerciseProgress key={exerciseId} exerciseId={exerciseId} />
      ))}
    </>
  );
}

/* --------------------------------- body --------------------------------- */

function BodyPanel() {
  const profile = useLiveQuery(() => getProfile(), []);
  const trend = useLiveQuery(() => getWeightTrend(), []);
  const conditioning = useLiveQuery(() => getConditioningLogs(30), []);
  const metrics = useLiveQuery(() => getBodyMetrics(), []);
  const [entry, setEntry] = useState('');

  if (!profile || !trend || !conditioning || !metrics)
    return <p className="loading-note">Loading…</p>;

  const reading =
    profile.heightCm && trend.smoothedKg
      ? readBmi(trend.smoothedKg, profile.heightCm)
      : null;
  const load = weeklyLoad(conditioning, daysBetween, dateKey());
  const hybrid = trainingStyleOf(profile) === 'hybrid';

  return (
    <>
      <section className="card">
        <header>
          <h2>Body weight</h2>
          <p className="hint">
            The figure to judge by is the average of your last few weigh-ins. A
            single reading moves a kilo on water alone.
          </p>
        </header>

        {trend.points.length >= 2 ? (
          <div className="chart">
            <Sparkline
              values={trend.points.map((point) => point.weightKg)}
              label={`Body weight from ${trend.points[0]!.weightKg} to ${trend.points.at(-1)!.weightKg} kilograms`}
            />
            <div className="chart-footer">
              <span className="chart-value">{trend.smoothedKg} kg</span>
              <span className={`chart-change ${(trend.changeKg ?? 0) >= 0 ? 'up' : 'down'}`}>
                {(trend.changeKg ?? 0) >= 0 ? '+' : ''}
                {trend.changeKg} kg over {trend.points.length} weigh-ins
              </span>
            </div>
          </div>
        ) : (
          <p className="chart-empty">
            {trend.points.length === 1
              ? 'One weigh-in so far. The line appears with the second.'
              : 'No weigh-ins logged yet.'}
          </p>
        )}

        <div className="stepper-row">
          <label className="number-field">
            <span className="number-label">Weigh in today</span>
            <span className="number-input">
              <input
                type="number"
                inputMode="decimal"
                value={entry}
                placeholder={String(profile.bodyWeightKg ?? '')}
                min={30}
                max={250}
                onChange={(event) => setEntry(event.target.value)}
              />
              <span className="number-suffix">kg</span>
            </span>
          </label>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!(Number(entry) > 0)}
          onClick={async () => {
            await logWeight(Number(entry));
            setEntry('');
          }}
        >
          Save
        </button>

        {/* A mistyped weigh-in drags the trend line and the BMI reading, and
            without this there was no way to take one back. */}
        {metrics.length > 0 && (
          <div className="meal-group">
            <h3 className="meal-slot">Recent</h3>
            {metrics
              .slice(-5)
              .reverse()
              .map((metric) => (
                <div key={metric.id} className="meal-row">
                  <span className="meal-name">
                    {metric.weightKg} kg
                    <span className="food-serving">{metric.date}</span>
                  </span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => void deleteWeight(metric.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>

      {reading && (
        <section className="card">
          <header>
            <h2>BMI</h2>
          </header>
          <div className={`bmi-readout band-${reading.band}`}>
            <span className="bmi-value">{reading.value}</span>
            <span className="bmi-label">{reading.label}</span>
          </div>
          <p className="fineprint">
            Worked out from your smoothed weight and your height. It cannot tell
            muscle from fat, so it reads high for people who lift. The full
            calculator and the caveat are on the Fuel screen.
          </p>
        </section>
      )}

      {hybrid && (
        <section className="card">
          <header>
            <h2>Conditioning</h2>
          </header>
          <div className="stat-grid">
            <div className="stat">
              <span className="value">{load.thisWeek}</span>
              <span className="label">Minutes, 7 days</span>
            </div>
            <div className="stat">
              <span className="value">{load.lastWeek}</span>
              <span className="label">Week before</span>
            </div>
          </div>
          {load.jumpTooBig && (
            <p className="hint">
              That is a big jump. Overuse injuries come from the size of the step
              up, not the total. Hold here for a week before adding more.
            </p>
          )}
          {conditioning.length > 0 && (
            <div className="logged-sets">
              {conditioning.slice(0, 6).map((log) => (
                <span key={log.id} className="logged-set static">
                  {modalityLabel(log.modality)} · {log.minutes} min
                  <span className="logged-rir">RPE {log.rpe}</span>
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

/* -------------------------------- screen -------------------------------- */

type Panel = 'lifts' | 'body' | 'cycle';

export function ProgressScreen() {
  const [panel, setPanel] = useState<Panel>('lifts');

  // Body weight and the cycle calendar both live behind a tab on this screen,
  // which is exactly why something else had to be able to open them directly.
  useFocusEffect((focus) => {
    if (focus === 'weight') setPanel('body');
    if (focus === 'cycle') setPanel('cycle');
  });

  /*
   * The Cycle tab is always here.
   *
   * It used to appear only when tracking was on, which meant turning tracking
   * off made a whole tab disappear. That reads as the app having thrown the
   * data away - it never did - and it leaves no way back in except
   * remembering that the switch lives on the You screen. The tab now stays and
   * the screen behind it explains that it is off and what is being kept.
   */
  const tabs: SectionTab<Panel>[] = [
    { id: 'lifts', label: 'Lifts', about: 'How each lift is moving, worked out from the sets you logged.' },
    { id: 'body', label: 'Body', about: 'Your weight over time. Log a weigh-in here, once a week is plenty.' },
    { id: 'cycle', label: 'Cycle', about: 'Log periods and see your own patterns. Never changes your weights.' },
  ];

  const active = tabs.some((tab) => tab.id === panel) ? panel : 'lifts';

  return (
    <>
      <PageHeader
        eyebrow="Progress"
        title="Your progress"
        sub="Every figure here is worked out from what you logged."
      />

      <SectionTabs tabs={tabs} active={active} onChange={setPanel} label="Progress sections" />

      {active === 'lifts' && <LiftsPanel />}
      {active === 'body' && <BodyPanel />}
      {active === 'cycle' && <CycleScreen />}
    </>
  );
}
