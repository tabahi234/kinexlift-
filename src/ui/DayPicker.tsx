import { normaliseDays, WEEK_ORDER, WEEKDAY_LONG, WEEKDAY_SHORT } from '../domain/schedule';

/**
 * Which days of the week she trains. Seven toggles, Monday first.
 *
 * The count of selected days is what drives the programme - three days is
 * three full-body sessions, four is an upper/lower split - so the picker is
 * the only place that number is set. Onboarding and You both use it.
 */
export function DayPicker({
  value,
  onChange,
  min = 2,
  max = 6,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  min?: number;
  max?: number;
}) {
  const selected = new Set(value);

  const toggle = (day: number) => {
    const next = new Set(selected);
    if (next.has(day)) {
      if (next.size <= min) return;
      next.delete(day);
    } else {
      if (next.size >= max) return;
      next.add(day);
    }
    onChange(normaliseDays([...next]));
  };

  return (
    <div className="day-picker" role="group" aria-label="Training days">
      {WEEK_ORDER.map((day) => {
        const on = selected.has(day);
        const blocked = on ? selected.size <= min : selected.size >= max;
        return (
          <button
            key={day}
            type="button"
            className={`day-toggle ${on ? 'on' : ''}`}
            aria-pressed={on}
            aria-label={WEEKDAY_LONG[day]}
            aria-disabled={blocked}
            onClick={() => toggle(day)}
          >
            {WEEKDAY_SHORT[day]}
          </button>
        );
      })}
    </div>
  );
}
