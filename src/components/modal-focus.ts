"use client";
import { useEffect } from "react";
/** Focus follows the topmost dialog, with keyboard containment and restoration. */
export function useModalFocus() {
  useEffect(() => {
    let current: HTMLElement | null = null,
      previous: HTMLElement | null = null;
    const selector =
      'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),iframe,[tabindex="0"]';
    const update = () => {
      const modals = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
        top = modals[modals.length - 1] ?? null;
      if (top === current) return;
      if (top) {
        previous = document.activeElement as HTMLElement;
        current = top;
        top.querySelector<HTMLElement>(selector)?.focus();
      } else {
        current = null;
        previous?.focus();
        previous = null;
      }
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    function keyboard(event: KeyboardEvent) {
      if (!current) return;
      if (event.key === "Escape") {
        const close = current.querySelector<HTMLButtonElement>('button[aria-label^="Close"]');
        if (close) {
          event.preventDefault();
          close.click();
        }
      }
      if (event.key === "Tab") {
        const focusable = [...current.querySelectorAll<HTMLElement>(selector)].filter(
          (e) => e.getClientRects().length > 0,
        );
        if (!focusable.length) {
          event.preventDefault();
          return;
        }
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || !current.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", keyboard);
    };
  }, []);
}
