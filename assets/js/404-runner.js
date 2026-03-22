(() => {
  const root = document.getElementById("notFoundRunner");

  if (!root) return;

  const scene = root.querySelector("[data-runner-scene]");
  const track = root.querySelector("[data-runner-track]");
  const dino = root.querySelector("[data-runner-dino]");
  const obstaclesLayer = root.querySelector("[data-runner-obstacles]");
  const overlay = root.querySelector("[data-runner-overlay]");
  const overlayCopy = root.querySelector("[data-runner-overlay-copy]");
  const retryButton = root.querySelector("[data-runner-retry]");
  const scoreNode = root.querySelector("[data-runner-score]");
  const bestNode = root.querySelector("[data-runner-best]");

  if (
    !scene ||
    !track ||
    !dino ||
    !obstaclesLayer ||
    !overlay ||
    !overlayCopy ||
    !retryButton ||
    !scoreNode ||
    !bestNode
  ) {
    return;
  }

  const assetSources = {
    dino: root.dataset.dinoSrc || "",
    ground: root.dataset.groundSrc || "",
    air: root.dataset.airSrc || "",
  };

  if (!assetSources.dino || !assetSources.ground || !assetSources.air) return;

  const LOLIPOP_RATIO = 1903 / 927;
  const PAPER_PLANE_RATIO = 883 / 1910;
  const AIR_UNLOCK_SCORE = 200;
  const BASE_SPEED = 262;
  const SCORE_SPEED_LIMIT = 240;
  const GRAVITY = 1950;
  const JUMP_VELOCITY = 735;
  const MAX_FRAME_DELTA = 48;
  const STORAGE_KEY = "milancholy_404_runner_best";

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
    metrics: {
      sceneWidth: 0,
      sceneHeight: 0,
      groundHeight: 0,
      playerX: 0,
      playerWidth: 0,
      playerHeight: 0,
    },
  };

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
  }

  function setOverlayVisible(visible) {
    overlay.classList.toggle("is-visible", visible);
    overlay.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function updateMetrics() {
    const dinoStyle = window.getComputedStyle(dino);
    const trackStyle = window.getComputedStyle(track);

    state.metrics.sceneWidth = scene.clientWidth;
    state.metrics.sceneHeight = scene.clientHeight;
    state.metrics.groundHeight = parseFloat(trackStyle.height) || 44;
    state.metrics.playerX = parseFloat(dinoStyle.left) || 52;
    state.metrics.playerWidth = parseFloat(dinoStyle.width) || 88;
    state.metrics.playerHeight = parseFloat(dinoStyle.height) || 92;
  }

  function updateSpeed() {
    const earlySpeedGain = Math.min(state.score, SCORE_SPEED_LIMIT) * 0.28;
    const lateSpeedGain = Math.max(0, state.score - AIR_UNLOCK_SCORE) * 0.08;
    state.speed = BASE_SPEED + earlySpeedGain + lateSpeedGain;
  }

  function getPlayerRect() {
    const { playerX, playerWidth, playerHeight } = state.metrics;

    return {
      left: playerX + playerWidth * 0.18,
      right: playerX + playerWidth * 0.79,
      bottom: state.dinoY + playerHeight * 0.07,
      top: state.dinoY + playerHeight * 0.88,
    };
  }

  function getObstacleRect(obstacle) {
    if (obstacle.type === "air") {
      return {
        left: obstacle.x + obstacle.width * 0.14,
        right: obstacle.x + obstacle.width * 0.82,
        bottom: obstacle.y + obstacle.height * 0.22,
        top: obstacle.y + obstacle.height * 0.78,
      };
    }

    return {
      left: obstacle.x + obstacle.width * 0.2,
      right: obstacle.x + obstacle.width * 0.8,
      bottom: obstacle.height * 0.04,
      top: obstacle.height * 0.94,
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

    sprite.src = obstacle.type === "air" ? assetSources.air : assetSources.ground;
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
    const { sceneWidth, sceneHeight, groundHeight, playerWidth, playerHeight } = state.metrics;
    const obstacle = {
      id: state.obstacleId + 1,
      type: useAirObstacle ? "air" : "ground",
      width: 0,
      height: 0,
      x: sceneWidth + randomBetween(28, 90),
      y: 0,
      speedFactor: useAirObstacle ? randomBetween(1.03, 1.14) : randomBetween(0.98, 1.04),
      node: null,
    };

    state.obstacleId += 1;

    if (useAirObstacle) {
      obstacle.width = playerWidth * randomBetween(0.92, 1.16);
      obstacle.height = obstacle.width * PAPER_PLANE_RATIO;

      const maxAirHeight = Math.max(
        28,
        sceneHeight - groundHeight - obstacle.height - playerHeight * 0.12
      );

      obstacle.y = clamp(
        choose([
          playerHeight * 0.38,
          playerHeight * 0.76,
          playerHeight * 1.08,
        ]),
        24,
        maxAirHeight
      );
    } else {
      obstacle.width = playerWidth * choose([0.4, 0.48, 0.58, 0.68]);
      obstacle.height = obstacle.width * LOLIPOP_RATIO;
    }

    const lastObstacle = state.obstacles[state.obstacles.length - 1];
    if (lastObstacle) {
      const gap = randomBetween(playerWidth * 1.55, playerWidth * 2.6);
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

    state.velocityY = JUMP_VELOCITY;
    state.dinoY = Math.max(state.dinoY, 1);
  }

  function render() {
    const grounded = state.dinoY <= 0.001;
    const stride = state.alive && grounded ? Math.sin(Math.abs(state.trackOffset) * 0.16) * 2.1 : 0;
    const tilt = !state.alive ? 16 : state.velocityY > 80 ? -4 : state.velocityY < -80 ? 4 : 0;
    const scaleX = state.alive && grounded ? 1 + Math.abs(Math.sin(state.trackOffset * 0.16)) * 0.018 : 1;
    const scaleY = state.alive && grounded ? 1 - Math.abs(Math.sin(state.trackOffset * 0.16)) * 0.02 : 1;

    scene.style.setProperty("--runner-track-offset", `${Math.round(state.trackOffset)}px`);
    dino.style.transform = `translate3d(0, ${-(state.dinoY + stride)}px, 0) rotate(${tilt}deg) scale(${scaleX}, ${scaleY})`;
    dino.classList.toggle("is-dead", !state.alive);

    state.obstacles.forEach((obstacle) => {
      obstacle.node.style.transform = `translate3d(${Math.round(obstacle.x)}px, ${-Math.round(obstacle.y)}px, 0)`;
    });
  }

  function handleGameOver() {
    state.alive = false;
    state.velocityY = 0;
    state.dinoY = 0;

    if (state.score > state.best) {
      state.best = state.score;
      saveBestScore();
    }

    updateScoreboard();
    overlayCopy.textContent = `Score ${formatScore(state.score)}`;
    setOverlayVisible(true);
    render();

    focusNode(retryButton);
  }

  function resetGame() {
    state.alive = true;
    state.score = 0;
    state.scoreAccumulator = 0;
    state.speed = BASE_SPEED;
    state.spawnCooldown = 900;
    state.trackOffset = 0;
    state.dinoY = 0;
    state.velocityY = 0;
    state.lastFrame = performance.now();

    clearObstacles();
    setOverlayVisible(false);
    overlayCopy.textContent = "Score 0000";
    updateScoreboard();
    updateMetrics();
    render();

    focusNode(scene);
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

      state.velocityY -= GRAVITY * deltaSeconds;
      state.dinoY = Math.max(0, state.dinoY + state.velocityY * deltaSeconds);

      if (state.dinoY === 0 && state.velocityY < 0) {
        state.velocityY = 0;
      }

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

  function focusNode(node) {
    if (!node || typeof node.focus !== "function") return;

    try {
      node.focus({ preventScroll: true });
    } catch {
      node.focus();
    }
  }

  dino.src = assetSources.dino;
  dino.decoding = "async";
  dino.draggable = false;

  scene.addEventListener("pointerdown", (event) => {
    if (shouldIgnoreJumpEvent(event)) return;

    event.preventDefault();
    focusNode(scene);
    jump();
  });

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;
    if (shouldIgnoreJumpEvent(event)) return;

    event.preventDefault();
    jump();
  });

  retryButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetGame();
  });

  window.addEventListener("resize", () => {
    updateMetrics();
    render();
  });

  document.addEventListener("visibilitychange", () => {
    state.lastFrame = performance.now();
  });

  updateScoreboard();
  updateMetrics();
  resetGame();
  window.requestAnimationFrame(step);
})();
