/**
 * The icon set.
 *
 * Hand-drawn paths rather than an icon package, for the same reason the
 * exercise library and the food table are hand-written: a dependency would
 * bring three thousand glyphs to use fifteen, and none of them would be shaped
 * for this app.
 *
 * Every one is a 24-unit box, stroked rather than filled, and inherits
 * `currentColor` - so an icon is coloured by the text beside it and needs no
 * dark-mode variant. Sizes come from the caller, because an icon in a tab bar
 * and an icon in a checklist row are not the same size and should not pretend
 * to be.
 */

export interface IconProps {
  /** Pixels. Square. */
  size?: number;
  className?: string;
}

function Glyph({
  size = 22,
  className,
  children,
  fill = false,
}: IconProps & { children: React.ReactNode; fill?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* -------------------------------- the tabs ------------------------------- */

export const IconDumbbell = (props: IconProps) => (
  <Glyph {...props}>
    {/* Bars, not strokes: plain lines read as "|H|" at tab-bar size. */}
    <rect x="2.4" y="9.2" width="3.4" height="5.6" rx="1.3" />
    <rect x="18.2" y="9.2" width="3.4" height="5.6" rx="1.3" />
    <rect x="6.2" y="6.6" width="3.6" height="10.8" rx="1.5" />
    <rect x="14.2" y="6.6" width="3.6" height="10.8" rx="1.5" />
    <path d="M9.8 12h4.4" />
  </Glyph>
);

export const IconBowl = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.2 11.2h17.6a8.8 8.8 0 0 1-17.6 0Z" />
    <path d="M12 11.2c0-2.9 2.1-5 5-5" />
    <path d="M12 11.2C12 9 10.1 7.2 8 7.2" />
  </Glyph>
);

export const IconChat = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M20.5 11.8a7.9 7.9 0 0 1-11.6 7L4 20.2l1.2-4A7.9 7.9 0 1 1 20.5 11.8Z" />
    <path d="M9 11.5h6M9 14.5h3.5" />
  </Glyph>
);

export const IconChart = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4 4v16h16" />
    <path d="m7.5 15 3.5-4.2 3 2.4L20 7" />
  </Glyph>
);

export const IconUser = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20.2a7 7 0 0 1 14 0" />
  </Glyph>
);

/* ------------------------------ the checklist ----------------------------- */

/** The daily check-in: how she feels, as a trace rather than a clipboard. */
export const IconPulse = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 12.5h3.6L9 6.5l4 12 2.4-6H21" />
  </Glyph>
);

/*
 * Protein and energy. A bolt rather than a flame: at sixteen pixels a flame is
 * a blob, and the app already has a droplet two rows further down the same
 * list.
 */
export const IconBolt = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M13.2 2.8 6.4 13.1h4.7l-1.3 8.1 6.8-10.3h-4.7Z" />
  </Glyph>
);

export const IconScale = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="4" y="4" width="16" height="16" rx="4.5" />
    <path d="M9 13.5a3 3 0 0 1 6 0" />
    <path d="m12 13.5 2.4-2.9" />
  </Glyph>
);

export const IconDroplet = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 3.4s5.6 5.9 5.6 9.6a5.6 5.6 0 0 1-11.2 0C6.4 9.3 12 3.4 12 3.4Z" />
  </Glyph>
);

export const IconCheck = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m4.8 12.6 4.8 4.8L19.4 7.6" />
  </Glyph>
);

export const IconChevron = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m9.5 6 6 6-6 6" />
  </Glyph>
);

export const IconPlus = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Glyph>
);

/** Opens the coach drawer. Three rules, drawn like the rest of the set. */
export const IconMenu = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
  </Glyph>
);

export const IconClose = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Glyph>
);

/** The coach, when it is about to offer something rather than answer. */
export const IconSpark = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M11 3.5 12.6 8.4 17.5 10l-4.9 1.6L11 16.5 9.4 11.6 4.5 10l4.9-1.6Z" />
    <path d="m18.2 14.6.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85Z" />
  </Glyph>
);

export const IconClock = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.4V12l3 1.8" />
  </Glyph>
);

/* --------------------------------- brand --------------------------------- */

/**
 * The mark.
 *
 * A K cut out of a rounded square, in the same olive as everything else. It
 * exists to give the first screen and the coach's greeting something to be
 * other than a sentence, and it is drawn rather than drawn *on* - no image
 * file, so it is crisp at any size and follows the palette into dark mode.
 */
export function Logo({ size = 56, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Kinex Lift"
    >
      <rect width="48" height="48" rx="15" fill="var(--accent)" />
      <g
        stroke="var(--on-accent)"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M17 13.5v21" />
        <path d="M33 13.5 21.5 24 33 34.5" />
      </g>
    </svg>
  );
}

/* --------------------------------- gauges -------------------------------- */

/**
 * A ring that fills as a number approaches its target.
 *
 * Two of them nested, because calories and protein are read together and
 * stacking them saves the screen having to say "and also" - the outer ring is
 * the calorie budget, the inner one is protein.
 *
 * Deliberately capped at a full circle. A ring that keeps going round on an
 * over-target day would say something the app does not believe: eating past a
 * target is information, not a failure, and the number in the middle already
 * says by how much.
 */
export function Dial({
  size = 132,
  rings,
  children,
}: {
  size?: number;
  /** Outermost first. */
  rings: { value: number; max: number; color: string; track?: string }[];
  children?: React.ReactNode;
}) {
  const stroke = 9;
  const gap = 4;

  return (
    <div className="dial" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {rings.map((ring, index) => {
          const radius = size / 2 - stroke / 2 - index * (stroke + gap);
          const circumference = 2 * Math.PI * radius;
          const fraction =
            ring.max > 0 ? Math.min(1, Math.max(0, ring.value / ring.max)) : 0;
          return (
            <g key={index} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={ring.track ?? 'var(--rule)'}
                strokeWidth={stroke}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - fraction)}
                className="dial-arc"
              />
            </g>
          );
        })}
      </svg>
      {children && <div className="dial-centre">{children}</div>}
    </div>
  );
}

/** A play triangle, for a link that opens a video. */
export const IconPlay = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M7.5 5.5v13l10-6.5z" />
  </Glyph>
);

/** A pill, for supplements. */
export const IconPill = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)" />
    <path d="M9.5 9.5l5 5" />
  </Glyph>
);

/** A box with a lid, for "your data": export, import, storage. */
export const IconArchive = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" />
    <path d="M5 9v9.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </Glyph>
);
