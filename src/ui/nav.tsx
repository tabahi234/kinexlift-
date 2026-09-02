import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Screen } from '../domain/nextUp';

/**
 * Getting from one screen to the thing it told you to do.
 *
 * The app had five tabs and no way for anything on one of them to send her to
 * another. So a card could tell her "log your weight on Progress" and then
 * make her find it, which is the exact moment an app stops feeling like it is
 * on your side.
 *
 * `go` takes a tab and, optionally, what to open when she gets there. The
 * focus is a one-shot: the destination reads it, acts on it, and clears it, so
 * coming back to the tab later does not re-open a panel she has since closed.
 */

export type View = Screen;

export interface Nav {
  view: View;
  go: (view: View, focus?: string) => void;
  /** What this screen has been asked to open, if anything. */
  focus: string | null;
  clearFocus: () => void;
}

const NavContext = createContext<Nav>({
  view: 'today',
  go: () => {},
  focus: null,
  clearFocus: () => {},
});

export function NavProvider({ value, children }: { value: Nav; children: ReactNode }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  return useContext(NavContext);
}

/**
 * Runs the handler once when this screen is asked to open something, and
 * clears the request so it does not fire again on the next render.
 */
export function useFocusEffect(handler: (focus: string) => void): void {
  const { focus, clearFocus } = useNav();

  useEffect(() => {
    if (focus === null) return;
    handler(focus);
    clearFocus();
    // Deliberately keyed on the request alone. The handler is a fresh closure
    // on every render of the calling screen, so depending on it would fire
    // this on every render rather than on every request.
  }, [focus]);
}
