"use client";

// Hold a card, then drag it to a new place in the grid. The grid's slots are
// measured once when the card lifts; the card follows the finger, the slot
// nearest to it becomes its target, and the other cards glide into their new
// slots. Letting go settles the card into its slot and only then saves the
// order. A quick tap still taps, and a swipe still scrolls the page.
//
// Everything during the drag is done straight on the elements (CSS translate,
// which composes with a card's own tilt), so React doesn't re-render while
// the finger moves.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const HOLD_MS = 320;
const MOVE_TOLERANCE = 8; // px a finger may wander before the hold counts as a scroll
const GLIDE = "translate 240ms cubic-bezier(0.2, 0.9, 0.25, 1.15)";
const SETTLE_MS = 220;

type Slot = { x: number; y: number };

// Inline styles set during a drag (outside React, so it doesn't re-render).
const style = (el: HTMLElement, props: Partial<Pick<CSSStyleDeclaration, "transition" | "translate" | "scale" | "zIndex">>) =>
  Object.assign(el.style, props);

type Gesture = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  order: string[]; // order when the card lifted
  slots: Slot[]; // top-left of each slot, in that order
  target: number; // slot the card would drop into
  frame: number | null;
};

export function useHoldReorder<T extends { id: string }>(items: T[], save: (ids: string[]) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const clearAfterRender = useRef(false);
  const tapBlocked = useRef(false);

  const reset = useCallback(() => {
    for (const el of cards.current.values()) {
      style(el, { transition: "" });
      style(el, { translate: "" });
      style(el, { scale: "" });
      style(el, { zIndex: "" });
    }
  }, []);

  // The new order has rendered in place: drop the drag offsets before paint.
  useLayoutEffect(() => {
    if (!clearAfterRender.current) return;
    clearAfterRender.current = false;
    reset();
  }, [items, reset]);

  // Stop the page from scrolling while a card is being dragged.
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (gesture.current?.active) e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);

  const orderFor = (g: Gesture, target: number) => {
    const list = g.order.filter((id) => id !== g.id);
    list.splice(target, 0, g.id);
    return list;
  };

  // Move the lifted card with the finger, and the others to their slots.
  const paint = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    g.frame = null;
    const from = g.order.indexOf(g.id);
    const dx = g.lastX - g.startX;
    const dy = g.lastY - g.startY;
    const lifted = cards.current.get(g.id);
    if (lifted) style(lifted, { translate: `${dx}px ${dy}px` });

    // The nearest slot to where the card is now.
    const here = { x: g.slots[from].x + dx, y: g.slots[from].y + dy };
    let target = from;
    let best = Infinity;
    g.slots.forEach((s, i) => {
      const d = Math.hypot(s.x - here.x, s.y - here.y);
      if (d < best) {
        best = d;
        target = i;
      }
    });
    if (target === g.target) return;
    g.target = target;
    const next = orderFor(g, target);
    for (const [id, el] of cards.current) {
      if (id === g.id) continue;
      const a = g.slots[g.order.indexOf(id)];
      const b = g.slots[next.indexOf(id)];
      if (!a || !b) continue;
      style(el, { transition: GLIDE });
      style(el, { translate: a === b ? "0px 0px" : `${b.x - a.x}px ${b.y - a.y}px` });
    }
  }, []);

  const end = useCallback(
    (commit: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      if (g.timer) clearTimeout(g.timer);
      if (g.frame) cancelAnimationFrame(g.frame);
      if (!g.active) return;

      tapBlocked.current = true;
      setTimeout(() => (tapBlocked.current = false), 80);
      const from = g.order.indexOf(g.id);
      const target = commit ? g.target : from;
      const lifted = cards.current.get(g.id);

      // Settle the card into its slot, then save (or just tidy up).
      if (lifted) {
        style(lifted, { transition: `translate ${SETTLE_MS}ms cubic-bezier(0.2, 0.9, 0.25, 1), scale ${SETTLE_MS}ms ease` });
        style(lifted, { translate: `${g.slots[target].x - g.slots[from].x}px ${g.slots[target].y - g.slots[from].y}px` });
        style(lifted, { scale: "1" });
      }
      if (!commit) {
        for (const [id, el] of cards.current) {
          if (id === g.id) continue;
          style(el, { transition: GLIDE });
          style(el, { translate: "0px 0px" });
        }
      }
      setTimeout(() => {
        setDragId(null);
        if (target !== from) {
          clearAfterRender.current = true;
          save(orderFor(g, target));
        } else {
          reset();
        }
      }, SETTLE_MS);
    },
    [reset, save],
  );

  const bind = (id: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) cards.current.set(id, el);
      else cards.current.delete(id);
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (gesture.current || (e.pointerType === "mouse" && e.button !== 0)) return;
      const el = e.currentTarget;
      const g: Gesture = {
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        timer: null,
        active: false,
        order: [],
        slots: [],
        target: 0,
        frame: null,
      };
      g.timer = setTimeout(() => {
        g.timer = null;
        g.active = true;
        g.order = items.map((i) => i.id);
        // Slots are measured without any tilt, from the layout itself.
        g.slots = g.order.map((cid) => {
          const c = cards.current.get(cid);
          return { x: c?.offsetLeft ?? 0, y: c?.offsetTop ?? 0 };
        });
        g.target = g.order.indexOf(id);
        try {
          el.setPointerCapture(g.pointerId);
        } catch {}
        style(el, { transition: "scale 160ms ease" });
        style(el, { scale: "1.06" });
        style(el, { zIndex: "5" });
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
      if (!g.frame) g.frame = requestAnimationFrame(paint);
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return {
    bind,
    dragId,
    // A tap that ended a drag shouldn't also play the scene.
    tapAllowed: () => !tapBlocked.current,
  };
}
