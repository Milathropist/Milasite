(() => {
  const root = document.getElementById("notFoundRunner");

  if (!root) return;

  const frame = root.querySelector(".not-found-game-frame");
  const scene = root.querySelector("[data-runner-scene]");
  const track = root.querySelector("[data-runner-track]");
  const dino = root.querySelector("[data-runner-dino]");
  const obstaclesLayer = root.querySelector("[data-runner-obstacles]");
  const overlay = root.querySelector("[data-runner-overlay]");
  const overlayCopy = root.querySelector("[data-runner-overlay-copy]");
  const retryButton = root.querySelector("[data-runner-retry]");
  const audioToggleButton = root.querySelector("[data-runner-audio-toggle]");
  const scoreNode = root.querySelector("[data-runner-score]");
  const bestNode = root.querySelector("[data-runner-best]");

  if (
    !frame ||
    !scene ||
    !track ||
    !dino ||
    !obstaclesLayer ||
    !overlay ||
    !overlayCopy ||
    !retryButton ||
    !audioToggleButton ||
    !scoreNode ||
    !bestNode
  ) {
    return;
  }

  const assetSources = {
    dino: root.dataset.dinoSrc || "",
    dinoDuck: root.dataset.dinoDuckSrc || "",
    ground: root.dataset.groundSrc || "",
    groundAlt: root.dataset.groundAltSrc || "",
    air: root.dataset.airSrc || "",
    music: root.dataset.musicSrc || "",
    duckSfx: root.dataset.duckSfxSrc || "",
  };

  if (
    !assetSources.dino ||
    !assetSources.dinoDuck ||
    !assetSources.ground ||
    !assetSources.groundAlt ||
    !assetSources.air
  ) {
    return;
  }

  const LOLIPOP_RATIO = 1903 / 927;
  const SPIRAL_CANDY_WIDTH_RATIO = 1837 / 953;
  const PAPER_PLANE_RATIO = 883 / 1910;
  const SCORE_NEGATIVE_INTERVAL = 120;
  const SPIRAL_UNLOCK_SCORE = 45;
  const AIR_UNLOCK_SCORE = 90;
  const GROUND_OBSTACLE_MAX_HEIGHT_RATIO = 0.9;
  const BASE_SPEED = 262;
  const SCORE_SPEED_LIMIT = 240;
  const GRAVITY = 1880;
  const DUCK_FALL_MULTIPLIER = 1.68;
  const MAX_JUMP_VELOCITY = 780;
  const MIN_JUMP_HEIGHT_RATIO = 0.5;
  const MIN_JUMP_CUTOFF_VELOCITY = MAX_JUMP_VELOCITY * Math.sqrt(MIN_JUMP_HEIGHT_RATIO);
  const MAX_FRAME_DELTA = 48;
  const STORAGE_KEY = "milancholy_404_runner_best";
  const music = assetSources.music ? new Audio(assetSources.music) : null;
  const duckSound = assetSources.duckSfx ? new Audio(assetSources.duckSfx) : null;

  if (music) {
    music.loop = true;
    music.preload = "auto";
    music.volume = 0.26;
  }

  if (duckSound) {
    duckSound.preload = "auto";
    duckSound.volume = 0.16;
  }

  const state = {
    alive: true,
    score: 0,
    best: loadBestScore(),
    scoreAccumulator: 0,
    speed: BASE_SPEED,
    spawnCooldown: 920,
    trackOffset: 0,
    dinoY: 0,
    velocityY: 0,
    lastFrame: performance.now(),
    obstacleId: 0,
    obstacles: [],
    duckHeld: false,
    ducking: false,
    jumpHeld: false,
    gameActive: false,
    hasInteracted: false,
    musicEnabled: true,
    metrics: {
      sceneWidth: 0,
      sceneHeight: 0,
      groundHeight: 0,
      playerX: 0,
      playerStandWidth: 0,
      playerStandHeight: 0,
      playerDuckWidth: 0,
      playerDuckHeight: 0,
    },
  };

  [assetSources.dino, assetSources.dinoDuck, assetSources.ground, assetSources.groundAlt, assetSources.air]
    .filter(Boolean)
    .forEach((src) => {
      const image = new Image();
      image.src = src;
    });

  function loadBestScore() {
    try {
      return Math.max(0, parseInt(window.localStorage.getItem(STORAGE_KEY) || "0", 10) || 0);
    } catch {
      return 0;
    }
  }

  function saveBestScore() {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(state.best));
    } catch {
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function choose(values) {
    return values[Math.floor(Math.random() * values.length)];
  }

  function formatScore(value) {
    return String(Math.max(0, Math.floor(value))).padStart(4, "0");
  }

  function updateScoreboard() {
    scoreNode.textContent = formatScore(state.score);
    bestNode.textContent = formatScore(state.best);
    updatePalette();
  }

  function updatePalette() {
    const useNegativePalette =
      Math.floor(Math.max(0, state.score) / SCORE_NEGATIVE_INTERVAL) % 2 === 1;

    frame.classList.toggle("is-negative", useNegativePalette);
  }

  function updateAudioButton() {
    audioToggleButton.classList.toggle("fa-volume", state.musicEnabled);
    audioToggleButton.classList.toggle("fa-volume-xmark", !state.musicEnabled);
    audioToggleButton.setAttribute("aria-pressed", state.musicEnabled ? "true" : "false");
    audioToggleButton.setAttribute(
      "aria-label",
      state.musicEnabled ? "Mute background music" : "Unmute background music"
    );
    audioToggleButton.title = state.musicEnabled ? "Mute background music" : "Unmute background music";
  }

  function pauseMusic(reset = false) {
    if (!music) return;

    music.pause();

    if (reset) {
      try {
        music.currentTime = 0;
      } catch {
      }
    }
  }

  function syncMusicPlayback({ restart = false } = {}) {
    updateAudioButton();

    if (!music) return;

    if (restart) {
      try {
        music.currentTime = 0;
      } catch {
      }
    }

    if (
      !state.musicEnabled ||
      !state.alive ||
      !state.hasInteracted ||
      document.visibilityState !== "visible"
    ) {
      pauseMusic(false);
      return;
    }

    const playback = music.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(() => {
      });
    }
  }

  function registerInteraction() {
    state.hasInteracted = true;
  }

  function setGameActive(active) {
    state.gameActive = active;

    if (active) return;

    releaseJump();
    setDuckHeld(false);
  }

  function playDuckSound() {
    if (!duckSound || !state.hasInteracted || document.visibilityState !== "visible") return;

    try {
      duckSound.currentTime = 0;
    } catch {
    }

    const playback = duckSound.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(() => {
      });
    }
  }

  function setOverlayVisible(visible) {
    overlay.classList.toggle("is-visible", visible);
    overlay.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function updateMetrics() {
    const dinoWasDucking = dino.classList.contains("is-ducking");
    const trackStyle = window.getComputedStyle(track);

    dino.classList.remove("is-ducking");
    const standingStyle = window.getComputedStyle(dino);
    dino.classList.add("is-ducking");
    const duckingStyle = window.getComputedStyle(dino);
    dino.classList.toggle("is-ducking", dinoWasDucking);

    state.metrics.sceneWidth = scene.clientWidth;
    state.metrics.sceneHeight = scene.clientHeight;
    state.metrics.groundHeight = parseFloat(trackStyle.height) || 44;
    state.metrics.playerX = parseFloat(standingStyle.left) || 52;
    state.metrics.playerStandWidth = parseFloat(standingStyle.width) || 88;
    state.metrics.playerStandHeight = parseFloat(standingStyle.height) || 92;
    state.metrics.playerDuckWidth =
      parseFloat(duckingStyle.width) || state.metrics.playerStandWidth * 1.12;
    state.metrics.playerDuckHeight =
      parseFloat(duckingStyle.height) || state.metrics.playerStandHeight * 0.66;
  }

  function updateSpeed() {
    const earlySpeedGain = Math.min(state.score, SCORE_SPEED_LIMIT) * 0.28;
    const lateSpeedGain = Math.max(0, state.score - AIR_UNLOCK_SCORE) * 0.08;
    state.speed = BASE_SPEED + earlySpeedGain + lateSpeedGain;
  }

  function getPlayerDimensions() {
    if (state.ducking) {
      return {
        width: state.metrics.playerDuckWidth,
        height: state.metrics.playerDuckHeight,
      };
    }

    return {
      width: state.metrics.playerStandWidth,
      height: state.metrics.playerStandHeight,
    };
  }

  function updateDuckState() {
    const wasDucking = state.ducking;
    state.ducking = state.alive && state.duckHeld && state.dinoY <= 0.001;

    if (!wasDucking && state.ducking) {
      playDuckSound();
    }
  }

  // Keep collisions a bit tighter than the sprite art so jumps feel fair.
  function getPlayerRect() {
    const { playerX } = state.metrics;
    const { width, height } = getPlayerDimensions();

    if (state.ducking) {
      return {
        left: playerX + width * 0.16,
        right: playerX + width * 0.84,
        bottom: state.dinoY + height * 0.08,
        top: state.dinoY + height * 0.7,
      };
    }

    return {
      left: playerX + width * 0.24,
      right: playerX + width * 0.73,
      bottom: state.dinoY + height * 0.12,
      top: state.dinoY + height * 0.8,
    };
  }

  function getObstacleRect(obstacle) {
    if (obstacle.type === "air") {
      return {
        left: obstacle.x + obstacle.width * 0.18,
        right: obstacle.x + obstacle.width * 0.78,
        bottom: obstacle.y + obstacle.height * 0.28,
        top: obstacle.y + obstacle.height * 0.72,
      };
    }

    if (obstacle.variant === "spiral") {
      return {
        left: obstacle.x + obstacle.width * 0.14,
        right: obstacle.x + obstacle.width * 0.86,
        bottom: obstacle.height * 0.12,
        top: obstacle.height * 0.8,
      };
    }

    return {
      left: obstacle.x + obstacle.width * 0.24,
      right: obstacle.x + obstacle.width * 0.76,
      bottom: obstacle.height * 0.08,
      top: obstacle.height * 0.86,
    };
  }

  function rectsOverlap(leftRect, rightRect) {
    return (
      leftRect.left < rightRect.right &&
      leftRect.right > rightRect.left &&
      leftRect.bottom < rightRect.top &&
      leftRect.top > rightRect.bottom
    );
  }

  function createObstacleNode(obstacle) {
    const node = document.createElement("div");
    const sprite = document.createElement("img");

    node.className =
      obstacle.type === "air"
        ? "not-found-game-obstacle not-found-game-obstacle--air"
        : "not-found-game-obstacle not-found-game-obstacle--ground";

    node.style.width = `${Math.round(obstacle.width)}px`;
    node.style.height = `${Math.round(obstacle.height)}px`;

    sprite.src = obstacle.spriteSrc;
    sprite.alt = "";
    sprite.decoding = "async";

    node.appendChild(sprite);

    return node;
  }

  function getNextSpawnDelay() {
    const minimum = state.score >= AIR_UNLOCK_SCORE ? 720 : 820;
    const maximum = state.score >= AIR_UNLOCK_SCORE ? 1380 : 1540;
    const speedPressure = clamp((state.speed - BASE_SPEED) * 1.45, 0, 240);

    return Math.max(520, randomBetween(minimum, maximum) - speedPressure);
  }

  function spawnObstacle() {
    const useAirObstacle = state.score >= AIR_UNLOCK_SCORE && Math.random() < 0.32;
    const useSpiralCandy =
      !useAirObstacle && state.score >= SPIRAL_UNLOCK_SCORE && Math.random() < 0.34;
    const {
      sceneWidth,
      sceneHeight,
      groundHeight,
      playerStandWidth,
      playerStandHeight,
    } = state.metrics;
    const obstacle = {
      id: state.obstacleId + 1,
      type: useAirObstacle ? "air" : "ground",
      variant: useAirObstacle ? "plane" : useSpiralCandy ? "spiral" : "lollipop",
      spriteSrc: useAirObstacle
        ? assetSources.air
        : useSpiralCandy
          ? assetSources.groundAlt
          : assetSources.ground,
      width: 0,
      height: 0,
      x: sceneWidth + randomBetween(28, 90),
      y: 0,
      speedFactor: useAirObstacle ? randomBetween(1.03, 1.14) : randomBetween(0.98, 1.04),
      node: null,
    };

    state.obstacleId += 1;

    if (useAirObstacle) {
      obstacle.width = playerStandWidth * randomBetween(0.92, 1.16);
      obstacle.height = obstacle.width * PAPER_PLANE_RATIO;

      const maxAirHeight = Math.max(
        28,
        sceneHeight - groundHeight - obstacle.height - playerStandHeight * 0.12
      );

      obstacle.y = clamp(
        choose([
          playerStandHeight * 0.38,
          playerStandHeight * 0.76,
          playerStandHeight * 1.08,
        ]),
        24,
        maxAirHeight
      );
    } else if (useSpiralCandy) {
      obstacle.height = playerStandHeight * choose([0.34, 0.4, 0.46]);
      obstacle.width = obstacle.height * SPIRAL_CANDY_WIDTH_RATIO;
    } else {
      obstacle.height =
        playerStandHeight * choose([0.52, 0.62, 0.72, GROUND_OBSTACLE_MAX_HEIGHT_RATIO]);
      obstacle.width = obstacle.height / LOLIPOP_RATIO;
    }

    const lastObstacle = state.obstacles[state.obstacles.length - 1];
    if (lastObstacle) {
      const gap = randomBetween(playerStandWidth * 1.8, playerStandWidth * 2.9);
      obstacle.x = Math.max(obstacle.x, lastObstacle.x + lastObstacle.width + gap);
    }

    obstacle.node = createObstacleNode(obstacle);
    obstaclesLayer.appendChild(obstacle.node);
    state.obstacles.push(obstacle);
    state.spawnCooldown = getNextSpawnDelay();
  }

  function clearObstacles() {
    state.obstacles.forEach((obstacle) => {
      obstacle.node?.remove();
    });
    state.obstacles = [];
  }

  function jump() {
    if (!state.alive) return;
    if (state.dinoY > 4) return;

    state.jumpHeld = true;
    state.velocityY = MAX_JUMP_VELOCITY;
    state.dinoY = Math.max(state.dinoY, 1);
    updateDuckState();
  }

  function releaseJump() {
    if (!state.jumpHeld) return;

    state.jumpHeld = false;

    if (!state.alive) return;
    if (state.dinoY <= 0.001) return;
    if (state.velocityY <= MIN_JUMP_CUTOFF_VELOCITY) return;

    state.velocityY = MIN_JUMP_CUTOFF_VELOCITY;
  }

  function setDuckHeld(nextValue) {
    state.duckHeld = nextValue;
    updateDuckState();
    render();
  }

  function render() {
    const grounded = state.dinoY <= 0.001;
    const runPulse = Math.abs(Math.sin(state.trackOffset * 0.16));
    const stride =
      state.alive && grounded ? Math.sin(Math.abs(state.trackOffset) * 0.16) * (state.ducking ? 0.9 : 2.1) : 0;
    const tilt = !state.alive ? 16 : state.ducking && grounded ? -2 : state.velocityY > 80 ? -4 : state.velocityY < -80 ? 4 : 0;
    const scaleX = state.alive && grounded ? 1 + runPulse * (state.ducking ? 0.012 : 0.018) : 1;
    const scaleY = state.alive && grounded ? 1 - runPulse * (state.ducking ? 0.014 : 0.02) : 1;
    const nextDinoSrc = state.ducking ? assetSources.dinoDuck : assetSources.dino;

    scene.style.setProperty("--runner-track-offset", `${Math.round(state.trackOffset)}px`);
    dino.classList.toggle("is-ducking", state.ducking);
    dino.style.transform = `translate3d(0, ${-(state.dinoY + stride)}px, 0) rotate(${tilt}deg) scale(${scaleX}, ${scaleY})`;
    dino.classList.toggle("is-dead", !state.alive);
    if (dino.dataset.poseSrc !== nextDinoSrc) {
      dino.src = nextDinoSrc;
      dino.dataset.poseSrc = nextDinoSrc;
    }

    state.obstacles.forEach((obstacle) => {
      obstacle.node.style.transform = `translate3d(${Math.round(obstacle.x)}px, ${-Math.round(obstacle.y)}px, 0)`;
    });
  }

  function handleGameOver() {
    state.alive = false;
    state.velocityY = 0;
    state.dinoY = 0;
    state.ducking = false;
    state.jumpHeld = false;

    if (state.score > state.best) {
      state.best = state.score;
      saveBestScore();
    }

    updateScoreboard();
    overlayCopy.textContent = `Score ${formatScore(state.score)}`;
    setOverlayVisible(true);
    pauseMusic(true);
    updateAudioButton();
    render();

    focusNode(retryButton);
  }

  function resetGame({ focusScene = true } = {}) {
    state.alive = true;
    state.score = 0;
    state.scoreAccumulator = 0;
    state.speed = BASE_SPEED;
    state.spawnCooldown = 900;
    state.trackOffset = 0;
    state.dinoY = 0;
    state.velocityY = 0;
    state.lastFrame = performance.now();
    state.ducking = false;
    state.jumpHeld = false;

    clearObstacles();
    setOverlayVisible(false);
    overlayCopy.textContent = "Score 0000";
    updateScoreboard();
    updateMetrics();
    render();
    syncMusicPlayback({ restart: true });

    if (focusScene) {
      focusNode(scene);
    }
  }

  function step(timestamp) {
    const deltaMs = Math.min(MAX_FRAME_DELTA, Math.max(0, timestamp - state.lastFrame));
    state.lastFrame = timestamp;

    if (state.alive) {
      const deltaSeconds = deltaMs / 1000;

      state.scoreAccumulator += deltaMs;
      while (state.scoreAccumulator >= 1000) {
        state.score += 1;
        state.scoreAccumulator -= 1000;
        updateSpeed();
        updateScoreboard();
      }

      state.spawnCooldown -= deltaMs;
      if (state.spawnCooldown <= 0) {
        spawnObstacle();
      }

      const gravityMultiplier = state.duckHeld && state.dinoY > 0 ? DUCK_FALL_MULTIPLIER : 1;
      state.velocityY -= GRAVITY * gravityMultiplier * deltaSeconds;
      state.dinoY = Math.max(0, state.dinoY + state.velocityY * deltaSeconds);

      if (state.dinoY === 0 && state.velocityY < 0) {
        state.velocityY = 0;
        state.jumpHeld = false;
      }

      updateDuckState();

      state.trackOffset = (state.trackOffset - state.speed * deltaSeconds * 0.78) % 28;

      state.obstacles = state.obstacles.filter((obstacle) => {
        obstacle.x -= state.speed * obstacle.speedFactor * deltaSeconds;

        if (obstacle.x + obstacle.width < -48) {
          obstacle.node.remove();
          return false;
        }

        return true;
      });

      const playerRect = getPlayerRect();
      const collided = state.obstacles.some((obstacle) =>
        rectsOverlap(playerRect, getObstacleRect(obstacle))
      );

      if (collided) {
        handleGameOver();
      }
    }

    render();
    window.requestAnimationFrame(step);
  }

  function shouldIgnoreJumpEvent(event) {
    const target = event.target;

    if (!(target instanceof Element)) return false;

    return Boolean(target.closest("button, a, input, textarea, select, option"));
  }

  function isJumpKey(event) {
    return event.code === "Space" || event.code === "KeyW" || event.code === "ArrowUp";
  }

  function isScrollLockKey(event) {
    return event.code === "Space" || event.code.startsWith("Arrow");
  }

  function isDuckKey(event) {
    return event.code === "ArrowDown" || event.code === "KeyS" || event.key === "Shift";
  }

  function focusNode(node) {
    if (!node || typeof node.focus !== "function") return;

    try {
      node.focus({ preventScroll: true });
    } catch {
      node.focus();
    }
  }

  dino.src = assetSources.dino;
  dino.dataset.poseSrc = assetSources.dino;
  dino.decoding = "async";
  dino.draggable = false;
  updateAudioButton();

  scene.addEventListener("pointerdown", (event) => {
    if (shouldIgnoreJumpEvent(event)) return;

    registerInteraction();
    setGameActive(true);
    event.preventDefault();
    try {
      scene.setPointerCapture(event.pointerId);
    } catch {
    }
    focusNode(scene);
    jump();
    syncMusicPlayback();
  });

  scene.addEventListener("pointerup", (event) => {
    if (shouldIgnoreJumpEvent(event)) return;

    releaseJump();
    try {
      scene.releasePointerCapture(event.pointerId);
    } catch {
    }
  });

  scene.addEventListener("pointercancel", () => {
    releaseJump();
  });

  scene.addEventListener("lostpointercapture", () => {
    releaseJump();
  });

  root.addEventListener("focusin", () => {
    setGameActive(true);
  });

  root.addEventListener("focusout", (event) => {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && root.contains(nextTarget)) return;

    setGameActive(false);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!(event.target instanceof Node) || root.contains(event.target)) return;

    setGameActive(false);
  });

  document.addEventListener("keydown", (event) => {
    if (shouldIgnoreJumpEvent(event)) return;
    if (!state.gameActive) return;

    if (isScrollLockKey(event)) {
      event.preventDefault();
    }

    if (isJumpKey(event)) {
      if (event.repeat) return;

      registerInteraction();
      jump();
      syncMusicPlayback();
      return;
    }

    if (!isDuckKey(event)) return;
    if (event.repeat && state.duckHeld) return;

    registerInteraction();
    event.preventDefault();
    setDuckHeld(true);
    syncMusicPlayback();
  });

  document.addEventListener("keyup", (event) => {
    if (isJumpKey(event)) {
      releaseJump();
      return;
    }

    if (!isDuckKey(event)) return;

    setDuckHeld(false);
  });

  retryButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    registerInteraction();
    resetGame();
  });

  audioToggleButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    registerInteraction();
    state.musicEnabled = !state.musicEnabled;

    if (!state.musicEnabled) {
      pauseMusic(false);
      updateAudioButton();
      return;
    }

    syncMusicPlayback();
  });

  window.addEventListener("resize", () => {
    updateMetrics();
    render();
  });

  window.addEventListener("blur", () => {
    setGameActive(false);
    state.lastFrame = performance.now();
  });

  document.addEventListener("visibilitychange", () => {
    state.lastFrame = performance.now();

    if (document.visibilityState !== "visible") {
      setGameActive(false);
      pauseMusic(false);
      return;
    }

    syncMusicPlayback();
  });

  updateScoreboard();
  updateMetrics();
  resetGame({ focusScene: false });
  window.requestAnimationFrame(step);
})();
