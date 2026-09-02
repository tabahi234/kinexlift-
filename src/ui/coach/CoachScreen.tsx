import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getChatMessages, getCoachNotes, getLiftSnapshots } from '../../db/queries';
import { getNutritionContext } from '../../db/derived';
import {
  addCoachNote,
  clearCoachMemory,
  deleteChatMessage,
  deleteCoachNote,
} from '../../db/actions';
import { getProfile, updateProfile } from '../../db/repo';
import { askCoach, suggestedQuestions } from '../../lib/coachClient';
import { aiConfigured } from '../../lib/ai';
import { coachEnabled, trainingStyleOf } from '../../domain/profile';
import { APP_NAME } from '../../config';
import { splitProposal, withoutDashes } from '../../domain/proposals';
import { MessageProposal } from './ProposalCard';
import { useProposalContext } from './useProposalContext';
import { IconClose, IconMenu } from '../icons';
import type { CoachNote } from '../../db/schema';

/**
 * The coach.
 *
 * Two decisions shape this screen.
 *
 * It is off until she turns it on, with a plain description of what leaves the
 * device. Every other screen in this app works with the plane in flight mode;
 * this one does not, and hiding that in a settings toggle would be a quiet
 * betrayal of the promise the onboarding made in writing.
 *
 * The rest of it looks like a chat because it is one. A thread, a box at the
 * bottom, and everything that is *about* the conversation rather than in it -
 * standing notes, what it remembers, and the two ways to stop - behind a menu
 * in the corner. It used to be three cards stacked under the composer, which
 * pushed the one control she came to use two scrolls up the page.
 *
 * What was there and is not any more: a card that printed the exact briefing
 * text. The honesty was right and the placement was wrong - a wall of
 * generated prose sitting permanently under the chat, answering a question
 * almost nobody was asking at that moment. What it is allowed to send is
 * still listed in full on the consent screen above, before she agrees to any
 * of it, which is where that belongs.
 */

/**
 * Who is talking, and how loudly.
 *
 * On an empty screen the app should introduce itself: an assistant that opens
 * with a blank box and a cursor is asking her to guess what it is for. Once
 * there is a conversation, that greeting is in the way of it - so the name
 * shrinks to a mark in the corner and the thread gets the screen.
 */
function CoachHeader({
  started,
  onOpenDrawer,
}: {
  started: boolean;
  /** Null before she has turned the coach on: there is nothing to set yet. */
  onOpenDrawer: (() => void) | null;
}) {
  const menu = onOpenDrawer && (
    <button
      type="button"
      className="icon-btn"
      aria-label="Coach settings"
      onClick={onOpenDrawer}
    >
      <IconMenu size={20} />
    </button>
  );

  if (started) {
    return (
      <header className="brandbar coach-bar">
        <span className="brandmark">{APP_NAME}</span>
        <span className="brandbar-label">Coach</span>
        {menu}
      </header>
    );
  }

  return (
    <header className="masthead welcome">
      <div className="masthead-top">
        <p className="eyebrow">Coach</p>
        {menu}
      </div>
      <h1>Welcome to {APP_NAME}</h1>
      <p className="sub">
        Your personal trainer, built for women. It has already read your log:
        how your lifts are moving, what you have eaten today, how you said you
        feel. Ask it anything, or ask it for tonight&rsquo;s dinner and add it in
        one tap.
      </p>
    </header>
  );
}

function Consent({ onEnable }: { onEnable: () => void }) {
  return (
    <section className="card">
      <header>
        <h2>The coach is off</h2>
      </header>
      <p className="lede">
        Everything else in this app runs on your device with no network at all.
        The coach is the exception: to answer a question it sends a summary of
        your training to a language model over the internet.
      </p>
      <p className="hint">What gets sent, every time you ask something:</p>
      <ul className="plain-list">
        <li>Your goal, experience, programme and equipment</li>
        <li>How your lifts are moving, and which have stalled</li>
        <li>Your recent check-in scores</li>
        <li>Your calorie and protein targets, and what you have logged today</li>
        <li>If you track it, your cycle length and estimated phase</li>
        <li>What you have said to the coach before</li>
        <li>
          The list of foods your settings allow, and today’s exercise slots, so
          it can offer you something you will actually eat or do
        </li>
      </ul>
      <p className="hint">
        Your name is never sent, because the app does not have it. You can read the
        exact text before it goes, turn this off at any time, and delete the whole
        conversation in one tap.
      </p>
      <button type="button" className="btn btn-primary" onClick={onEnable}>
        Turn the coach on
      </button>
      <p className="fineprint">
        The coach explains what the app decided. It can offer you food for today’s
        log and swap an exercise for one already on offer for that slot, as a card
        you tap, never on its own. It cannot change your weights, your sets or your
        targets, and it is not a clinician.
      </p>
    </section>
  );
}

/**
 * The drawer.
 *
 * Everything that is about the conversation rather than in it: what it should
 * always know, what it remembers from earlier, and the two ways to stop.
 *
 * It is a drawer because a chat screen is one column of message and one box to
 * type in, and anything else stacked underneath pushes the box off the bottom
 * of the phone. The old screen had three cards down there, so the composer sat
 * two thumb-scrolls above a wall of settings.
 */
function CoachDrawer({
  open,
  onClose,
  facts,
  summaries,
  onEnd,
}: {
  open: boolean;
  onClose: () => void;
  facts: CoachNote[];
  summaries: CoachNote[];
  onEnd: () => void;
}) {
  const [fact, setFact] = useState('');

  return (
    <>
      {/* Click-outside-to-close, and the dimming that says the thread is
          still there behind it. */}
      <div
        className={`drawer-scrim ${open ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`drawer ${open ? 'open' : ''}`}
        aria-hidden={!open}
        aria-label="Coach settings"
      >
        <header className="drawer-head">
          <h2>Coach</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <IconClose size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-section">
            <h3>Things it should always know</h3>
            <p className="fineprint">
              Sent with every question and never summarised away: a bad wrist, a
              wedding in June, a food you cannot stand.
            </p>

            {facts.map((note) => (
              <div key={note.id} className="drawer-row">
                <span className="drawer-row-text">{note.content}</span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void deleteCoachNote(note.id)}
                >
                  Remove
                </button>
              </div>
            ))}

            <form
              className="drawer-add"
              onSubmit={async (event) => {
                event.preventDefault();
                const text = fact.trim();
                if (!text) return;
                setFact('');
                await addCoachNote('fact', text);
              }}
            >
              <label className="sr-only" htmlFor="coach-fact">
                Something the coach should always know
              </label>
              <input
                id="coach-fact"
                type="text"
                value={fact}
                placeholder="Add a note"
                onChange={(event) => setFact(event.target.value)}
              />
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={fact.trim().length === 0}
              >
                Save
              </button>
            </form>
          </section>

          {summaries.length > 0 && (
            <section className="drawer-section">
              <h3>What it remembers from earlier</h3>
              <p className="hint">{summaries.at(-1)!.content}</p>
            </section>
          )}

          <section className="drawer-section">
            <h3>Stopping</h3>
            <button
              type="button"
              className="btn btn-quiet btn-block"
              onClick={() => void clearCoachMemory()}
            >
              Forget the conversation
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-block"
              onClick={onEnd}
            >
              Turn the coach off
            </button>
            <p className="fineprint">
              Forgetting deletes the messages and the summaries written from
              them. The notes above are yours rather than the coach&rsquo;s, so
              they stay until you remove them.
            </p>
          </section>
        </div>
      </aside>
    </>
  );
}

export function CoachScreen() {
  const profile = useLiveQuery(() => getProfile(), []);
  const messages = useLiveQuery(() => getChatMessages(200), []);
  const notes = useLiveQuery(() => getCoachNotes(), []);
  const lifts = useLiveQuery(() => getLiftSnapshots(8), []);
  const nutrition = useLiveQuery(() => getNutritionContext(), []);
  const proposalContext = useProposalContext();

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length, sending]);

  if (!profile || !messages) return <p className="loading-note">Loading…</p>;

  if (!coachEnabled(profile)) {
    return (
      <>
        <CoachHeader started={false} onOpenDrawer={null} />
        <Consent onEnable={() => void updateProfile({ coachOptIn: true })} />
      </>
    );
  }

  if (!aiConfigured()) {
    return (
      <>
        <header className="masthead">
          <p className="eyebrow">Coach</p>
          <h1>Not configured</h1>
        </header>
        <section className="card">
          <p className="lede">
            There is no model API key in this build, so the coach cannot answer.
            Everything else in the app works exactly as it did.
          </p>
          <p className="fineprint">
            Set <code>VITE_GROQ_API_KEY</code> in <code>.env</code> and restart the
            dev server.
          </p>
        </section>
      </>
    );
  }

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;
    setDraft('');
    setError(null);
    setSending(true);
    const outcome = await askCoach(question);
    setSending(false);
    if (!outcome.ok && outcome.error.kind === 'failed') {
      setError(outcome.error.message);
    }
  };

  /**
   * Ask the same question again after a failure.
   *
   * The failed reply and the question that produced it are both removed first.
   * Leaving them would send the model a transcript containing an unanswered
   * question and an error message, and ask it to carry on from there.
   */
  const retry = async (index: number) => {
    const failed = messages[index];
    const question = messages[index - 1];
    if (!failed || question?.role !== 'user') return;

    await deleteChatMessage(failed.id);
    await deleteChatMessage(question.id);
    await send(question.content);
  };

  const suggestions = suggestedQuestions({
    hasStall: (lifts ?? []).some((lift) => lift.stalled),
    hasNutrition: Boolean(nutrition?.plan),
    tracksCycle: profile.cycleTracking === 'track',
    hybrid: trainingStyleOf(profile) === 'hybrid',
    sessions: (lifts ?? []).length,
  });

  const started = messages.length > 0;

  return (
    <div className="coach">
      <CoachHeader started={started} onOpenDrawer={() => setDrawer(true)} />

      <div className="coach-thread">
        {!started && !sending && (
          <div className="chips coach-suggestions">
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

        <div className="chat" hidden={!started && !sending}>
          {messages.map((message, index) => {
            // The block the model appends is machinery, not conversation: it is
            // stripped from every reply whether or not the card can be built
            // from it, so a parse that fails shows her a normal answer rather
            // than a paragraph of JSON.
            const prose = withoutDashes(splitProposal(message.content).prose);

            return (
              <div key={message.id}>
                <div
                  className={`bubble bubble-${message.role} ${message.failed ? 'bubble-failed' : ''}`}
                >
                  <p>{prose}</p>
                  {message.failed && (
                    <div className="btn-row">
                      <button
                        type="button"
                        className="link-btn"
                        disabled={sending}
                        onClick={() => void retry(index)}
                      >
                        Try again
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void deleteChatMessage(message.id)}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>

                <MessageProposal
                  message={message}
                  context={proposalContext?.context ?? null}
                  budget={proposalContext?.budget ?? null}
                />
              </div>
            );
          })}

          {sending && (
            <div className="bubble bubble-assistant bubble-pending">
              <p>Reading your log…</p>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {error && (
          <div className="message warning">
            <p>{error}</p>
          </div>
        )}
      </div>

      <form
        className="composer coach-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <label className="sr-only" htmlFor="coach-input">
          Ask the coach
        </label>
        <input
          id="coach-input"
          type="text"
          value={draft}
          placeholder="Ask something"
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={sending || draft.trim().length === 0}
        >
          Send
        </button>
      </form>

      <CoachDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        facts={(notes ?? []).filter((note) => note.kind === 'fact')}
        summaries={(notes ?? []).filter((note) => note.kind === 'summary')}
        onEnd={() => {
          setDrawer(false);
          void updateProfile({ coachOptIn: false });
        }}
      />
    </div>
  );
}
