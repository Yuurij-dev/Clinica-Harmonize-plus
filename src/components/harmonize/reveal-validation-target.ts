export function revealValidationTarget(targetId: string, scrollTargetId = targetId) {
  requestAnimationFrame(() => {
    const target = document.getElementById(targetId);
    const scrollTarget = document.getElementById(scrollTargetId);
    if (!target || !scrollTarget) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTarget.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: scrollTarget === target ? "start" : "center" });
    scrollTarget.focus({ preventScroll: true });
    if (reducedMotion) return;

    const startedAt = performance.now();
    let previousTop = scrollTarget.getBoundingClientRect().top;
    let settledFrames = 0;
    const shakeWhenSettled = () => {
      if (!target.isConnected) return;
      const top = scrollTarget.getBoundingClientRect().top;
      settledFrames = Math.abs(top - previousTop) < 0.5 ? settledFrames + 1 : 0;
      const elapsed = performance.now() - startedAt;
      if ((elapsed > 150 && settledFrames >= 3) || elapsed > 900) {
        target.animate([
          { transform: "translateX(0)" },
          { transform: "translateX(-7px)" },
          { transform: "translateX(7px)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(5px)" },
          { transform: "translateX(0)" },
        ], { duration: 420, easing: "ease-in-out" });
        return;
      }
      previousTop = top;
      requestAnimationFrame(shakeWhenSettled);
    };
    requestAnimationFrame(shakeWhenSettled);
  });
}
