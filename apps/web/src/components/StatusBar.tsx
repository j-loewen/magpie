import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Height of the status bar along the bottom of the app (like VS Code's), in px. It is always shown. */
export const STATUS_BAR_HEIGHT = 28;

const StatusBarContext = createContext<HTMLElement | null>(null);
export const StatusBarProvider = StatusBarContext.Provider;

/** For the app layout: `ref` goes on the bar's element, `target` is passed to StatusBarProvider. */
export function useStatusBarHost() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return { target, ref: setTarget };
}

/**
 * Shows its children in the status bar while the page is open (pages without one leave it empty).
 * The bar lays them out in a row, spread to both ends: put the left-hand items in one element and
 * the right-hand ones in another.
 */
export function StatusBar({ children }: { children: ReactNode }) {
  const target = useContext(StatusBarContext);
  return target ? createPortal(children, target) : null;
}

/** Plain text in the status bar (counts, hints). */
export function StatusText({ children }: { children: ReactNode }) {
  return <span className="status-item">{children}</span>;
}

/** "1 item", "3 items". */
export const countLabel = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
