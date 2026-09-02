import { useEffect, useRef, useState } from 'react';
import { useToast } from './ToastProvider';
import {
  downloadExport,
  importBundle,
  parseBundle,
  wipeAll,
  type ImportReport,
} from '../db/export';
import { seedDemoData } from '../db/seed';
import {
  formatBytes,
  getPersistenceState,
  getStorageEstimate,
  requestPersistence,
  type PersistenceState,
} from '../lib/storage';

type Feedback = { tone: 'ok' | 'error' | 'neutral'; text: string } | null;

function describeImport(report: ImportReport): string {
  const { added, updated, skippedOlder, invalid } = report.total;
  const parts = [`${added} added`, `${updated} updated`];
  if (skippedOlder > 0) parts.push(`${skippedOlder} already current`);
  if (invalid > 0) parts.push(`${invalid} unreadable`);
  return `Imported: ${parts.join(', ')}.`;
}

const PERSISTENCE_COPY: Record<PersistenceState, { pill: string; hint: string }> = {
  persisted: {
    pill: 'Protected',
    hint: 'Your browser has agreed not to evict this data automatically.',
  },
  'best-effort': {
    pill: 'At risk',
    hint: 'Your browser may clear this data if the device runs low on space.',
  },
  unsupported: {
    pill: 'Unknown',
    hint: 'This browser cannot say whether the data is protected. Export regularly.',
  },
};

export function DataPanel() {
  const { showToast } = useToast();
  const [persistence, setPersistence] = useState<PersistenceState>('unsupported');
  const [usage, setUsage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refreshStorage() {
    setPersistence(await getPersistenceState());
    const estimate = await getStorageEstimate();
    setUsage(estimate ? formatBytes(estimate.usageBytes) : null);
  }

  useEffect(() => {
    void refreshStorage();
  }, []);

  async function run(task: () => Promise<Feedback>) {
    setBusy(true);
    try {
      const fb = await task();
      if (fb) {
        showToast(fb.text, fb.tone === 'neutral' ? 'warn' : fb.tone);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
      void refreshStorage();
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    event.target.value = '';
    if (!file) return;

    await run(async () => {
      const parsed = parseBundle(await file.text());
      if (!parsed.ok) return { tone: 'error', text: parsed.error };
      const report = await importBundle(parsed.bundle);
      return { tone: 'ok', text: describeImport(report) };
    });
  }

  const persistenceCopy = PERSISTENCE_COPY[persistence];

  return (
    <section className="card">
      <header>
        <h2>Your data</h2>
        <p className="hint">
          Everything lives in this browser, on this device. This file is a
          complete backup and needs no account at all.
        </p>
      </header>

      <div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">Storage</div>
            <div className="row-hint">{persistenceCopy.hint}</div>
          </div>
          <span className={`pill ${persistence === 'persisted' ? 'good' : 'warn'}`}>
            {persistenceCopy.pill}
          </span>
        </div>

        {usage && (
          <div className="row">
            <div className="row-text">
              <div className="row-title">Space used</div>
              <div className="row-hint">Training logs are tiny - years fit in a few MB.</div>
            </div>
            <span className="pill">{usage}</span>
          </div>
        )}
      </div>

      {persistence !== 'persisted' && persistence !== 'unsupported' && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const state = await requestPersistence();
              return state === 'persisted'
                ? { tone: 'ok', text: 'Storage protected.' }
                : {
                    tone: 'neutral',
                    text: 'Your browser declined for now. Keep exporting backups.',
                  };
            })
          }
        >
          Ask browser to protect this data
        </button>
      )}

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await downloadExport();
              return { tone: 'ok', text: 'Exported. Keep the file somewhere safe.' };
            })
          }
        >
          Export a backup
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          Import a backup
        </button>
      </div>

      <label className="visually-hidden" htmlFor="import-file">
        Choose an export file
      </label>
      <input
        id="import-file"
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={handleFile}
      />

      {/* Feedback is now handled via toasts */}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const counts = await seedDemoData();
              return {
                tone: 'ok',
                text: `Added ${counts.sessions} sessions and ${counts.sets} sets of demo history.`,
              };
            })
          }
        >
          Add demo history
        </button>

        {confirmingWipe ? (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await wipeAll();
                setConfirmingWipe(false);
                return { tone: 'neutral', text: 'All local data erased.' };
              })
            }
          >
            Tap again to erase everything
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => setConfirmingWipe(true)}
          >
            Erase all data
          </button>
        )}
      </div>
    </section>
  );
}
