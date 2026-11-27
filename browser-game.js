"use strict";

(() => {
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const overlay = document.querySelector("#overlay");
  const title = document.querySelector("#overlayTitle");
  const message = document.querySelector("#overlayText");
  const choices = document.querySelector("#overlayChoices");
  const primaryButton = document.querySelector("#primaryButton");
  const instructions = document.querySelector("#instructions");
  const hud = document.querySelector("#hud");
  const healthFill = document.querySelector("#healthFill");
  const xpFill = document.querySelector("#xpFill");
  const timer = document.querySelector("#timer");
  const levelLabel = document.querySelector("#level");
  const killsLabel = document.querySelector("#kills");
  const ammoLabel = document.querySelector("#ammo");
  const mobileControls = document.querySelector("#mobileControls");
  const mobileFire = document.querySelector("#mobileFire");
  const joystick = document.querySelector("#joystick");

  const WORLD = { width: 2704, height: 2384 };
  const DURATION = 20 * 60;
  const assets = new Map();
  const keys = new Set();
  const pointer = { x: 0, y: 0, down: false, inside: false };
  const stick = { x: 0, y: 0, pointerId: null };
  let state = "menu";
  let width = 0;
  let height = 0;
  let lastTime = 0;
  let hudTime = 0;
  let nextEnemyId = 1;
  let game;

  const asset = (path) => {
    if (!assets.has(path)) {
      const image = new Image();
      image.src = `assets/Images/${path}`;
      assets.set(path, image);
    }
    return assets.get(path);
  };

  const loadFrames = (folder, prefix, count) =>
    Array.from({ length: count }, (_, index) => asset(`${folder}/${prefix}${index}.png`));

  const playerIdle = loadFrames("characters/Shana", "idle", 6);
  const playerRun = loadFrames("characters/Shana", "run", 4);
  const batFrames = loadFrames("Enemies/eyebat", "eyebat", 4);
  const tentacleFrames = [0, 1, 2, 4].map((frame) => asset(`Enemies/tentaclemonster/tentaclemonster${frame}.png`));
  const mapImage = asset("map.png");
  const xpImage = asset("drops/experience.png");

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    width = rect.width;
    height = rect.height;
    if (game) updateHud();
  }

  function newGame() {
    game = {
      time: 0,
      player: { x: WORLD.width / 2, y: WORLD.height / 2, radius: 17, health: 5, maxHealth: 5, speed: 220, damage: 1, invulnerable: 0, facing: 1 },
      enemies: [],
      bullets: [],
      drops: [],
      particles: [],
      level: 1,
      xp: 0,
      xpNeeded: 8,
      kills: 0,
      ammo: 8,
      maxAmmo: 8,
      reload: 0,
      fireCooldown: 0,
      spawnCooldown: 0.8,
      hurtCooldown: 0,
      upgrades: { damage: 0, speed: 0, vitality: 0, multishot: 0 },
      pointerWorld: { x: WORLD.width / 2, y: WORLD.height / 2 },
    };
    keys.clear();
    pointer.down = false;
    hud.hidden = false;
    ammoLabel.hidden = false;
    mobileControls.hidden = false;
    overlay.hidden = true;
    state = "playing";
    updateHud();
  }

  function showOverlay(kind, heading, body, buttonText, action) {
    state = kind;
    title.innerHTML = heading;
    message.textContent = body;
    choices.replaceChildren();
    instructions.hidden = kind !== "menu";
    primaryButton.hidden = !buttonText;
    primaryButton.textContent = buttonText || "";
    primaryButton.onclick = action || null;
    overlay.hidden = false;
    pointer.down = false;
  }

  function pauseGame() {
    if (state !== "playing") return;
    showOverlay("paused", "PAUSED", "Take a breath. The monsters can wait.", "BACK TO THE NIGHT", () => {
      state = "playing";
      overlay.hidden = true;
      lastTime = performance.now();
    });
  }

  function endGame(won) {
    showOverlay(
      won ? "won" : "over",
      won ? "DAWN<br><span>HAS COME</span>" : "THE NIGHT<br><span>WON</span>",
      `${won ? "You made it through the night." : "You were overwhelmed by the creatures."} You survived ${formatElapsed(game.time)} and defeated ${game.kills} monsters.`,
      "PLAY AGAIN",
      newGame,
    );
    hud.hidden = true;
    ammoLabel.hidden = true;
    mobileControls.hidden = true;
  }

  const formatTime = (seconds) => {
    const remaining = Math.max(0, Math.ceil(DURATION - seconds));
    return `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  };
  const formatElapsed = (seconds) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  function updateHud() {
    if (!game) return;
    healthFill.style.width = `${Math.max(0, game.player.health / game.player.maxHealth) * 100}%`;
    xpFill.style.width = `${Math.min(1, game.xp / game.xpNeeded) * 100}%`;
    timer.textContent = formatTime(game.time);
    levelLabel.textContent = String(game.level);
    killsLabel.textContent = String(game.kills);
    ammoLabel.textContent = game.reload > 0
      ? `RELOADING ${Math.ceil(game.reload * 10) / 10}s`
      : `✦ ${game.ammo} / ${game.maxAmmo}`;
  }

  function screenToWorld(screenX, screenY) {
    const camera = getCamera();
    return { x: camera.x + screenX - width / 2, y: camera.y + screenY - height / 2 };
  }

  function getCamera() {
    const player = game.player;
    return {
      x: Math.max(width / 2, Math.min(WORLD.width - width / 2, player.x)),
      y: Math.max(height / 2, Math.min(WORLD.height - height / 2, player.y)),
    };
  }

  function spawnEnemy() {
    if (game.enemies.length >= 70) return;
    const p = game.player;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.max(width, height) * 0.62 + 50;
    const x = Math.max(24, Math.min(WORLD.width - 24, p.x + Math.cos(angle) * distance));
    const y = Math.max(24, Math.min(WORLD.height - 24, p.y + Math.sin(angle) * distance));
    const elapsed = game.time;
    const kind = elapsed > 120 && Math.random() < 0.32 ? "tentacle" : "bat";
    game.enemies.push({
      id: nextEnemyId++,
      x, y,
      kind,
      radius: kind === "tentacle" ? 22 : 17,
      speed: (kind === "tentacle" ? 42 : 62) + Math.min(elapsed / 18, 32) + Math.random() * 12,
      health: kind === "tentacle" ? 3 + Math.floor(elapsed / 240) : 1 + Math.floor(elapsed / 360),
      hitFlash: 0,
      animation: Math.random() * 3,
    });
  }

  function beginReload() {
    if (game.ammo === game.maxAmmo || game.reload > 0) return;
    game.reload = 1.15;
  }

  function findTarget() {
    const p = game.player;
    let target = null;
    let bestDistance = Infinity;
    for (const enemy of game.enemies) {
      const d = Math.hypot(enemy.x - p.x, enemy.y - p.y);
      if (d < bestDistance) { target = enemy; bestDistance = d; }
    }
    return target;
  }

  function fire() {
    if (game.fireCooldown > 0 || game.reload > 0) return;
    if (game.ammo < 1) { beginReload(); return; }
    const p = game.player;
    let target;
    if (keys.has("Space") || !pointer.inside) target = findTarget();
    if (target) {
      game.pointerWorld = { x: target.x, y: target.y };
    } else {
      game.pointerWorld = screenToWorld(pointer.x, pointer.y);
    }
    const angle = Math.atan2(game.pointerWorld.y - p.y, game.pointerWorld.x - p.x);
    const spread = game.upgrades.multishot ? [-0.12, 0, 0.12] : [0];
    for (const offset of spread) {
      const a = angle + offset;
      game.bullets.push({
        x: p.x + Math.cos(a) * 24,
        y: p.y + Math.sin(a) * 24,
        vx: Math.cos(a) * 570,
        vy: Math.sin(a) * 570,
        damage: p.damage,
        life: 0.9,
      });
    }
    game.ammo--;
    game.fireCooldown = game.upgrades.multishot ? 0.3 : 0.42;
    p.facing = Math.cos(angle) < 0 ? -1 : 1;
    if (game.ammo === 0) beginReload();
  }

  const UPGRADE_LIST = [
    { key: "damage", name: "HARD-HITTING", detail: "+1 damage per shot", apply: () => { game.player.damage++; } },
    { key: "speed", name: "QUICK FEET", detail: "Move 15% faster", apply: () => { game.player.speed *= 1.15; } },
    { key: "vitality", name: "VITALITY", detail: "+1 max health and heal", apply: () => { game.player.maxHealth++; game.player.health = Math.min(game.player.maxHealth, game.player.health + 1); } },
    { key: "multishot", name: "MULTISHOT", detail: "Fire 3 shots in a spread", apply: () => { game.upgrades.multishot++; } },
  ];

  function levelUp() {
    game.level++;
    game.xp -= game.xpNeeded;
    game.xpNeeded = Math.ceil(game.xpNeeded * 1.3 + 2);
    const shuffled = [...UPGRADE_LIST].sort(() => Math.random() - 0.5).slice(0, 3);
    showOverlay("levelup", "LEVEL UP", "Choose an upgrade for the next stretch of the night.", null, null);
    choices.replaceChildren(...shuffled.map((upgrade) => {
      const button = document.createElement("button");
      button.className = "upgrade-card";
      button.innerHTML = `<strong>${upgrade.name}</strong><span>${upgrade.detail}</span>`;
      button.addEventListener("click", () => {
        upgrade.apply();
        choices.replaceChildren();
        state = "playing";
        overlay.hidden = true;
        lastTime = performance.now();
        updateHud();
      });
      return button;
    }));
    instructions.hidden = true;
  }

  function damagePlayer() {
    const p = game.player;
    if (p.invulnerable > 0) return;
    p.health--;
    p.invulnerable = 0.9;
    if (p.health <= 0) endGame(false);
  }

  function update(dt) {
    if (state !== "playing") return;
    const p = game.player;
    game.time += dt;
    game.fireCooldown = Math.max(0, game.fireCooldown - dt);
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    game.hurtCooldown = Math.max(0, game.hurtCooldown - dt);

    let dx = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")) + stick.x;
    let dy = Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp")) + stick.y;
    const movementLength = Math.hypot(dx, dy);
    if (movementLength > 1) { dx /= movementLength; dy /= movementLength; }
    p.x = Math.max(p.radius, Math.min(WORLD.width - p.radius, p.x + dx * p.speed * dt));
    p.y = Math.max(p.radius, Math.min(WORLD.height - p.radius, p.y + dy * p.speed * dt));

    game.spawnCooldown -= dt;
    if (game.spawnCooldown <= 0) {
      spawnEnemy();
      game.spawnCooldown = Math.max(0.35, 1.35 - game.time / 105) * (0.8 + Math.random() * 0.4);
    }

    if (pointer.down || keys.has("Space") || keys.has("Fire")) fire();

    if (game.reload > 0) {
      game.reload -= dt;
      if (game.reload <= 0) { game.reload = 0; game.ammo = game.maxAmmo; }
    }

    for (const bullet of game.bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      for (const enemy of game.enemies) {
        if (enemy.health > 0 && Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) < enemy.radius + 5) {
          enemy.health -= bullet.damage;
          enemy.hitFlash = 0.1;
          bullet.life = 0;
          if (enemy.health <= 0) {
            game.kills++;
            game.drops.push({ x: enemy.x, y: enemy.y, value: 1, phase: Math.random() * 4 });
            for (let i = 0; i < 5; i++) {
              game.particles.push({ x: enemy.x, y: enemy.y, vx: (Math.random() - .5) * 110, vy: (Math.random() - .5) * 110, life: .35 });
            }
          }
          break;
        }
      }
    }
    game.bullets = game.bullets.filter((bullet) => bullet.life > 0);
    game.enemies = game.enemies.filter((enemy) => enemy.health > 0);

    for (const enemy of game.enemies) {
      enemy.animation += dt;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      const angle = Math.atan2(p.y - enemy.y, p.x - enemy.x);
      enemy.x += Math.cos(angle) * enemy.speed * dt;
      enemy.y += Math.sin(angle) * enemy.speed * dt;
      if (Math.hypot(enemy.x - p.x, enemy.y - p.y) < enemy.radius + p.radius && game.hurtCooldown <= 0) {
        damagePlayer();
        if (state !== "playing") return;
        game.hurtCooldown = 0.38;
      }
    }

    for (const drop of game.drops) {
      const distance = Math.hypot(p.x - drop.x, p.y - drop.y);
      if (distance < 135) {
        drop.x += (p.x - drop.x) * Math.min(1, dt * 5);
        drop.y += (p.y - drop.y) * Math.min(1, dt * 5);
      }
      if (distance < p.radius + 12) {
        drop.value = 0;
        game.xp++;
      }
    }
    game.drops = game.drops.filter((drop) => drop.value);

    for (const particle of game.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
    }
    game.particles = game.particles.filter((particle) => particle.life > 0);

    if (game.xp >= game.xpNeeded) levelUp();
    if (game.time >= DURATION) endGame(true);

    hudTime -= dt;
    if (hudTime <= 0) { hudTime = 0.1; updateHud(); }
  }

  function drawImage(image, x, y, w, h, flip = false, alpha = 1) {
    if (!image || !image.complete || image.naturalWidth === 0) return false;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (flip) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(image, 0, 0, w, h);
    } else {
      ctx.drawImage(image, x, y, w, h);
    }
    ctx.restore();
    return true;
  }

  function drawWorld() {
    ctx.fillStyle = "#141827";
    ctx.fillRect(0, 0, width, height);
    const camera = getCamera();
    const left = camera.x - width / 2;
    const top = camera.y - height / 2;

    if (mapImage.complete && mapImage.naturalWidth) {
      ctx.drawImage(mapImage, -left, -top, WORLD.width, WORLD.height);
    } else {
      ctx.fillStyle = "#1c2031";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#ffffff09";
      ctx.lineWidth = 1;
      const grid = 64;
      for (let x = -((left % grid) + grid) % grid; x < width; x += grid) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = -((top % grid) + grid) % grid; y < height; y += grid) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    }

    const sx = (x) => x - left;
    const sy = (y) => y - top;
    const now = game.time;

    for (const drop of game.drops) {
      const bob = Math.sin(now * 5 + drop.phase) * 3;
      if (!drawImage(xpImage, sx(drop.x) - 10, sy(drop.y) - 10 + bob, 20, 20)) {
        ctx.fillStyle = "#83e3bc";
        ctx.beginPath(); ctx.arc(sx(drop.x), sy(drop.y) + bob, 6, 0, Math.PI * 2); ctx.fill();
      }
    }

    for (const bullet of game.bullets) {
      ctx.fillStyle = "#ffe6a3";
      ctx.beginPath(); ctx.arc(sx(bullet.x), sy(bullet.y), 4, 0, Math.PI * 2); ctx.fill();
    }

    for (const enemy of game.enemies) {
      const frames = enemy.kind === "tentacle" ? tentacleFrames : batFrames;
      const image = frames[Math.floor(enemy.animation * 8) % frames.length];
      const enemyWidth = enemy.kind === "tentacle" ? 52 : 48;
      const enemyHeight = enemy.kind === "tentacle" ? 52 : 38;
      if (!drawImage(image, sx(enemy.x) - enemyWidth / 2, sy(enemy.y) - enemyHeight / 2, enemyWidth, enemyHeight, game.player.x > enemy.x, enemy.hitFlash ? 0.55 : 1)) {
        ctx.fillStyle = enemy.kind === "tentacle" ? "#8d596f" : "#b2688d";
        ctx.beginPath(); ctx.arc(sx(enemy.x), sy(enemy.y), enemy.radius, 0, Math.PI * 2); ctx.fill();
      }
      if (enemy.health > 1) {
        ctx.fillStyle = "#0b0c14aa";
        ctx.fillRect(sx(enemy.x) - 14, sy(enemy.y) - enemyHeight / 2 - 7, 28, 3);
        ctx.fillStyle = "#ed6174";
        ctx.fillRect(sx(enemy.x) - 14, sy(enemy.y) - enemyHeight / 2 - 7, 28 * Math.max(0, enemy.health / (3 + Math.floor(game.time / 240))), 3);
      }
    }

    for (const particle of game.particles) {
      ctx.globalAlpha = Math.max(0, particle.life / .35);
      ctx.fillStyle = "#ed6174";
      ctx.fillRect(sx(particle.x), sy(particle.y), 3, 3);
      ctx.globalAlpha = 1;
    }

    const p = game.player;
    const moving = keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD") ||
      keys.has("ArrowUp") || keys.has("ArrowLeft") || keys.has("ArrowDown") || keys.has("ArrowRight") || Math.hypot(stick.x, stick.y) > 0.1;
    const frames = moving ? playerRun : playerIdle;
    const frame = frames[Math.floor(now * (moving ? 12 : 5)) % frames.length];
    const alpha = p.invulnerable > 0 && Math.floor(now * 18) % 2 ? 0.48 : 1;
    const playerWidth = 52;
    const playerHeight = 64;
    if (!drawImage(frame, sx(p.x) - playerWidth / 2, sy(p.y) - playerHeight / 2, playerWidth, playerHeight, p.facing < 0, alpha)) {
      ctx.fillStyle = "#f5c66f";
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.radius, 0, Math.PI * 2); ctx.fill();
    }

    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .18, width / 2, height / 2, Math.max(width, height) * .72);
    vignette.addColorStop(0, "#080b1700");
    vignette.addColorStop(1, "#080b1780");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function drawMenuBackground(time) {
    ctx.fillStyle = "#141827";
    ctx.fillRect(0, 0, width, height);
    if (mapImage.complete && mapImage.naturalWidth) {
      const imageScale = Math.max(width / WORLD.width, height / WORLD.height);
      const imageWidth = WORLD.width * imageScale;
      const imageHeight = WORLD.height * imageScale;
      ctx.globalAlpha = 0.65;
      ctx.drawImage(mapImage, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < 16; i++) {
      const angle = time * .15 + (i / 16) * Math.PI * 2;
      const x = width / 2 + Math.cos(angle) * (width * .2 + Math.sin(time + i) * 50);
      const y = height / 2 + Math.sin(angle) * (height * .2);
      const frame = batFrames[i % batFrames.length];
      drawImage(frame, x - 24, y - 18, 48, 36, Math.cos(angle) < 0, 0.55);
    }
  }

  function render(now) {
    const dt = Math.min(0.04, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (game) update(dt);
    ctx.save();
    ctx.setTransform(window.devicePixelRatio && window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio || 1, 0, 0,
      window.devicePixelRatio && window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio || 1, 0, 0);
    if (game && ["playing", "paused", "levelup"].includes(state)) drawWorld();
    else drawMenuBackground(now / 1000);
    ctx.restore();
    requestAnimationFrame(render);
  }

  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.inside = pointer.x >= 0 && pointer.x <= rect.width && pointer.y >= 0 && pointer.y <= rect.height;
  }

  canvas.addEventListener("pointermove", updatePointer);
  canvas.addEventListener("pointerdown", (event) => {
    if (state !== "playing" || event.pointerType === "touch") return;
    updatePointer(event);
    pointer.down = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", () => { pointer.down = false; });
  canvas.addEventListener("pointercancel", () => { pointer.down = false; });
  window.addEventListener("pointerup", () => { pointer.down = false; });
  window.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === "Escape") {
      if (state === "playing") pauseGame();
      else if (state === "paused") primaryButton.click();
    }
    if (event.code === "KeyR" && game && state === "playing") beginReload();
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => { keys.clear(); pointer.down = false; });
  window.addEventListener("resize", resize);
  document.querySelector("#pauseButton").addEventListener("click", pauseGame);
  primaryButton.addEventListener("click", () => {
    if (state === "menu" || state === "over" || state === "won") newGame();
  });

  mobileFire.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    keys.add("Fire");
    mobileFire.setPointerCapture(event.pointerId);
  });
  const stopMobileFire = () => keys.delete("Fire");
  mobileFire.addEventListener("pointerup", stopMobileFire);
  mobileFire.addEventListener("pointercancel", stopMobileFire);
  mobileFire.addEventListener("lostpointercapture", stopMobileFire);

  joystick.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    stick.pointerId = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    updateStick(event);
  });
  joystick.addEventListener("pointermove", (event) => {
    if (event.pointerId === stick.pointerId) updateStick(event);
  });
  const stopStick = () => {
    stick.x = 0;
    stick.y = 0;
    stick.pointerId = null;
    joystick.querySelector("span").style.transform = "";
  };
  joystick.addEventListener("pointerup", stopStick);
  joystick.addEventListener("pointercancel", stopStick);
  joystick.addEventListener("lostpointercapture", stopStick);

  function updateStick(event) {
    const rect = joystick.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const radius = rect.width * .37;
    const distance = Math.hypot(x, y);
    const factor = distance > radius ? radius / distance : 1;
    stick.x = x * factor / radius;
    stick.y = y * factor / radius;
    joystick.querySelector("span").style.transform = `translate(${x * factor}px, ${y * factor}px)`;
  }

  resize();
  showOverlay("menu", "20 MINUTES<br><span>TILL DAWN</span>", "The night is full of monsters. Keep moving, keep shooting, and survive until sunrise.", "START SURVIVING", newGame);
  requestAnimationFrame((time) => { lastTime = time; render(time); });
})();
