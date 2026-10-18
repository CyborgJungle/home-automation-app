"use client";

// Hold a card, then drag it to a new place: the card lifts and follows the
// finger, the others slide out of the way, and letting go saves the order.
// A quick tap still taps, and a swipe still scrolls the page.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const HOLD_MS = 350;
const MOVE_TOLERANCE = 8; // px a finger may wander before the hold counts as a scroll

type Gesture = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  grabX: number; // where the card was grabbed, inside the card
  grabY: number;
  lastX: number;
  lastY: number;
};

export function useHoldReorder<T extends { id: string }>(items: T[], save: (ids: string[]) => void) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [lift, setLift] = useState({ x: 0, y: 0 });
  const gesture = useRef<Gesture | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());
  const tapBlocked = useRef(false);

  const ids = order ?? items.map((i) => i.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = ids.map((id) => byId.get(id)).filter((x): x is T => Boolean(x));

  // Stop the page from scrolling while a card is being dragged.
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (gesture.current?.active) e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);

  // Where the lifted card sits: under the finger, relative to its own slot.
  const follow = useCallback(() => {
    const g = gesture.current;
    const el = g && cards.current.get(g.id);
    if (!g || !el) return;
    const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    if (!parent) return;
    setLift({ x: g.lastX - g.grabX - parent.left - el.offsetLeft, y: g.lastY - g.grabY - parent.top - el.offsetTop });
  }, []);

  // Other cards glide to their new places (FLIP), and the lifted one stays under the finger.
  useLayoutEffect(() => {
    for (const [id, el] of cards.current) {
      const before = rects.current.get(id);
      const after = el.getBoundingClientRect();
      if (before && id !== dragId && (before.left !== after.left || before.top !== after.top)) {
        el.animate([{ translate: `${before.left - after.left}px ${before.top - after.top}px` }, { translate: "0 0" }], {
          duration: 180,
          easing: "ease-out",
        });
      }
    }
    rects.current.clear();
    follow();
  }, [order, dragId, follow]);

  const end = useCallback(
    (commit: boolean) => {
      const g = gesture.current;
      if (g?.timer) clearTimeout(g.timer);
      gesture.current = null;
      if (g?.active) {
        tapBlocked.current = true;
        setTimeout(() => (tapBlocked.current = false), 50);
        const final = order;
        if (commit && final && final.join() !== items.map((i) => i.id).join()) save(final);
      }
      setDragId(null);
      setOrder(null);
      setLift({ x: 0, y: 0 });
    },
    [items, order, save],
  );

  const bind = (id: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) cards.current.set(id, el);
      else cards.current.delete(id);
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (gesture.current || (e.pointerType === "mouse" && e.button !== 0)) return;
      const box = e.currentTarget.getBoundingClientRect();
      const g: Gesture = {
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        grabX: e.clientX - box.left,
        grabY: e.clientY - box.top,
        active: false,
        timer: null,
      };
      const el = e.currentTarget;
      g.timer = setTimeout(() => {
        g.active = true;
        g.timer = null;
        try {
          el.setPointerCapture(g.pointerId);
        } catch {}
        setOrder(items.map((i) => i.id));
        setDragId(id);
      }, HOLD_MS);
      gesture.current = g;
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      if (!g.active) {
        if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > MOVE_TOLERANCE) end(false);
        return;
      }
      // Over another card? Take its place.
      for (const [otherId, el] of cards.current) {
        if (otherId === g.id) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          for (const [cid, cel] of cards.current) rects.current.set(cid, cel.getBoundingClientRect());
          setOrder((prev) => {
            const list = [...(prev ?? items.map((i) => i.id))];
            const from = list.indexOf(g.id);
            const to = list.indexOf(otherId);
            if (from < 0 || to < 0 || from === to) return prev;
            list.splice(from, 1);
            list.splice(to, 0, g.id);
            return list;
          });
          return;
        }
      }
      follow();
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return {
    items: shown,
    bind,
    dragId,
    liftStyle: (id: string): React.CSSProperties | undefined =>
      id === dragId ? { transform: `translate(${lift.x}px, ${lift.y}px) scale(1.06)`, zIndex: 5, transition: "none" } : undefined,
    // A tap that ended a drag shouldn't also play the scene.
    tapAllowed: () => !tapBlocked.current,
  };
}
