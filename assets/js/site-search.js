(() => {
  const getSearchIndexUrls = () => {
    const urls = [];
    const pushUrl = (value) => {
      if (!value) return;
      const url = String(value);
      if (!url) return;
      if (urls.includes(url)) return;
      urls.push(url);
    };

    const scriptNode =
      document.currentScript || document.querySelector('script[src*="site-search.js"]');
    const scriptSrc = scriptNode && scriptNode.src ? scriptNode.src : "";
    if (scriptSrc) {
      try {
        const scriptUrl = new URL(scriptSrc, window.location.href);

        // If assets are served from a CDN (or just a different origin), prefer the page origin
        // and only reuse the base path derived from where the assets live.
        const assetsMarkerIndex = scriptUrl.pathname.lastIndexOf("/assets/");
        if (assetsMarkerIndex !== -1) {
          const basePath = `${scriptUrl.pathname.slice(0, assetsMarkerIndex)}/`;
          pushUrl(new URL(`${basePath}search.json`, window.location.origin).toString());
        }

        const siteRoot = new URL("../../", scriptUrl);
        pushUrl(new URL("search.json", siteRoot).toString());
      } catch {
      }
    }

    try {
      const pageUrl = new URL(window.location.href);
      for (let depth = 0; depth <= 4; depth += 1) {
        const prefix = "../".repeat(depth);
        pushUrl(new URL(`${prefix}search.json`, pageUrl).toString());
      }
    } catch {
    }

    pushUrl("/search.json");
    return urls;
  };

  const SEARCH_INDEX_URLS = getSearchIndexUrls();
  const MIN_QUERY_LENGTH = 2;
  const MAX_RESULTS = 24;
  const WINDOW_MARGIN = 12;
  const CLOSE_ANIMATION_DURATION = 260;
  const CLOSE_ANIMATION_NAME = "xp-window-close";

  const normalizeText = (value) => {
    try {
      return String(value || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "");
    } catch {
      return String(value || "").toLowerCase();
    }
  };

  const tokenize = (query) =>
    normalizeText(query)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

  const state = {
    index: null,
    indexPromise: null,
    hasPosition: false,
    isClosing: false,
    closeAnimationHandler: null,
    closeTimerId: 0,
    closeOrigin: null,
  };

  const getIndex = async () => {
    if (state.index) return state.index;
    if (!state.indexPromise) {
      state.indexPromise = (async () => {
        let lastError = null;
        const attemptErrors = [];

        for (const url of SEARCH_INDEX_URLS) {
          try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
              throw new Error(`Search index request failed: ${response.status}`);
            }

            const rawText = await response.text();
            const trimmedStart = rawText.trimStart();
            if (trimmedStart.startsWith("---")) {
              throw new Error(
                "Search index looks unbuilt (Liquid/front matter detected). Make sure the site is served via Jekyll."
              );
            }

            const cleaned = rawText.replace(/^\uFEFF/, "");
            let data;
            try {
              data = JSON.parse(cleaned);
            } catch (parseError) {
              const head = trimmedStart.slice(0, 512);
              if (head.includes("{%") || head.includes("{{")) {
                throw new Error(
                  "Search index looks unbuilt (Liquid/front matter detected). Make sure the site is served via Jekyll."
                );
              }
              throw parseError;
            }
            state.index = Array.isArray(data) ? data : [];
            return state.index;
          } catch (error) {
            lastError = error;
            attemptErrors.push({ url, error });
          }
        }

        if (attemptErrors.length) {
          try {
            const summary = attemptErrors
              .map(({ url, error }) => {
                const message = error && error.message ? error.message : String(error);
                return `${url} -> ${message}`;
              })
              .join("\n");
            console.warn(`[SiteSearch] Failed to load search index:\n${summary}`);
          } catch {
          }
        }

        throw lastError || new Error("Search index failed to load.");
      })().catch((error) => {
        // Allow retry if the issue is transient (offline, rebuild, etc).
        state.indexPromise = null;
        throw error;
      });
    }
    return state.indexPromise;
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

  const renderEmpty = (resultsNode, message) => {
    resultsNode.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "xp-search-empty";
    empty.textContent = message;
    resultsNode.appendChild(empty);
  };

  const renderResults = (resultsNode, results) => {
    resultsNode.innerHTML = "";
    const fragment = document.createDocumentFragment();

    results.forEach((result) => {
      const anchor = document.createElement("a");
      anchor.href = result.url || "#";
      anchor.className = "xp-search-result";

      const title = document.createElement("span");
      title.className = "xp-search-result-title";
      title.textContent = result.title || "Untitled";

      const type = document.createElement("span");
      type.className = "xp-search-result-type";
      type.textContent = result.type || "";

      anchor.appendChild(title);
      anchor.appendChild(type);
      fragment.appendChild(anchor);
    });

    resultsNode.appendChild(fragment);
  };

  const getGroupRank = (item) => (item && item.group === "calendar" ? 1 : 0);

  const getOrderValue = (item) => {
    const value = Number(item && item.order);
    return Number.isFinite(value) ? value : 0;
  };

  const getDateValue = (item) => {
    const value = Date.parse(String((item && item.date) || ""));
    return Number.isFinite(value) ? value : 0;
  };

  const runSearch = (items, query) => {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const scored = [];
    for (const item of items) {
      const titleText = normalizeText(item.title);
      const contentText = normalizeText(item.content);
      const haystack = `${titleText} ${contentText}`;

      let score = 0;
      let matchesAll = true;
      for (const token of tokens) {
        const idx = haystack.indexOf(token);
        if (idx === -1) {
          matchesAll = false;
          break;
        }
        score += titleText.includes(token) ? 4 : 1;
      }
      if (!matchesAll) continue;
      scored.push({ item, score });
    }

    scored.sort((a, b) => {
      const groupDiff = getGroupRank(a.item) - getGroupRank(b.item);
      if (groupDiff !== 0) return groupDiff;

      if (getGroupRank(a.item) === 0) {
        const orderDiff = getOrderValue(b.item) - getOrderValue(a.item);
        if (orderDiff !== 0) return orderDiff;
      } else {
        const dateDiff = getDateValue(b.item) - getDateValue(a.item);
        if (dateDiff !== 0) return dateDiff;
      }

      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;

      return String(a.item?.title || "").localeCompare(String(b.item?.title || ""));
    });
    return scored.slice(0, MAX_RESULTS).map(({ item }) => item);
  };

  const init = () => {
    const windowNode = document.getElementById("siteSearchWindow");
    const inputNode = document.getElementById("siteSearchInput");
    const metaNode = document.getElementById("siteSearchMeta");
    const resultsNode = document.getElementById("siteSearchResults");
    const openNodes = document.querySelectorAll("[data-site-search-open]");
    const closeNodes = document.querySelectorAll("[data-site-search-close]");
    const dragHandle = windowNode?.querySelector("[data-site-search-drag-handle]");

    if (!windowNode || !inputNode || !resultsNode || !metaNode || openNodes.length === 0) return;

    // Ensure the window never flashes open before the user clicks the search icon.
    windowNode.hidden = true;
    windowNode.setAttribute("aria-hidden", "true");

    const reduceMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const prefersReducedMotion = () => Boolean(reduceMotionQuery?.matches);

    const setMeta = (value) => {
      metaNode.textContent = value || "";
    };

    const launchCloseFirework = (origin) => {
      if (!origin) return;

      const fireworkNode = document.createElement("span");
      fireworkNode.className = "window-firework";
      fireworkNode.setAttribute("aria-hidden", "true");
      fireworkNode.style.left = `${Math.round(origin.x)}px`;
      fireworkNode.style.top = `${Math.round(origin.y)}px`;
      document.body.appendChild(fireworkNode);

      const removeFirework = () => {
        fireworkNode.remove();
      };

      fireworkNode.addEventListener("animationend", removeFirework, { once: true });
      window.setTimeout(removeFirework, 500);
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

    const finishClose = (showFirework = false) => {
      const fireworkOrigin = showFirework ? state.closeOrigin : null;
      state.closeOrigin = null;
      clearCloseAnimation();
      windowNode.hidden = true;
      windowNode.setAttribute("aria-hidden", "true");
      if (fireworkOrigin) {
        launchCloseFirework(fireworkOrigin);
      }
    };

    const close = () => {
      if (windowNode.hidden || state.isClosing) return;

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
        finishClose(true);
      };
      windowNode.addEventListener("animationend", state.closeAnimationHandler);
      state.closeTimerId = window.setTimeout(
        () => finishClose(true),
        CLOSE_ANIMATION_DURATION + 50
      );
    };

    const open = async () => {
      clearCloseAnimation();
      state.closeOrigin = null;
      windowNode.hidden = false;
      windowNode.setAttribute("aria-hidden", "false");

      // Place near the top-right on first open (but keep draggable after).
      if (!state.hasPosition) {
        // Wait a frame so layout settles and we can measure dimensions.
        requestAnimationFrame(() => {
          const rect = windowNode.getBoundingClientRect();
          const left = window.innerWidth - rect.width - WINDOW_MARGIN;
          const top = Math.max(WINDOW_MARGIN, 72);
          setWindowPosition(windowNode, left, top, rect.width, rect.height);
        });
      }

      inputNode.focus();
      inputNode.select();

      setMeta("Loading articles and calendar...");
      try {
        await getIndex();
        if (inputNode.value.trim().length < MIN_QUERY_LENGTH) {
          setMeta(`Type at least ${MIN_QUERY_LENGTH} characters to search.`);
          renderEmpty(resultsNode, "No search yet.");
        } else {
          inputNode.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } catch (error) {
        setMeta("Search index failed to load.");
        renderEmpty(resultsNode, "Sorry, search is unavailable right now.");
      }
    };

    // Prevent background click handlers (like “click outside to go home”) from firing.
    windowNode.addEventListener("click", (event) => event.stopPropagation());
    windowNode.addEventListener("pointerdown", (event) => event.stopPropagation());

    openNodes.forEach((node) => node.addEventListener("click", open));
    closeNodes.forEach((node) => node.addEventListener("click", close));

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (windowNode.hidden) return;
      close();
    });

    resultsNode.addEventListener("click", (event) => {
      const anchor = event.target.closest("a");
      if (!anchor) return;
      close();
    });

    inputNode.addEventListener("input", async () => {
      const query = inputNode.value.trim();
      if (query.length < MIN_QUERY_LENGTH) {
        setMeta(`Type at least ${MIN_QUERY_LENGTH} characters to search.`);
        renderEmpty(resultsNode, "No results yet.");
        return;
      }

      try {
        const items = await getIndex();
        const results = runSearch(items, query);
        setMeta(results.length ? `Found ${results.length} result(s).` : "No matches.");
        if (!results.length) {
          renderEmpty(resultsNode, "No matches. Try a different word.");
          return;
        }
        renderResults(resultsNode, results);
      } catch {
        setMeta("Search index failed to load.");
        renderEmpty(resultsNode, "Sorry, search is unavailable right now.");
      }
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
