import { useEffect, useState } from "react";

/**
 * PUBLIC_INTERFACE
 * React hook that returns true when the given CSS media query matches.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);

    onChange();
    mql.addEventListener?.("change", onChange);
    // Safari fallback
    mql.addListener?.(onChange);

    return () => {
      mql.removeEventListener?.("change", onChange);
      mql.removeListener?.(onChange);
    };
  }, [query]);

  return matches;
}
