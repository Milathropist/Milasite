(() => {
  const ROWS = 9;
  const COLUMNS = 9;
  const MINE_COUNT = 10;
  const WINDOW_MARGIN = 12;
  const CLOSE_ANIMATION_DURATION = 260;
  const CLOSE_ANIMATION_NAME = "xp-window-close";
  const LONG_PRESS_DURATION = 360;
  const MAX_STARTING_CASCADE = 18;
  const MAX_LAYOUT_ATTEMPTS = 6;

  const state = {
    board: [],
    cellNodes: [],
    activeEffects: new Set(),
    boardArmed: false,
    hasPosition: false,
    status: "ready",
    revealedCount: 0,
    flagCount: 0,
    isClosing: false,
    closeAnimationHandler: null,
    closeTimerId: 0,
    closeOrigin: null,
    longPressTimerId: 0,
    suppressClickCell: null,
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

  const buildEmptyBoard = () =>
    Array.from({ length: ROWS }, (_, row) =>
      Array.from({ length: COLUMNS }, (_, column) => ({
        row,
        column,
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        isTriggeredMine: false,
        isMisflagged: false,
        adjacent: 0,
      }))
    );

  const isGameOver = () => state.status === "won" || state.status === "lost";

  const getNeighbors = (row, column) => {
    const neighbors = [];

    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (rowOffset === 0 && columnOffset === 0) continue;

        const nextRow = row + rowOffset;
        const nextColumn = column + columnOffset;
        if (nextRow < 0 || nextRow >= ROWS || nextColumn < 0 || nextColumn >= COLUMNS) {
          continue;
        }

        neighbors.push([nextRow, nextColumn]);
      }
    }

    return neighbors;
  };

  const shuffle = (items) => {
    const shuffled = items.slice();

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled;
  };

  const interpolateChannel = (start, end, factor) =>
    Math.round(start + (end - start) * factor);

  const interpolateColor = (start, end, factor, alpha) =>
    `rgba(${interpolateChannel(start[0], end[0], factor)}, ${interpolateChannel(start[1], end[1], factor)}, ${interpolateChannel(start[2], end[2], factor)}, ${alpha})`;

  const applyTilePalette = (node, row, column) => {
    const boardDepth = (row + column) / Math.max(1, ROWS + COLUMNS - 2);

    node.style.setProperty(
      "--ms-tile-top",
      interpolateColor([255, 235, 246], [232, 146, 193], boardDepth, 0.96)
    );
    node.style.setProperty(
      "--ms-tile-mid",
      interpolateColor([247, 191, 221], [193, 113, 193], boardDepth, 0.9)
    );
    node.style.setProperty(
      "--ms-tile-bottom",
      interpolateColor([230, 151, 203], [111, 55, 167], boardDepth, 0.94)
    );
  };

  const clearMineLayout = (board) => {
    board.forEach((row) => {
      row.forEach((cell) => {
        cell.isMine = false;
        cell.adjacent = 0;
      });
    });
  };

  const calculateAdjacencies = (board) => {
    board.forEach((row) => {
      row.forEach((cell) => {
        if (cell.isMine) {
          cell.adjacent = 0;
          return;
        }

        cell.adjacent = getNeighbors(cell.row, cell.column).reduce(
          (count, [neighborRow, neighborColumn]) =>
            count + (board[neighborRow][neighborColumn].isMine ? 1 : 0),
          0
        );
      });
    });
  };

  const applyMineLayout = (board, minePositions) => {
    clearMineLayout(board);
    minePositions.forEach(([row, column]) => {
      board[row][column].isMine = true;
    });
    calculateAdjacencies(board);
  };

  const measureCascadeSize = (board, startRow, startColumn) => {
    const visited = Array.from({ length: ROWS }, () => Array(COLUMNS).fill(false));
    const stack = [[startRow, startColumn]];
    let revealCount = 0;

    while (stack.length > 0) {
      const [row, column] = stack.pop();
      if (visited[row][column]) continue;
      visited[row][column] = true;

      const cell = board[row][column];
      if (!cell || cell.isMine) continue;

      revealCount += 1;

      if (cell.adjacent !== 0) continue;

      getNeighbors(row, column).forEach(([neighborRow, neighborColumn]) => {
        if (!visited[neighborRow][neighborColumn]) {
          stack.push([neighborRow, neighborColumn]);
        }
      });
    }

    return revealCount;
  };

  const init = () => {
    const windowNode = document.getElementById("minesweeperWindow");
    const boardNode = document.getElementById("minesweeperBoard");
    const metaNode = document.getElementById("minesweeperMeta");
    const counterNode = document.getElementById("minesweeperCounter");
    const stateNode = document.getElementById("minesweeperState");
    const actionsNode = document.getElementById("minesweeperActions");
    const explosionSoundNode = document.getElementById("minesweeperExplosionSound");
    const confettiSoundNode = document.getElementById("minesweeperConfettiSound");
    const openNodes = document.querySelectorAll("[data-minesweeper-open]");
    const closeNodes = document.querySelectorAll("[data-minesweeper-close]");
    const restartNodes = document.querySelectorAll("[data-minesweeper-restart]");
    const dragHandle = windowNode?.querySelector("[data-minesweeper-drag-handle]");

    if (
      !windowNode ||
      !boardNode ||
      !metaNode ||
      !counterNode ||
      !stateNode ||
      !actionsNode ||
      openNodes.length === 0
    ) {
      return;
    }

    windowNode.hidden = true;
    windowNode.setAttribute("aria-hidden", "true");

    const reduceMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const prefersReducedMotion = () => Boolean(reduceMotionQuery?.matches);

    const clearLongPressTimer = () => {
      if (!state.longPressTimerId) return;
      window.clearTimeout(state.longPressTimerId);
      state.longPressTimerId = 0;
    };

    const clearLongPressState = () => {
      clearLongPressTimer();
      state.suppressClickCell = null;
    };

    const stopSoundEffects = () => {
      [explosionSoundNode, confettiSoundNode].forEach((soundNode) => {
        if (!soundNode) return;
        soundNode.pause();
        try {
          soundNode.currentTime = 0;
        } catch {
        }
      });

      state.activeEffects.forEach((effect) => {
        effect.pause();
      });
      state.activeEffects.clear();
    };

    const playSoundEffect = (soundNode) => {
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

    const setRestartAvailability = (available) => {
      actionsNode.hidden = !available;
      restartNodes.forEach((node) => {
        node.disabled = !available;
        node.setAttribute("aria-disabled", available ? "false" : "true");
      });
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
      clearLongPressState();
      stopSoundEffects();
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

    const updateStatus = () => {
      const minesLeft = MINE_COUNT - state.flagCount;
      counterNode.textContent = `${minesLeft} mine${Math.abs(minesLeft) === 1 ? "" : "s"} left`;

      let stateLabel = "Ready";
      let metaLabel = "Tap a tile to start. Right-click or hold to place a flag.";

      if (state.status === "playing") {
        stateLabel = "Sweeping";
        metaLabel = "Clear every safe tile. Right-click or hold to place a flag.";
      } else if (state.status === "won") {
        stateLabel = "Cleared";
        metaLabel = "You cleared the field. Hit restart to play again.";
      } else if (state.status === "lost") {
        stateLabel = "Boom";
        metaLabel = "Boom. Hit restart to try another board.";
      }

      stateNode.textContent = stateLabel;
      stateNode.dataset.state = state.status;
      metaNode.textContent = metaLabel;
      setRestartAvailability(isGameOver());
    };

    const getCellLabel = (cell) => {
      const prefix = `Row ${cell.row + 1}, column ${cell.column + 1}`;

      if (cell.isTriggeredMine) {
        return `${prefix}, exploded mine.`;
      }

      if (cell.isMisflagged) {
        return `${prefix}, incorrect flag.`;
      }

      if (cell.isFlagged && !cell.isRevealed) {
        return `${prefix}, flagged.`;
      }

      if (cell.isMine && cell.isRevealed) {
        return `${prefix}, mine.`;
      }

      if (cell.isRevealed) {
        if (cell.adjacent > 0) {
          return `${prefix}, ${cell.adjacent} nearby mine${cell.adjacent === 1 ? "" : "s"}.`;
        }
        return `${prefix}, empty.`;
      }

      return `${prefix}, hidden tile.`;
    };

    const renderBoard = () => {
      state.board.forEach((row) => {
        row.forEach((cell) => {
          const node = state.cellNodes[cell.row][cell.column];
          if (!node) return;

          const classNames = ["minesweeper-cell"];
          let textContent = "";

          if (cell.isRevealed) {
            classNames.push("is-revealed");
          } else {
            classNames.push("is-hidden");
          }

          if (cell.isFlagged) {
            classNames.push("has-flag");
          }

          if (cell.isMisflagged) {
            classNames.push("is-misflagged");
          }

          if (cell.isRevealed && !cell.isMine && cell.adjacent === 0) {
            classNames.push("is-empty");
          }

          if (cell.isMine && cell.isRevealed) {
            classNames.push("is-mine");
          }

          if (cell.isTriggeredMine) {
            classNames.push("is-triggered");
          }

          if (cell.isRevealed && !cell.isMine && cell.adjacent > 0) {
            classNames.push(`count-${cell.adjacent}`);
            textContent = String(cell.adjacent);
          }

          node.className = classNames.join(" ");
          node.textContent = textContent;
          node.disabled = cell.isRevealed || isGameOver();
          node.setAttribute("aria-label", getCellLabel(cell));

          if (cell.isFlagged && !cell.isRevealed) {
            node.setAttribute("aria-pressed", "true");
          } else {
            node.removeAttribute("aria-pressed");
          }

          if (cell.isRevealed || isGameOver()) {
            node.setAttribute("tabindex", "-1");
          } else {
            node.setAttribute("tabindex", "0");
          }
        });
      });
    };

    const armBoard = (safeRow, safeColumn) => {
      const safeZone = new Set([`${safeRow}:${safeColumn}`]);
      const candidates = [];

      state.board.forEach((row) => {
        row.forEach((cell) => {
          if (!safeZone.has(`${cell.row}:${cell.column}`)) {
            candidates.push([cell.row, cell.column]);
          }
        });
      });

      for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt += 1) {
        const minePositions = shuffle(candidates).slice(0, MINE_COUNT);
        applyMineLayout(state.board, minePositions);

        const cascadeSize = measureCascadeSize(state.board, safeRow, safeColumn);
        if (cascadeSize <= MAX_STARTING_CASCADE || attempt === MAX_LAYOUT_ATTEMPTS - 1) {
          break;
        }
      }

      state.boardArmed = true;
    };

    const revealOpenArea = (startRow, startColumn) => {
      const stack = [[startRow, startColumn]];

      while (stack.length > 0) {
        const [row, column] = stack.pop();
        const cell = state.board[row][column];

        if (!cell || cell.isRevealed || cell.isFlagged || cell.isMine) continue;

        cell.isRevealed = true;
        state.revealedCount += 1;

        if (cell.adjacent !== 0) continue;

        getNeighbors(row, column).forEach(([neighborRow, neighborColumn]) => {
          const neighbor = state.board[neighborRow][neighborColumn];
          if (!neighbor.isRevealed && !neighbor.isFlagged && !neighbor.isMine) {
            stack.push([neighborRow, neighborColumn]);
          }
        });
      }
    };

    const revealMines = () => {
      state.board.forEach((row) => {
        row.forEach((cell) => {
          if (cell.isMine && !cell.isFlagged) {
            cell.isRevealed = true;
          }

          if (!cell.isMine && cell.isFlagged) {
            cell.isMisflagged = true;
          }
        });
      });
    };

    const maybeWin = () => {
      if (state.revealedCount !== ROWS * COLUMNS - MINE_COUNT) {
        return false;
      }

      state.status = "won";
      playSoundEffect(confettiSoundNode);
      state.board.forEach((row) => {
        row.forEach((cell) => {
          if (cell.isMine && !cell.isFlagged) {
            cell.isFlagged = true;
            state.flagCount += 1;
          }
        });
      });

      return true;
    };

    const revealCell = (row, column) => {
      if (isGameOver()) return;

      const cell = state.board[row][column];
      if (!cell || cell.isRevealed || cell.isFlagged) return;

      if (!state.boardArmed) {
        armBoard(row, column);
      }

      if (state.status === "ready") {
        state.status = "playing";
      }

      if (cell.isMine) {
        cell.isRevealed = true;
        cell.isTriggeredMine = true;
        state.status = "lost";
        revealMines();
        playSoundEffect(explosionSoundNode);
        renderBoard();
        updateStatus();
        restartNodes[0]?.focus();
        return;
      }

      revealOpenArea(row, column);

      if (maybeWin()) {
        renderBoard();
        updateStatus();
        restartNodes[0]?.focus();
        return;
      }

      renderBoard();
      updateStatus();
    };

    const toggleFlag = (row, column) => {
      if (isGameOver()) return false;

      const cell = state.board[row][column];
      if (!cell || cell.isRevealed) return false;

      cell.isFlagged = !cell.isFlagged;
      state.flagCount += cell.isFlagged ? 1 : -1;

      renderBoard();
      updateStatus();
      return true;
    };

    const focusFirstCell = () => {
      state.cellNodes[0]?.[0]?.focus();
    };

    const resetGame = () => {
      clearLongPressState();
      stopSoundEffects();
      state.board = buildEmptyBoard();
      state.boardArmed = false;
      state.status = "ready";
      state.revealedCount = 0;
      state.flagCount = 0;
      renderBoard();
      updateStatus();
    };

    const createCellNode = (row, column) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "minesweeper-cell is-hidden";
      button.dataset.row = String(row);
      button.dataset.column = String(column);
      applyTilePalette(button, row, column);

      button.addEventListener("click", (event) => {
        clearLongPressTimer();

        if (state.suppressClickCell === button) {
          state.suppressClickCell = null;
          event.preventDefault();
          return;
        }

        revealCell(row, column);
      });

      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        clearLongPressState();
        toggleFlag(row, column);
      });

      button.addEventListener("keydown", (event) => {
        if (event.key.toLowerCase() !== "f") return;
        event.preventDefault();
        toggleFlag(row, column);
      });

      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
        if (isGameOver()) return;

        clearLongPressTimer();
        state.longPressTimerId = window.setTimeout(() => {
          state.longPressTimerId = 0;
          if (toggleFlag(row, column)) {
            state.suppressClickCell = button;
            window.setTimeout(() => {
              if (state.suppressClickCell === button) {
                state.suppressClickCell = null;
              }
            }, 450);
          }
        }, LONG_PRESS_DURATION);
      });

      const cancelLongPress = () => {
        clearLongPressTimer();
      };

      button.addEventListener("pointerup", cancelLongPress);
      button.addEventListener("pointerleave", cancelLongPress);
      button.addEventListener("pointercancel", cancelLongPress);
      button.addEventListener("lostpointercapture", cancelLongPress);

      return button;
    };

    const buildBoardNodes = () => {
      boardNode.innerHTML = "";
      state.cellNodes = Array.from({ length: ROWS }, (_, row) =>
        Array.from({ length: COLUMNS }, (_, column) => {
          const cellNode = createCellNode(row, column);
          boardNode.appendChild(cellNode);
          return cellNode;
        })
      );
    };

    const close = () => {
      if (windowNode.hidden || state.isClosing) return;

      clearLongPressState();

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
      resetGame();
      windowNode.hidden = false;
      windowNode.setAttribute("aria-hidden", "false");

      if (!state.hasPosition) {
        requestAnimationFrame(() => {
          const rect = windowNode.getBoundingClientRect();
          const left = window.innerWidth - rect.width - WINDOW_MARGIN - 18;
          const top = Math.max(WINDOW_MARGIN, 118);
          setWindowPosition(windowNode, left, top, rect.width, rect.height);
        });
      }

      focusFirstCell();
    };

    buildBoardNodes();
    resetGame();

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
        resetGame();
        focusFirstCell();
      })
    );

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (windowNode.hidden) return;
      close();
    });

    window.addEventListener("resize", () => {
      if (windowNode.hidden || !state.hasPosition) return;
      const rect = windowNode.getBoundingClientRect();
      setWindowPosition(windowNode, rect.left, rect.top, rect.width, rect.height);
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
