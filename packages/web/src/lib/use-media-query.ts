import { useEffect, useState } from "react";

/** True while the viewport matches `query`; updates on resize. */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
};

/** Breakpoints shared by the layout: one column below 768, overlay workspace below 1280. */
export const useLayoutMode = (): "mobile" | "compact" | "wide" => {
  const mobile = useMediaQuery("(max-width: 767px)");
  const compact = useMediaQuery("(max-width: 1279px)");
  return mobile ? "mobile" : compact ? "compact" : "wide";
};
