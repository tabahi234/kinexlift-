import { useLiveQuery } from 'dexie-react-hooks';
import {
  getE1rmSeries,
  getLoggedExerciseIds,
  getTrainingSummary,
  type ProgressPoint,
} from '../../db/queries';
import { exerciseName } from '../../domain/exercises';

const CHART_WIDTH = 320;
const CHART_HEIGHT = 96;
const PAD_Y = 10;

/**
 * Estimated 1RM per training day.
 *
 * Points are spaced evenly by session rather than by calendar date: a two-week
 * holiday should not read as a cliff in the line when nothing was lost.
 */
function E1rmChart({ points }: { points: ProgressPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="chart-empty">
        One session logged. The line appears once there are two to compare.
      </p>
    );
  }

  const values = points.map((point) => point.e1rm);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (index: number) => (index / (points.length - 1)) * CHART_WIDTH;
  const y = (value: number) =>
    CHART_HEIGHT - PAD_Y - ((value - min) / span) * (CHART_HEIGHT - PAD_Y * 2);

  const line = points.map((point, index) => `${x(index)},${y(point.e1rm)}`).join(' ');
  const area = `0,${CHART_HEIGHT} ${line} ${CHART_WIDTH},${CHART_HEIGHT}`;

  const last = points.at(-1)!;
  const first = points[0]!;
  const change = last.e1rm - first.e1rm;

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Estimated one-rep max from ${Math.round(first.e1rm)} to ${Math.round(last.e1rm)} kilograms across ${points.length} sessions`}
      >
        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={line} />
        <circle className="chart-dot" cx={x(points.length - 1)} cy={y(last.e1rm)} r="3.5" />
      </svg>

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

export function ProgressScreen() {
  const summary = useLiveQuery(() => getTrainingSummary(), []);
  const exerciseIds = useLiveQuery(() => getLoggedExerciseIds(), []);

  if (!summary || !exerciseIds) return <p className="loading-note">Loading…</p>;

  if (summary.sessionsAllTime === 0 && summary.setsAllTime === 0) {
    return (
      <>
        <header className="masthead">
          <p className="eyebrow">Progress</p>
          <h1>Nothing logged yet</h1>
          <p className="sub">
            Finish a session and your numbers start showing up here.
          </p>
        </header>
        <section className="card">
          <p className="hint">
            Women lose roughly 3–8% of muscle mass per decade after 30 without
            resistance training. Two sessions a week is enough to change that.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="masthead">
        <p className="eyebrow">Progress</p>
        <h1>Your numbers</h1>
        <p className="sub">Every figure here is worked out from the sets you logged.</p>
      </header>

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
          Counted by month rather than as a streak — a rest week should never look
          like failure.
        </p>
      </section>

      {exerciseIds.slice(0, 6).map((exerciseId) => (
        <ExerciseProgress key={exerciseId} exerciseId={exerciseId} />
      ))}
    </>
  );
}
