import { BrowserMultiFormatReader } from "@zxing/browser";

const STORAGE_KEY = "smartpantry.inventory.v1";
const DELETED_KEY = "smartpantry.deletedItemIds.v1";
const SHOPPING_KEY = "smartpantry.shoppingList.v1";
const MEAL_PLAN_KEY = "smartpantry.mealPlan.v1";
const DAILY_LOG_KEY = "smartpantry.dailyLog.v1";

export const seedInventory = [
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

export function offsetDate(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function uid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLocalInventory() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : seedInventory;
  } catch {
    return seedInventory;
  }
}

function writeLocalInventory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function upsertLocalInventory(item, editingId) {
  const items = readLocalInventory();
  const next = editingId ? items.map((existing) => (existing.id === editingId ? item : existing)) : [item, ...items];
  writeLocalInventory(next);
}

function removeLocalInventoryItem(id) {
  rememberDeletedId(id);
  writeLocalInventory(readLocalInventory().filter((item) => item.id !== id));
}

function readDeletedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function rememberDeletedId(id) {
  const deletedIds = readDeletedIds();
  deletedIds.add(id);
  localStorage.setItem(DELETED_KEY, JSON.stringify([...deletedIds]));
}

function readStoredLocalInventory() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function itemKey(item) {
  return [item.barcode || "", item.name, item.unit, item.expirationDate, Number(item.quantity || 0)].join("|").toLowerCase();
}

async function migrateLocalItemsToApi(apiItems) {
  const localItems = readStoredLocalInventory();
  if (!localItems?.length) return { items: apiItems, migratedCount: 0 };

  const deletedIds = readDeletedIds();
  const apiKeys = new Set(apiItems.map(itemKey));
  const missingLocalItems = localItems.filter((item) => !deletedIds.has(item.id) && !apiKeys.has(itemKey(item)));
  if (!missingLocalItems.length) {
    writeLocalInventory(apiItems);
    return { items: apiItems, migratedCount: 0 };
  }

  const migrated = [];
  for (const item of missingLocalItems) {
    try {
      const saved = await apiRequest("/api/inventory", {
        method: "POST",
        body: JSON.stringify({ ...item, id: item.id || uid() }),
      });
      migrated.push(saved);
    } catch {
      // Deleted/tombstoned local items should not force the whole app into local-only mode.
    }
  }

  const merged = [...migrated, ...apiItems];
  writeLocalInventory(merged);
  return { items: merged, migratedCount: migrated.length };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function loadInventory() {
  try {
    const apiItems = await apiRequest("/api/inventory");
    const migrated = await migrateLocalItemsToApi(apiItems);
    return { items: migrated.items, mode: migrated.migratedCount ? `SYNCED +${migrated.migratedCount}` : "SYNCED" };
  } catch {
    return { items: readLocalInventory(), mode: "LOCAL ONLY" };
  }
}

export async function saveInventoryItem(item, editingId) {
  try {
    if (editingId) {
      await apiRequest(`/api/inventory/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        body: JSON.stringify(item),
      });
    } else {
      await apiRequest("/api/inventory", {
        method: "POST",
        body: JSON.stringify(item),
      });
    }
    upsertLocalInventory(item, editingId);
    return "SYNCED";
  } catch {
    upsertLocalInventory(item, editingId);
    return "LOCAL ONLY";
  }
}

export async function deleteInventoryItem(id) {
  try {
    await apiRequest(`/api/inventory/${encodeURIComponent(id)}`, { method: "DELETE" });
    removeLocalInventoryItem(id);
    return "SYNCED";
  } catch {
    removeLocalInventoryItem(id);
    return "LOCAL ONLY";
  }
}

export async function lookupBarcode(barcode) {
  return apiRequest(`/api/barcode/${encodeURIComponent(barcode)}`);
}

function readLocalShoppingList() {
  try {
    return JSON.parse(localStorage.getItem(SHOPPING_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocalShoppingList(items) {
  localStorage.setItem(SHOPPING_KEY, JSON.stringify(items));
}

export async function loadSavedShoppingList() {
  try {
    const items = await apiRequest("/api/shopping-list");
    writeLocalShoppingList(items);
    return { items, mode: "SYNCED" };
  } catch {
    return { items: readLocalShoppingList(), mode: "LOCAL ONLY" };
  }
}

export async function saveShoppingList(items) {
  writeLocalShoppingList(items);
  try {
    await apiRequest("/api/shopping-list", {
      method: "PUT",
      body: JSON.stringify(items),
    });
    return "SYNCED";
  } catch {
    return "LOCAL ONLY";
  }
}

export async function deleteShoppingListItem(id) {
  const next = readLocalShoppingList().filter((item) => item.id !== id);
  writeLocalShoppingList(next);
  try {
    await apiRequest(`/api/shopping-list/${encodeURIComponent(id)}`, { method: "DELETE" });
    return "SYNCED";
  } catch {
    return "LOCAL ONLY";
  }
}

function readLocalMealPlan() {
  try {
    return JSON.parse(localStorage.getItem(MEAL_PLAN_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocalMealPlan(plan) {
  localStorage.setItem(MEAL_PLAN_KEY, JSON.stringify(plan));
}

export async function loadSavedMealPlan() {
  try {
    const plan = await apiRequest("/api/meal-plan");
    writeLocalMealPlan(plan);
    return { plan, mode: "SYNCED" };
  } catch {
    return { plan: readLocalMealPlan(), mode: "LOCAL ONLY" };
  }
}

export async function saveMealPlan(plan) {
  writeLocalMealPlan(plan);
  try {
    await apiRequest("/api/meal-plan", {
      method: "PUT",
      body: JSON.stringify(plan),
    });
    return "SYNCED";
  } catch {
    return "LOCAL ONLY";
  }
}

function readLocalDailyLog() {
  try {
    return JSON.parse(localStorage.getItem(DAILY_LOG_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeLocalDailyLog(log) {
  localStorage.setItem(DAILY_LOG_KEY, JSON.stringify(log));
}

export async function loadDailyLog() {
  try {
    const log = await apiRequest("/api/daily-log");
    writeLocalDailyLog(log);
    return { log, mode: "SYNCED" };
  } catch {
    return { log: readLocalDailyLog(), mode: "LOCAL ONLY" };
  }
}

export async function saveDailyLog(log) {
  writeLocalDailyLog(log);
  try {
    await apiRequest("/api/daily-log", {
      method: "PUT",
      body: JSON.stringify(log),
    });
    return "SYNCED";
  } catch {
    return "LOCAL ONLY";
  }
}

export async function decodeBarcodeFromImage(file) {
  if ("BarcodeDetector" in window) {
    const detector = new BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"],
    });
    const bitmap = await createImageBitmap(file);
    const barcodes = await detector.detect(bitmap);
    bitmap.close?.();
    const first = barcodes[0]?.rawValue;
    if (first) return first;
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const result = await new BrowserMultiFormatReader().decodeFromImageUrl(imageUrl);
    return result.getText();
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
