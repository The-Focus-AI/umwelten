const canvas = document.querySelector("#mycelium");
const hero = document.querySelector(".hero");
const context = canvas?.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_TIPS = 160;
let width = 0;
let height = 0;
let frame = 0;
let nextTipId = 0;
let tips = [];
let pointer = { x: 0, y: 0, active: false };

function random(min, max) {
  return min + Math.random() * (max - min);
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function noise(x, y) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const offsetX = smooth(x - cellX);
  const offsetY = smooth(y - cellY);
  const top =
    hash(cellX, cellY) * (1 - offsetX) + hash(cellX + 1, cellY) * offsetX;
  const bottom =
    hash(cellX, cellY + 1) * (1 - offsetX) +
    hash(cellX + 1, cellY + 1) * offsetX;
  return top * (1 - offsetY) + bottom * offsetY;
}

function createTip(x, y, angle, generation = 0, thickness = random(1.5, 2.8)) {
  return {
    id: nextTipId++,
    x,
    y,
    angle,
    generation,
    thickness,
    speed: random(0.48, 0.78),
    age: 0,
    distance: 0,
    branchAt: random(10, 25),
  };
}

function inoculate(x, y, count = 14, radial = true) {
  const incoming = Math.min(count, MAX_TIPS);
  const excess = tips.length + incoming - MAX_TIPS;
  if (excess > 0) tips.splice(0, excess);
  for (let index = 0; index < incoming; index += 1) {
    const angle = radial
      ? (index / incoming) * Math.PI * 2 + random(-0.14, 0.14)
      : Math.PI + random(-0.62, 0.62);
    tips.push(createTip(x, y, angle));
  }
}

function branch(tip) {
  tip.distance = 0;
  tip.branchAt = random(12, 29);
  const matureThickness = Math.max(0.36, 3.6 * 0.62 ** tip.generation);
  tip.thickness = Math.min(matureThickness, tip.thickness * 1.035);
  if (tips.length >= MAX_TIPS) return;
  const direction = Math.random() < 0.5 ? -1 : 1;
  tips.push(
    createTip(
      tip.x,
      tip.y,
      tip.angle + direction * random(0.36, 0.68),
      tip.generation + 1,
      Math.max(0.28, tip.thickness * random(0.42, 0.65)),
    ),
  );
}

function grow() {
  for (let index = tips.length - 1; index >= 0; index -= 1) {
    const tip = tips[index];
    if (
      tip.x < width * 0.34 ||
      tip.x > width + 18 ||
      tip.y < -18 ||
      tip.y > height + 18 ||
      tip.age > 1400
    ) {
      tips.splice(index, 1);
      continue;
    }

    const previousX = tip.x;
    const previousY = tip.y;
    const field = noise(tip.x * 0.006, tip.y * 0.006 + tip.id * 0.17) - 0.5;
    tip.angle += field * 0.019 + random(-0.005, 0.005);

    if (pointer.active) {
      const dx = pointer.x - tip.x;
      const dy = pointer.y - tip.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 320 && distance > 20) {
        const target = Math.atan2(dy, dx);
        tip.angle +=
          Math.atan2(
            Math.sin(target - tip.angle),
            Math.cos(target - tip.angle),
          ) * 0.006;
      }
    }

    tip.x += Math.cos(tip.angle) * tip.speed;
    tip.y += Math.sin(tip.angle) * tip.speed;
    tip.age += 1;
    tip.distance += tip.speed;

    context.beginPath();
    context.moveTo(previousX, previousY);
    context.lineTo(tip.x, tip.y);
    context.strokeStyle = `rgba(218, 244, 205, ${Math.max(0.28, 0.65 - tip.generation * 0.03)})`;
    context.lineWidth = tip.thickness;
    context.stroke();

    if (tip.distance >= tip.branchAt) branch(tip);
  }

  if (tips.length < 14 && frame % 50 === 0) {
    inoculate(width + 4, height * random(0.12, 0.88), 8, false);
  }
}

function reset() {
  if (!canvas || !context) return;
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  width = bounds.width;
  height = bounds.height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = "#07100c";
  context.fillRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalCompositeOperation = "screen";
  tips = [];
  nextTipId = 0;
  inoculate(width * 0.77, height * 0.66, 16, true);
  inoculate(width + 4, height * 0.2, 8, false);
  inoculate(width + 4, height * 0.48, 9, false);
  for (let step = 0; step < 120; step += 1) {
    frame += 1;
    grow();
  }
  if (reducedMotion) {
    for (let step = 0; step < 260; step += 1) {
      frame += 1;
      grow();
    }
  }
}

function draw() {
  if (reducedMotion || !context) return;
  frame += 1;
  grow();
  requestAnimationFrame(draw);
}

function pointInHero(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
    inside:
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom,
  };
}

addEventListener("resize", reset, { passive: true });
addEventListener(
  "pointermove",
  (event) => {
    const point = pointInHero(event);
    pointer = { x: point.x, y: point.y, active: point.inside };
  },
  { passive: true },
);
addEventListener("pointerleave", () => {
  pointer.active = false;
});
hero?.addEventListener("click", (event) => {
  const point = pointInHero(event);
  if (point.inside) inoculate(point.x, point.y, 14, true);
});

reset();
draw();

function modelCard(model, index) {
  const card = document.createElement("article");
  card.className = "model-card";
  const head = document.createElement("div");
  head.className = "model-card-head";
  const number = document.createElement("span");
  number.className = "model-index";
  number.textContent = String(index + 1).padStart(2, "0");
  const price = document.createElement("span");
  price.className = "model-price";
  price.textContent = `$${Number(model.pricing?.completion ?? 0).toFixed(2)}/M out`;
  head.append(number, price);
  const title = document.createElement("h3");
  title.textContent = model.id;
  const meta = document.createElement("div");
  meta.className = "model-meta";
  for (const value of [
    ...(model.capabilities ?? []),
    ...(model.guarantees ?? []),
  ]) {
    const tag = document.createElement("span");
    tag.textContent = value;
    meta.append(tag);
  }
  card.append(head, title, meta);
  return card;
}

async function loadCatalogue() {
  const grid = document.querySelector("#model-grid");
  try {
    const response = await fetch("/v1/models");
    if (!response.ok) throw new Error("catalogue unavailable");
    const catalogue = await response.json();
    const models = catalogue.data ?? [];
    document.querySelector("#model-count").textContent = String(models.length);
    const lowest = Math.min(
      ...models
        .map((model) => Number(model.pricing?.completion))
        .filter(Number.isFinite),
    );
    document.querySelector("#lowest-price").textContent = Number.isFinite(
      lowest,
    )
      ? `$${lowest.toFixed(2)}`
      : "—";
    grid.replaceChildren(...models.slice(0, 4).map(modelCard));
  } catch {
    document.querySelector("#network-status-label").textContent =
      "Exchange waking";
    grid.textContent =
      "The live catalogue is waking. The network will appear here shortly.";
  }
}

loadCatalogue();

const snippet = `const response = await fetch("https://mycel.thefocus.ai/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${MYCEL_API_KEY}\`,
    "X-Mycel-End-User": user.id,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ model: "deepseek/deepseek-v4-pro", messages })
});`;

document
  .querySelector("#copy-code")
  ?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(snippet);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1600);
    } catch {
      button.textContent = "Select code";
    }
  });
