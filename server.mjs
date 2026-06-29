import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const port = Number(process.env.PORT || 8787);
const root = resolve(".");
const dataDir = join(root, "data");
const dataFile = join(dataDir, "inventory.json");
const deletedFile = join(dataDir, "deleted-item-ids.json");
const shoppingFile = join(dataDir, "shopping-list.json");
const mealPlanFile = join(dataDir, "meal-plan.json");
const dailyLogFile = join(dataDir, "daily-log.json");
const distDir = join(root, "dist");

const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

function offsetDate(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const seedInventory = [
  { id: "phone-tomato-paste", name: "Tomato Paste", quantity: 1, unit: "pcs", expirationDate: "2027-04-28" },
  { id: "phone-italian-style-bread-crumbs", name: "Italian Style Bread Crumbs", quantity: 1, unit: "pcs", expirationDate: "2027-02-24" },
  { id: "phone-stellar-snacks-pretzels", name: "Stellar Snacks Pretzels", quantity: 1, unit: "pcs", expirationDate: "2026-11-08" },
  { id: "phone-albacore-tuna-can", name: "Albacore Tuna Can", quantity: 3, unit: "pcs", expirationDate: "2027-01-15" },
  { id: "phone-gold-standard-whey", name: "Gold Standard Whey", quantity: 1, unit: "pcs", expirationDate: "2026-06-05" },
  { id: "1", name: "Spinach", quantity: 1, unit: "bag", expirationDate: offsetDate(1) },
  { id: "2", name: "Greek Yogurt", quantity: 2, unit: "cups", expirationDate: offsetDate(0) },
  { id: "3", name: "Brown Rice", quantity: 5, unit: "lb", expirationDate: offsetDate(120) },
  { id: "4", name: "Chicken Breast", quantity: 1.5, unit: "lb", expirationDate: offsetDate(2) },
  { id: "5", name: "Tomatoes", quantity: 4, unit: "pcs", expirationDate: offsetDate(5) },
  { id: "6", name: "Oat Milk", quantity: 1, unit: "carton", expirationDate: offsetDate(-1) },
];

async function ensureDataFile() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dataFile)) {
    await writeFile(dataFile, JSON.stringify(seedInventory, null, 2));
  }
  if (!existsSync(deletedFile)) {
    await writeFile(deletedFile, JSON.stringify([], null, 2));
  }
  if (!existsSync(shoppingFile)) {
    await writeFile(shoppingFile, JSON.stringify([], null, 2));
  }
  if (!existsSync(mealPlanFile)) {
    await writeFile(mealPlanFile, JSON.stringify([], null, 2));
  }
  if (!existsSync(dailyLogFile)) {
    await writeFile(dailyLogFile, JSON.stringify({}, null, 2));
  }
}

async function readInventory() {
  await ensureDataFile();
  return JSON.parse(await readFile(dataFile, "utf8"));
}

async function writeInventory(items) {
  await ensureDataFile();
  await writeFile(dataFile, JSON.stringify(items, null, 2));
}

async function readShoppingList() {
  await ensureDataFile();
  return JSON.parse(await readFile(shoppingFile, "utf8"));
}

async function writeShoppingList(items) {
  await ensureDataFile();
  await writeFile(shoppingFile, JSON.stringify(items, null, 2));
}

async function readMealPlan() {
  await ensureDataFile();
  return JSON.parse(await readFile(mealPlanFile, "utf8"));
}

async function writeMealPlan(plan) {
  await ensureDataFile();
  await writeFile(mealPlanFile, JSON.stringify(plan, null, 2));
}

async function readDailyLog() {
  await ensureDataFile();
  return JSON.parse(await readFile(dailyLogFile, "utf8"));
}

async function writeDailyLog(log) {
  await ensureDataFile();
  await writeFile(dailyLogFile, JSON.stringify(log, null, 2));
}

async function readDeletedIds() {
  await ensureDataFile();
  return new Set(JSON.parse(await readFile(deletedFile, "utf8")));
}

async function rememberDeletedId(id) {
  const deletedIds = await readDeletedIds();
  deletedIds.add(id);
  await writeFile(deletedFile, JSON.stringify([...deletedIds], null, 2));
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch (error) {
        rejectBody(error);
      }
    });
  });
}

function send(res, status, body, contentType = "application/json", extraHeaders = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": contentType,
    ...extraHeaders,
  });
  if (typeof body === "string" || body instanceof Uint8Array) {
    res.end(body);
    return;
  }
  res.end(JSON.stringify(body));
}

async function lookupBarcode(barcode) {
  const cleanBarcode = String(barcode).replace(/\D/g, "");
  if (!cleanBarcode) return null;

  const url = `https://world.openfoodfacts.org/api/v2/product/${cleanBarcode}.json?fields=product_name,brands,quantity,serving_size,categories_tags`;
  const response = await fetch(url, {
    headers: { "User-Agent": "SmartPantry/0.1 local development" },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (payload.status !== 1 || !payload.product) return null;

  const product = payload.product;
  return {
    barcode: cleanBarcode,
    name: product.product_name || product.brands || `Barcode ${cleanBarcode}`,
    quantityLabel: product.quantity || product.serving_size || "",
    source: "Open Food Facts",
  };
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (url.pathname === "/api/health") {
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/inventory" && req.method === "GET") {
    return send(res, 200, await readInventory());
  }

  if (url.pathname === "/api/shopping-list" && req.method === "GET") {
    return send(res, 200, await readShoppingList());
  }

  if (url.pathname === "/api/shopping-list" && req.method === "PUT") {
    const items = await readJsonBody(req);
    await writeShoppingList(Array.isArray(items) ? items : []);
    return send(res, 200, await readShoppingList());
  }

  if (url.pathname === "/api/shopping-list" && req.method === "POST") {
    const item = await readJsonBody(req);
    const items = await readShoppingList();
    const nextItem = { ...item, id: item.id || crypto.randomUUID() };
    const exists = items.some((existing) => existing.id === nextItem.id);
    const next = exists ? items.map((existing) => (existing.id === nextItem.id ? nextItem : existing)) : [nextItem, ...items];
    await writeShoppingList(next);
    return send(res, exists ? 200 : 201, nextItem);
  }

  if (url.pathname === "/api/meal-plan" && req.method === "GET") {
    return send(res, 200, await readMealPlan());
  }

  if (url.pathname === "/api/meal-plan" && req.method === "PUT") {
    const plan = await readJsonBody(req);
    await writeMealPlan(Array.isArray(plan) ? plan : []);
    return send(res, 200, await readMealPlan());
  }

  if (url.pathname === "/api/daily-log" && req.method === "GET") {
    return send(res, 200, await readDailyLog());
  }

  if (url.pathname === "/api/daily-log" && req.method === "PUT") {
    const log = await readJsonBody(req);
    await writeDailyLog(log && typeof log === "object" && !Array.isArray(log) ? log : {});
    return send(res, 200, await readDailyLog());
  }

  const shoppingMatch = url.pathname.match(/^\/api\/shopping-list\/([^/]+)$/);
  if (shoppingMatch && req.method === "DELETE") {
    const id = decodeURIComponent(shoppingMatch[1]);
    const items = await readShoppingList();
    const next = items.filter((item) => item.id !== id);
    await writeShoppingList(next);
    return send(res, 200, { deleted: items.length - next.length, id });
  }

  if (url.pathname === "/api/inventory" && req.method === "POST") {
    const item = await readJsonBody(req);
    const items = await readInventory();
    const nextItem = { ...item, id: item.id || crypto.randomUUID() };
    const deletedIds = await readDeletedIds();
    if (deletedIds.has(nextItem.id)) {
      return send(res, 409, { error: "Item was deleted", id: nextItem.id });
    }
    const itemKey = `${nextItem.barcode || ""}|${nextItem.name}|${nextItem.unit}|${nextItem.expirationDate}|${Number(nextItem.quantity || 0)}`.toLowerCase();
    const alreadyExists = items.some((existing) => {
      const existingKey = `${existing.barcode || ""}|${existing.name}|${existing.unit}|${existing.expirationDate}|${Number(existing.quantity || 0)}`.toLowerCase();
      return existingKey === itemKey;
    });
    const next = alreadyExists ? items : [nextItem, ...items];
    await writeInventory(next);
    return send(res, alreadyExists ? 200 : 201, nextItem);
  }

  const inventoryMatch = url.pathname.match(/^\/api\/inventory\/([^/]+)$/);
  if (inventoryMatch && req.method === "PUT") {
    const item = await readJsonBody(req);
    const id = decodeURIComponent(inventoryMatch[1]);
    const items = await readInventory();
    const next = items.map((existing) => (existing.id === id ? { ...item, id } : existing));
    await writeInventory(next);
    return send(res, 200, next.find((item) => item.id === id));
  }

  if (inventoryMatch && req.method === "DELETE") {
    const id = decodeURIComponent(inventoryMatch[1]);
    const items = await readInventory();
    const next = items.filter((item) => item.id !== id);
    await writeInventory(next);
    await rememberDeletedId(id);
    return send(res, 200, { deleted: items.length - next.length, id });
  }

  const barcodeMatch = url.pathname.match(/^\/api\/barcode\/([^/]+)$/);
  if (barcodeMatch && req.method === "GET") {
    const product = await lookupBarcode(decodeURIComponent(barcodeMatch[1]));
    if (!product) return send(res, 404, { error: "Barcode not found" });
    return send(res, 200, product);
  }

  return send(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(join(distDir, requestedPath));
  const safePath = filePath.startsWith(distDir) && existsSync(filePath) ? filePath : join(distDir, "index.html");
  const content = await readFile(safePath);
  const noCache = safePath.endsWith("index.html") || safePath.endsWith("sw.js");
  send(res, 200, content, mimeTypes[extname(safePath)] || "application/octet-stream", noCache ? { "Cache-Control": "no-store" } : {});
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    send(res, 500, { error: error.message || "Server error" });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`SmartPantry API + app listening on http://0.0.0.0:${port}`);
});
