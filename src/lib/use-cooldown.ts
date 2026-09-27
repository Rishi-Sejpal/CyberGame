'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A `Retry-After` countdown.
 *
 * Extracted because three forms need it and each reimplementation of an
 * `setInterval` inside a component is a place to leak a timer. The interval is
 * torn down on unmount and whenever `seconds` changes, so a cancelled or
 * double-submitted form cannot keep ticking.
 */
export function useCooldown(initialSeconds = 0) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (remaining <= 0) return;
    timer.current = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [remaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- restart only on 0 <-> non-zero

  return {
    remaining,
    active: remaining > 0,
    /** Clamped to five minutes so a hostile `Retry-After` cannot lock the form. */
    start: (seconds: number) => setRemaining(Math.min(300, Math.max(1, Math.floor(seconds)))),
    clear: () => setRemaining(0),
  };
}
