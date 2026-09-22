import { useEffect, useState } from "react";

/** Local clock for presentation models. It never fetches or invalidates data. */
export function useAgendaClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const wake = () => setNow(new Date());
    const scheduleMinuteTick = () => {
      const delay = 60_000 - (Date.now() % 60_000);
      return window.setTimeout(() => {
        wake();
        interval = window.setInterval(wake, 60_000);
      }, delay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") wake();
    };

    let interval: number | undefined;
    const timeout = scheduleMinuteTick();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return now;
}
