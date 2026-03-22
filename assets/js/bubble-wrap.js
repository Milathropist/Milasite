(() => {
  const WINDOW_MARGIN = 12;
  const BUBBLE_COUNT = 36;

  const state = {
    hasPosition: false,
    activeEffects: new Set(),
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
    const dragHandle = windowNode?.querySelector("[data-bubble-wrap-drag-handle]");

    if (!windowNode || !boardNode || !metaNode || openNodes.length === 0) return;

    windowNode.hidden = true;
    windowNode.setAttribute("aria-hidden", "true");

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

    const setMeta = () => {
      const remaining = boardNode.querySelectorAll(".bubble-wrap-bubble:not(.is-popped)").length;
      metaNode.textContent = remaining
        ? `${remaining} bubble${remaining === 1 ? "" : "s"} left.`
        : "All popped. Close and reopen to reset.";
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
      stopSounds();
      boardNode.innerHTML = "";

      for (let index = 0; index < BUBBLE_COUNT; index += 1) {
        boardNode.appendChild(createBubble(index));
      }

      setMeta();
    };

    const close = () => {
      stopSounds();
      windowNode.hidden = true;
      windowNode.setAttribute("aria-hidden", "true");
    };

    const open = () => {
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
