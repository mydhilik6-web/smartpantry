import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(".");
loadDotEnv(join(root, ".env"));
const port = Number(process.env.PORT || 8787);
const dataDir = join(root, "data");
const distDir = join(root, "dist");
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseTable = process.env.SUPABASE_TABLE || "smartpantry_store";
const useSupabase = Boolean(supabaseUrl && supabaseServiceRoleKey);
const importToken = process.env.SMARTPANTRY_IMPORT_TOKEN;

const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    const rawValue = trimmed.slice(equalIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

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

const storeDefaults = {
  inventory: seedInventory,
  deletedItemIds: [],
  shoppingList: [],
  mealPlan: [],
  dailyLog: {},
};

const localFiles = {
  inventory: join(dataDir, "inventory.json"),
  deletedItemIds: join(dataDir, "deleted-item-ids.json"),
  shoppingList: join(dataDir, "shopping-list.json"),
  mealPlan: join(dataDir, "meal-plan.json"),
  dailyLog: join(dataDir, "daily-log.json"),
};

async function ensureLocalDataFiles() {
  await mkdir(dataDir, { recursive: true });
  for (const [key, filePath] of Object.entries(localFiles)) {
    if (!existsSync(filePath)) {
      await writeFile(filePath, JSON.stringify(storeDefaults[key], null, 2));
    }
  }
}

function supabaseHeaders(extraHeaders = {}) {
  return {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
}

function supabaseRestUrl(pathAndQuery) {
  return `${supabaseUrl}/rest/v1/${pathAndQuery}`;
}

async function readCloudStore(key) {
  const response = await fetch(supabaseRestUrl(`${supabaseTable}?key=eq.${encodeURIComponent(key)}&select=value`), {
    headers: supabaseHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Supabase read failed for ${key}: ${response.status}`);
  }
  const rows = await response.json();
  if (rows.length) return rows[0].value;
  await writeCloudStore(key, storeDefaults[key]);
  return storeDefaults[key];
}

async function writeCloudStore(key, value) {
  const response = await fetch(supabaseRestUrl(`${supabaseTable}?on_conflict=key`), {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
  if (!response.ok) {
    throw new Error(`Supabase write failed for ${key}: ${response.status}`);
  }
}

async function readLocalStore(key) {
  await ensureLocalDataFiles();
  return JSON.parse(await readFile(localFiles[key], "utf8"));
}

async function writeLocalStore(key, value) {
  await ensureLocalDataFiles();
  await writeFile(localFiles[key], JSON.stringify(value, null, 2));
}

async function readStore(key) {
  return useSupabase ? readCloudStore(key) : readLocalStore(key);
}

async function writeStore(key, value) {
  return useSupabase ? writeCloudStore(key, value) : writeLocalStore(key, value);
}

async function readInventory() {
  return readStore("inventory");
}

async function writeInventory(items) {
  await writeStore("inventory", items);
}

async function readShoppingList() {
  return readStore("shoppingList");
}

async function writeShoppingList(items) {
  await writeStore("shoppingList", items);
}

async function readMealPlan() {
  return readStore("mealPlan");
}

async function writeMealPlan(plan) {
  await writeStore("mealPlan", plan);
}

async function readDailyLog() {
  return readStore("dailyLog");
}

async function writeDailyLog(log) {
  await writeStore("dailyLog", log);
}

async function readDeletedIds() {
  return new Set(await readStore("deletedItemIds"));
}

async function rememberDeletedId(id) {
  const deletedIds = await readDeletedIds();
  deletedIds.add(id);
  await writeStore("deletedItemIds", [...deletedIds]);
}

async function readSnapshot() {
  const [inventory, shoppingList, mealPlan, dailyLog, deletedItemIds] = await Promise.all([
    readInventory(),
    readShoppingList(),
    readMealPlan(),
    readDailyLog(),
    readStore("deletedItemIds"),
  ]);
  return { inventory, shoppingList, mealPlan, dailyLog, deletedItemIds };
}

async function writeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Snapshot body must be an object");
  }

  await Promise.all([
    Array.isArray(snapshot.inventory) ? writeInventory(snapshot.inventory) : Promise.resolve(),
    Array.isArray(snapshot.shoppingList) ? writeShoppingList(snapshot.shoppingList) : Promise.resolve(),
    Array.isArray(snapshot.mealPlan) ? writeMealPlan(snapshot.mealPlan) : Promise.resolve(),
    snapshot.dailyLog && typeof snapshot.dailyLog === "object" && !Array.isArray(snapshot.dailyLog) ? writeDailyLog(snapshot.dailyLog) : Promise.resolve(),
    Array.isArray(snapshot.deletedItemIds) ? writeStore("deletedItemIds", snapshot.deletedItemIds) : Promise.resolve(),
  ]);
}

function hasImportAccess(req) {
  if (!importToken) return false;
  return req.headers.authorization === `Bearer ${importToken}`;
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
    return send(res, 200, { ok: true, storage: useSupabase ? "supabase" : "local-json" });
  }

  if (url.pathname === "/api/snapshot" && req.method === "GET") {
    if (!hasImportAccess(req)) return send(res, 403, { error: "Snapshot import is disabled or unauthorized" });
    return send(res, 200, await readSnapshot());
  }

  if (url.pathname === "/api/snapshot" && req.method === "PUT") {
    if (!hasImportAccess(req)) return send(res, 403, { error: "Snapshot import is disabled or unauthorized" });
    const snapshot = await readJsonBody(req);
    await writeSnapshot(snapshot);
    return send(res, 200, await readSnapshot());
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
