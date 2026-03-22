(() => {
  const WINDOW_MARGIN = 12;
  const BUBBLE_COUNT = 36;
  const REFORM_DURATION = 420;
  const RESTART_WAVE_DURATION = 220;
  const CLOSE_ANIMATION_DURATION = 260;
  const CLOSE_ANIMATION_NAME = "xp-window-close";

  const state = {
    hasPosition: false,
    activeEffects: new Set(),
    isResetting: false,
    resetTimerIds: new Set(),
    isClosing: false,
    closeAnimationHandler: null,
    closeTimerId: 0,
    closeOrigin: null,
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const setWindowPosition = (windowNode, left, top, width, height) => {
    const maxLeft = Math.max(WINDOW_MARGIN, window.innerWidth - width - WINDOW_MARGIN);
    const maxTop = Math.max(WINDOW_MARGIN, window.innerHeight - height - WINDOW_MARGIN);
    const nextLeft = clamp(left, WINDOW_MARGIN, maxLeft);
    const nextTop = clamp(top, WINDOW_MARGIN, maxTop);
    windowNode.style.left = `${Math.round(nextLeft)}px`;
    windowNode.style.top = `${Math.round(nextTop)}px`;
    state.hasPosition = true;
  };

  const init = () => {
    const windowNode = document.getElementById("bubbleWrapWindow");
    const boardNode = document.getElementById("bubbleWrapBoard");
    const metaNode = document.getElementById("bubbleWrapMeta");
    const soundNode = document.getElementById("bubbleWrapPopSound");
    const openNodes = document.querySelectorAll("[data-bubble-wrap-open]");
    const closeNodes = document.querySelectorAll("[data-bubble-wrap-close]");
    const restartNodes = document.querySelectorAll("[data-bubble-wrap-restart]");
    const dragHandle = windowNode?.querySelector("[data-bubble-wrap-drag-handle]");

    if (!windowNode || !boardNode || !metaNode || openNodes.length === 0) return;

    windowNode.hidden = true;
    windowNode.setAttribute("aria-hidden", "true");

    const reduceMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const prefersReducedMotion = () => Boolean(reduceMotionQuery?.matches);

    const setRestartDisabled = (disabled) => {
      restartNodes.forEach((node) => {
        node.disabled = disabled;
        node.setAttribute("aria-disabled", disabled ? "true" : "false");
      });
    };

    const scheduleResetStep = (callback, delay) => {
      const timeoutId = window.setTimeout(() => {
        state.resetTimerIds.delete(timeoutId);
        callback();
      }, delay);

      state.resetTimerIds.add(timeoutId);
      return timeoutId;
    };

    const clearResetTimers = () => {
      state.resetTimerIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      state.resetTimerIds.clear();
      state.isResetting = false;
      setRestartDisabled(false);
    };

    const stopSounds = () => {
      if (soundNode) {
        soundNode.pause();
        try {
          soundNode.currentTime = 0;
        } catch {
        }
      }

      state.activeEffects.forEach((effect) => {
        effect.pause();
      });
      state.activeEffects.clear();
    };

    const clearCloseTimer = () => {
      if (!state.closeTimerId) return;
      window.clearTimeout(state.closeTimerId);
      state.closeTimerId = 0;
    };

    const clearCloseAnimation = () => {
      clearCloseTimer();
      if (state.closeAnimationHandler) {
        windowNode.removeEventListener("animationend", state.closeAnimationHandler);
        state.closeAnimationHandler = null;
      }
      state.isClosing = false;
      windowNode.classList.remove("is-closing");
    };

    const finishClose = () => {
      const fireworkOrigin = state.closeOrigin;
      state.closeOrigin = null;
      clearCloseAnimation();
      windowNode.hidden = true;
      windowNode.setAttribute("aria-hidden", "true");
      if (fireworkOrigin && !prefersReducedMotion()) {
        const fireworkNode = document.createElement("span");
        fireworkNode.className = "window-firework";
        fireworkNode.setAttribute("aria-hidden", "true");
        fireworkNode.style.left = `${Math.round(fireworkOrigin.x)}px`;
        fireworkNode.style.top = `${Math.round(fireworkOrigin.y)}px`;
        document.body.appendChild(fireworkNode);

        const removeFirework = () => {
          fireworkNode.remove();
        };

        fireworkNode.addEventListener("animationend", removeFirework, { once: true });
        window.setTimeout(removeFirework, 500);
      }
    };

    const setMeta = () => {
      const remaining = boardNode.querySelectorAll(".bubble-wrap-bubble:not(.is-popped)").length;
      metaNode.textContent = remaining
        ? `${remaining} bubble${remaining === 1 ? "" : "s"} left.`
        : "All popped. Hit restart to play again.";
    };

    const playPopSound = () => {
      if (!soundNode?.getAttribute("src")) return;

      const effect = soundNode.paused ? soundNode : soundNode.cloneNode();
      try {
        effect.currentTime = 0;
      } catch {
      }

      if (effect !== soundNode) {
        state.activeEffects.add(effect);
        effect.addEventListener(
          "ended",
          () => {
            state.activeEffects.delete(effect);
          },
          { once: true }
        );
      }

      const playPromise = effect.play();
      if (playPromise?.catch) {
        playPromise.catch(() => {
          if (effect !== soundNode) {
            state.activeEffects.delete(effect);
          }
        });
      }
    };

    const createBubble = (index) => {
      const bubble = document.createElement("button");
      bubble.type = "button";
      bubble.className = "bubble-wrap-bubble";
      bubble.dataset.bubbleIndex = String(index + 1);
      bubble.setAttribute("aria-label", `Pop bubble ${index + 1}`);

      bubble.addEventListener("click", () => {
        if (bubble.classList.contains("is-popped")) return;

        bubble.classList.add("is-popped");
        bubble.disabled = true;
        bubble.setAttribute("aria-label", `Bubble ${index + 1} popped`);
        playPopSound();
        setMeta();
      });

      return bubble;
    };

    const resetBoard = () => {
      clearResetTimers();
      stopSounds();
      boardNode.innerHTML = "";

      for (let index = 0; index < BUBBLE_COUNT; index += 1) {
        boardNode.appendChild(createBubble(index));
      }

      setMeta();
    };

    const getResetPlan = (bubbles) => {
      const boardRect = boardNode.getBoundingClientRect();
      const centerX = boardRect.left + boardRect.width / 2;
      const centerY = boardRect.top + boardRect.height / 2;

      const plan = bubbles.map((bubble, index) => {
        const rect = bubble.getBoundingClientRect();
        const bubbleCenterX = rect.left + rect.width / 2;
        const bubbleCenterY = rect.top + rect.height / 2;

        return {
          bubble,
          index,
          distance: Math.hypot(bubbleCenterX - centerX, bubbleCenterY - centerY),
        };
      });

      const maxDistance = plan.reduce(
        (furthestDistance, step) => Math.max(furthestDistance, step.distance),
        0
      );

      return plan
        .map((step) => ({
          ...step,
          delay: maxDistance
            ? Math.round((step.distance / maxDistance) * RESTART_WAVE_DURATION)
            : 0,
        }))
        .sort((leftStep, rightStep) => {
          if (leftStep.delay !== rightStep.delay) {
            return leftStep.delay - rightStep.delay;
          }
          if (leftStep.distance !== rightStep.distance) {
            return leftStep.distance - rightStep.distance;
          }
          return leftStep.index - rightStep.index;
        });
    };

    const restartBoard = () => {
      if (state.isResetting) return;

      const poppedBubbles = Array.from(
        boardNode.querySelectorAll(".bubble-wrap-bubble.is-popped")
      );
      if (!poppedBubbles.length) {
        boardNode.querySelector(".bubble-wrap-bubble")?.focus();
        return;
      }

      clearResetTimers();
      stopSounds();
      state.isResetting = true;
      setRestartDisabled(true);

      if (prefersReducedMotion()) {
        poppedBubbles.forEach((bubble, index) => {
          bubble.disabled = false;
          bubble.classList.remove("is-popped", "is-reforming");
          bubble.setAttribute(
            "aria-label",
            `Pop bubble ${bubble.dataset.bubbleIndex || String(index + 1)}`
          );
        });
        setMeta();
        state.isResetting = false;
        setRestartDisabled(false);
        boardNode.querySelector(".bubble-wrap-bubble")?.focus();
        return;
      }

      const resetPlan = getResetPlan(poppedBubbles);
      const finalDelay = resetPlan.reduce(
        (latestDelay, step) => Math.max(latestDelay, step.delay),
        0
      );

      resetPlan.forEach(({ bubble, index, delay }) => {
        scheduleResetStep(() => {
          bubble.disabled = false;
          bubble.classList.remove("is-popped");
          bubble.classList.add("is-reforming");
          bubble.setAttribute(
            "aria-label",
            `Pop bubble ${bubble.dataset.bubbleIndex || String(index + 1)}`
          );
          setMeta();

          scheduleResetStep(() => {
            bubble.classList.remove("is-reforming");
          }, REFORM_DURATION);
        }, delay);
      });

      scheduleResetStep(() => {
        state.isResetting = false;
        setRestartDisabled(false);
        boardNode.querySelector(".bubble-wrap-bubble")?.focus();
      }, finalDelay + REFORM_DURATION + 20);
    };

    const close = () => {
      if (windowNode.hidden || state.isClosing) return;

      clearResetTimers();
      stopSounds();

      const rect = windowNode.getBoundingClientRect();
      state.closeOrigin = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };

      if (prefersReducedMotion()) {
        finishClose();
        return;
      }

      clearCloseAnimation();
      state.isClosing = true;
      windowNode.classList.add("is-closing");
      state.closeAnimationHandler = (event) => {
        if (event.target !== windowNode || event.animationName !== CLOSE_ANIMATION_NAME) return;
        finishClose();
      };
      windowNode.addEventListener("animationend", state.closeAnimationHandler);
      state.closeTimerId = window.setTimeout(finishClose, CLOSE_ANIMATION_DURATION + 50);
    };

    const open = () => {
      clearCloseAnimation();
      state.closeOrigin = null;
      resetBoard();
      windowNode.hidden = false;
      windowNode.setAttribute("aria-hidden", "false");

      if (!state.hasPosition) {
        requestAnimationFrame(() => {
          const rect = windowNode.getBoundingClientRect();
          const left = window.innerWidth - rect.width - WINDOW_MARGIN;
          const top = Math.max(WINDOW_MARGIN, 96);
          setWindowPosition(windowNode, left, top, rect.width, rect.height);
        });
      }

      boardNode.querySelector(".bubble-wrap-bubble")?.focus();
    };

    windowNode.addEventListener("click", (event) => event.stopPropagation());
    windowNode.addEventListener("pointerdown", (event) => event.stopPropagation());

    openNodes.forEach((node) =>
      node.addEventListener("click", (event) => {
        event.preventDefault();
        open();
      })
    );
    closeNodes.forEach((node) => node.addEventListener("click", close));
    restartNodes.forEach((node) =>
      node.addEventListener("click", (event) => {
        event.preventDefault();
        restartBoard();
      })
    );

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (windowNode.hidden) return;
      close();
    });

    if (dragHandle) {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      let measuredWidth = 0;
      let measuredHeight = 0;

      dragHandle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (windowNode.hidden) return;
        if (event.target.closest("button, a, input")) return;

        dragging = true;
        windowNode.classList.add("is-dragging");

        const rect = windowNode.getBoundingClientRect();
        measuredWidth = rect.width;
        measuredHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;
        startX = event.clientX;
        startY = event.clientY;

        try {
          dragHandle.setPointerCapture(event.pointerId);
        } catch {
        }

        event.preventDefault();
      });

      dragHandle.addEventListener("pointermove", (event) => {
        if (!dragging) return;

        const nextLeft = startLeft + (event.clientX - startX);
        const nextTop = startTop + (event.clientY - startY);
        setWindowPosition(windowNode, nextLeft, nextTop, measuredWidth, measuredHeight);
        event.preventDefault();
      });

      const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        windowNode.classList.remove("is-dragging");
      };

      dragHandle.addEventListener("pointerup", endDrag);
      dragHandle.addEventListener("pointercancel", endDrag);
      dragHandle.addEventListener("lostpointercapture", endDrag);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
