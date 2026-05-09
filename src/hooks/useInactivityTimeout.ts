import { useEffect, useRef, useState } from 'react';

export function useInactivityTimeout(timeoutMs: number, onTimeout: () => void) {
  const [lastActivity, setLastActivity] = useState(Date.now());
  const timerRef = useRef<number | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    const reset = () => setLastActivity(Date.now());

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    for (const e of events) window.addEventListener(e, reset, { passive: true });

    return () => {
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onTimeoutRef.current();
    }, timeoutMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [lastActivity, timeoutMs]);
}
