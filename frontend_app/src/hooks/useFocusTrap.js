import { useEffect } from "react";

/**
 * Returns focusable elements within a container (best-effort).
 * @param {HTMLElement} container
 * @returns {HTMLElement[]}
 */
function getFocusable(container) {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ].join(",");

  const nodes = Array.from(container.querySelectorAll(selector));
  return nodes.filter((el) => {
    // Must be visible & not aria-hidden.
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && el.getAttribute("aria-hidden") !== "true";
  });
}

/**
 * PUBLIC_INTERFACE
 */
export function useFocusTrap({
  enabled,
  containerRef,
  initialFocusRef,
  onEscape
}) {
  /**
   * Focus trap implementation:
   * - When enabled, focus is moved into the container
   * - Tab/Shift+Tab are looped within the container focusables
   * - Escape triggers onEscape (if provided)
   *
   * This is intentionally lightweight and dependency-free.
   */
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef?.current;
    if (!container) return;

    const previouslyFocused = /** @type {HTMLElement|null} */ (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const focusInitial = () => {
      const preferred = initialFocusRef?.current;
      if (preferred && container.contains(preferred)) {
        preferred.focus();
        return;
      }
      const focusables = getFocusable(container);
      (focusables[0] || container).focus();
    };

    // Ensure the container can receive focus even if empty.
    if (!container.hasAttribute("tabindex")) {
      container.setAttribute("tabindex", "-1");
    }

    // Focus on next tick so DOM is painted.
    const t = window.setTimeout(focusInitial, 0);

    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (!enabled) return;
      if (!containerRef?.current) return;

      if (e.key === "Escape") {
        onEscape?.();
        return;
      }

      if (e.key !== "Tab") return;

      const focusables = getFocusable(containerRef.current);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      const active = document.activeElement;
      const currentIndex = focusables.findIndex((el) => el === active);

      // If focus is not inside container, redirect to first/last depending on direction.
      if (currentIndex === -1) {
        e.preventDefault();
        (e.shiftKey ? focusables[focusables.length - 1] : focusables[0]).focus();
        return;
      }

      if (e.shiftKey) {
        if (currentIndex === 0) {
          e.preventDefault();
          focusables[focusables.length - 1].focus();
        }
        return;
      }

      if (currentIndex === focusables.length - 1) {
        e.preventDefault();
        focusables[0].focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus to whatever was focused before the trap opened.
      previouslyFocused?.focus?.();
    };
  }, [enabled, containerRef, initialFocusRef, onEscape]);
}

