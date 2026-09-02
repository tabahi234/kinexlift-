import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useToast } from '../ToastProvider';
import { getChatMessage } from '../../db/queries';
import { getProfile } from '../../db/repo';
import { coachEnabled } from '../../domain/profile';
import { splitProposal, withoutDashes } from '../../domain/proposals';
import { askCoach, type CoachFocus } from '../../lib/coachClient';
import { aiConfigured } from '../../lib/ai';
import { useNav } from '../nav';
import { MessageProposal } from './ProposalCard';
import { useProposalContext } from './useProposalContext';

/**
 * The coach, where the question actually occurs to her.
 *
 * "What should I eat tonight?" is a thought she has on the Fuel screen, and
 * "my knee is sore, can I do something else?" is one she has standing in front
 * of a barbell. Making both of them a trip to a third tab, and a scroll back,
 * is how a feature ends up unused.
 *
 * It is the same conversation either way - the same thread, the same memory,
 * the same log - so anything asked here is in the coach's history tomorrow,
 * and the link out says so rather than pretending this is a separate assistant.
 */
export function AskPanel({
  title,
  hint,
  focus,
  suggestions,
}: {
  title: string;
  hint: string;
  focus: CoachFocus;
  suggestions: string[];
}) {
  const nav = useNav();
  const { showToast } = useToast();
  const profile = useLiveQuery(() => getProfile(), []);
  const proposalContext = useProposalContext();

  const [draft, setDraft] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = useLiveQuery(
    () => (answerId ? getChatMessage(answerId) : Promise.resolve(null)),
    [answerId],
  );

  // Nothing to offer and nothing to explain: without a key the coach cannot
  // answer at all, and a dead box is worse than no box.
  if (!aiConfigured() || !profile) return null;

  if (!coachEnabled(profile)) {
    return (
      <section className="card ask-panel">
        <header>
          <h2>{title}</h2>
          <p className="hint">
            The coach is the one part of this app that sends anything over the
            internet, so it stays off until you have read what it sends.
          </p>
        </header>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => nav.go('coach')}
        >
          See what it sends
        </button>
      </section>
    );
  }

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;
    setDraft('');
    setAsked(question);
    setAnswerId(null);
    setError(null);
    setSending(true);
    const outcome = await askCoach(question, { focus });
    setSending(false);
    if (outcome.ok) setAnswerId(outcome.messageId);
    else if (outcome.error.kind === 'failed') setError(outcome.error.message);
  };

  // The block is stripped whether or not a card can be built from it: she
  // should never be shown the machinery.
  const prose = answer ? withoutDashes(splitProposal(answer.content).prose) : null;

  return (
    <section className="card ask-panel">
      <header>
        <h2>{title}</h2>
        <p className="hint">{hint}</p>
      </header>

      {(asked || sending || prose) && (
        <div className="chat">
          {asked && (
            <div className="bubble bubble-user">
              <p>{asked}</p>
            </div>
          )}

          {sending && (
            <div className="bubble bubble-assistant bubble-pending">
              <p>Reading your log…</p>
            </div>
          )}

          {prose && (
            <div className="bubble bubble-assistant">
              <p>{prose}</p>
            </div>
          )}
        </div>
      )}

      {answer && (
        <MessageProposal
          key={answer.id}
          message={answer}
          context={proposalContext?.context ?? null}
          budget={proposalContext?.budget ?? null}
        />
      )}

      {error && (
        <div className="message warning">
          <p>{error}</p>
        </div>
      )}

      {!asked && suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((question) => (
            <button
              key={question}
              type="button"
              className="chip"
              onClick={() => void send(question)}
            >
              {question}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim().length === 0) {
            showToast('Please type a question before asking.', 'warn');
            return;
          }
          void send(draft);
        }}
      >
        <label className="sr-only" htmlFor={`ask-${focus}`}>
          {title}
        </label>
        <input
          id={`ask-${focus}`}
          type="text"
          value={draft}
          placeholder="Ask for something else…"
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={sending}
        >
          Ask
        </button>
      </form>

      <button type="button" className="link-btn" onClick={() => nav.go('coach')}>
        Open the whole conversation
      </button>
    </section>
  );
}
