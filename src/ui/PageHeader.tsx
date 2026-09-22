import type { ReactNode } from 'react';
import { IconChevron } from './icons';

/**
 * One header for every screen.
 *
 * Testers said they did not always know where they were. Each screen had
 * its own masthead markup and its own idea of what a sub-panel looked like,
 * so the fix is one component: an eyebrow naming the tab, a title naming the
 * page, a line saying what it is for - and, on anything one level down, a
 * back arrow that says where back goes.
 */
export function PageHeader({
  eyebrow,
  title,
  sub,
  onBack,
  backLabel = 'Back',
  children,
}: {
  eyebrow: string;
  title: string;
  sub?: ReactNode;
  /** Present on a sub-page. Renders the arrow and makes the eyebrow a link. */
  onBack?: () => void;
  backLabel?: string;
  children?: ReactNode;
}) {
  return (
    <header className={`masthead ${onBack ? 'has-back' : ''}`}>
      {onBack ? (
        <button type="button" className="back-link" onClick={onBack}>
          <IconChevron size={16} className="back-arrow" />
          <span className="eyebrow">{backLabel}</span>
        </button>
      ) : (
        <p className="eyebrow">{eyebrow}</p>
      )}
      <h1>{title}</h1>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </header>
  );
}

export interface SectionTab<T extends string> {
  id: T;
  label: string;
  /** One line under the strip saying what the tab is for. */
  about: string;
}

/** The segmented control with the "what this is for" line under it. */
export function SectionTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: SectionTab<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]!;
  return (
    <>
      <div className="segmented" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`segment ${active === tab.id ? 'selected' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="tab-about">{current.about}</p>
    </>
  );
}

/** A row in a settings menu: icon, title, one-line hint, chevron. */
export function MenuRow({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <li className="menu-item">
      <button type="button" className="menu-row" onClick={onClick}>
        <span className="menu-icon">{icon}</span>
        <span className="menu-text">
          <span className="menu-title">{title}</span>
          <span className="menu-hint">{hint}</span>
        </span>
        <IconChevron size={16} className="menu-go" />
      </button>
    </li>
  );
}
