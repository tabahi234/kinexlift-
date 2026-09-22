import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSupplementChecklist } from '../../db/queries';
import { addSupplement, removeSupplement, setSupplementTaken } from '../../db/actions';
import {
  describeSupplement,
  DOSE_MAX,
  NAME_MAX,
  normaliseSupplement,
  SUPPLEMENT_PRESETS,
  TIMING_LABEL,
  TIMING_ORDER,
} from '../../domain/supplements';
import type { SupplementTiming } from '../../db/schema';
import { IconCheck, IconPill, IconPlus } from '../icons';

/**
 * The supplements checklist, on the Today tab of Fuel.
 *
 * Asked for in the first round of testing by a doctor, and built to the
 * width of that ask: the things she takes, ticked off per day. The app
 * keeps the list. It never adds to it, and the coach is forbidden from
 * recommending anything for it. Powders with calories go through the food
 * picker instead, where they count - the link at the foot sends her there.
 */
export function SupplementsCard({
  date,
  onLogShake,
}: {
  date: string;
  /** Opens the food picker on the caloric supplements. */
  onLogShake: () => void;
}) {
  const list = useLiveQuery(() => getSupplementChecklist(date), [date]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!list) return null;

  const tick = async (id: string, taken: boolean) => {
    setBusyId(id);
    await setSupplementTaken(id, taken, date);
    setBusyId(null);
  };

  return (
    <section className="card">
      <header className="supp-head">
        <div>
          <h2 className="with-icon">
            <IconPill size={19} />
            Supplements
          </h2>
          <p className="hint">
            {list.total === 0
              ? 'Iron, vitamin D, whatever your doctor has you on. Add it once, then tick it off each day.'
              : 'Tick what you have taken today.'}
          </p>
        </div>
        {list.total > 0 && (
          <span className={`set-tally ${list.taken === list.total ? 'good' : ''}`}>
            {list.taken}/{list.total}
          </span>
        )}
      </header>

      {list.rows.length > 0 && (
        <ul className="supp-list">
          {list.rows.map(({ supplement, taken }) => (
            <li key={supplement.id} className={`supp-row ${taken ? 'taken' : ''}`}>
              <button
                type="button"
                className="supp-tick"
                role="checkbox"
                aria-checked={taken}
                disabled={busyId === supplement.id}
                onClick={() => void tick(supplement.id, !taken)}
              >
                <span className="supp-box" aria-hidden="true">
                  {taken && <IconCheck size={14} />}
                </span>
                <span className="supp-text">
                  <span className="supp-name">{supplement.name}</span>
                  <span className="supp-desc">{describeSupplement(supplement)}</span>
                </span>
              </button>
              {editing && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void removeSupplement(supplement.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AddSupplementForm
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="supp-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>
            <IconPlus size={16} />
            Add a supplement
          </button>
          {list.total > 0 && (
            <button
              type="button"
              className="link-btn"
              onClick={() => setEditing(!editing)}
            >
              {editing ? 'Done editing' : 'Edit list'}
            </button>
          )}
        </div>
      )}

      <p className="fineprint">
        Protein shakes and bars have calories, so they go in the food log.{' '}
        <button type="button" className="link-btn inline" onClick={onLogShake}>
          Log a shake or bar
        </button>
      </p>
    </section>
  );
}

function AddSupplementForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [timing, setTiming] = useState<SupplementTiming>('with-food');
  const [busy, setBusy] = useState(false);

  const draft = normaliseSupplement({ name, dose, timing });

  return (
    <div className="custom-food">
      <p className="custom-title">What do you take?</p>

      {/* The common ones as a tap. A preset fills the name and the usual
          timing; both stay editable, because "with food" is what the packet
          says and her doctor may have said otherwise. */}
      <div className="chips tight">
        {SUPPLEMENT_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className={`chip small ${name === preset.name ? 'selected' : ''}`}
            onClick={() => {
              setName(preset.name);
              setTiming(preset.timing);
            }}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <label className="text-field">
        <span className="number-label">Name</span>
        <input
          type="text"
          value={name}
          maxLength={NAME_MAX}
          placeholder="Iron"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="text-field">
        <span className="number-label">Dose (optional)</span>
        <input
          type="text"
          value={dose}
          maxLength={DOSE_MAX}
          placeholder="1 tablet, 2000 IU, 5 g"
          onChange={(event) => setDose(event.target.value)}
        />
      </label>

      <div className="text-field">
        <span className="number-label">When</span>
        <div className="chips tight">
          {TIMING_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              className={`chip small ${timing === option ? 'selected' : ''}`}
              aria-pressed={timing === option}
              onClick={() => setTiming(option)}
            >
              {TIMING_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="custom-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!draft || busy}
          onClick={async () => {
            if (!draft) return;
            setBusy(true);
            await addSupplement(draft);
            setBusy(false);
            onDone();
          }}
        >
          Add to my list
        </button>
      </div>
    </div>
  );
}
