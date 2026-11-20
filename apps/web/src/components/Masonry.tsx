import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useElementSize } from '@mantine/hooks';

/** Space between cards, in px (Mantine's "sm" spacing, as in the other card views). */
const GAP = 12;

export interface MasonryItem {
  key: string;
  node: ReactNode;
}

/**
 * Cards of their natural height in columns, as many columns as fit cards of at least `minWidth`.
 * Each card goes into the column that is shortest so far, in order, so the sort order still
 * reads left to right and then down. Cards are measured after each render (before the browser
 * paints, so nothing jumps) and again when their size changes (images loading, text wrapping).
 */
export function Masonry({ minWidth, items }: { minWidth: number; items: MasonryItem[] }) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const columns = Math.max(1, Math.floor((width + GAP) / (Math.min(minWidth, width || minWidth) + GAP)));
  const columnWidth = width ? (width - GAP * (columns - 1)) / columns : 0;

  const elements = useRef(new Map<string, HTMLDivElement>());
  const [heights, setHeights] = useState<Record<string, number>>({});

  const measure = useCallback(() => {
    setHeights((prev) => {
      const next: Record<string, number> = {};
      let changed = false;
      for (const [key, el] of elements.current) {
        next[key] = el.offsetHeight;
        if (prev[key] !== next[key]) changed = true;
      }
      return changed || Object.keys(prev).length !== Object.keys(next).length ? next : prev;
    });
  }, []);

  // New cards and new widths: measure before the browser paints.
  useLayoutEffect(measure);

  // Later changes in a card's height.
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    for (const el of elements.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [items, columnWidth, measure]);

  const tops = new Array<number>(columns).fill(0);
  const positions = items.map(({ key }) => {
    const column = tops.indexOf(Math.min(...tops));
    const position = { x: column * (columnWidth + GAP), y: tops[column]! };
    tops[column]! += (heights[key] ?? 0) + GAP;
    return position;
  });
  const height = Math.max(0, Math.max(...tops) - GAP);

  return (
    // Hidden until its width is known (the cards are laid out for it).
    <div ref={ref} style={{ position: 'relative', height, visibility: width ? undefined : 'hidden' }}>
      {items.map(({ key, node }, i) => (
        <div
          key={key}
          ref={(el) => {
            if (el) elements.current.set(key, el);
            else elements.current.delete(key);
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: columnWidth || '100%',
            transform: `translate(${positions[i]!.x}px, ${positions[i]!.y}px)`,
          }}
        >
          {node}
        </div>
      ))}
    </div>
  );
}
