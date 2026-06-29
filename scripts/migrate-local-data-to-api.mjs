import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".");
loadDotEnv(join(root, ".env"));
const dataDir = join(root, "data");
const apiUrl = process.env.SMARTPANTRY_API_URL?.replace(/\/$/, "");
const importToken = process.env.SMARTPANTRY_IMPORT_TOKEN;

const files = {
  inventory: join(dataDir, "inventory.json"),
  deletedItemIds: join(dataDir, "deleted-item-ids.json"),
  shoppingList: join(dataDir, "shopping-list.json"),
  mealPlan: join(dataDir, "meal-plan.json"),
  dailyLog: join(dataDir, "daily-log.json"),
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

if (!apiUrl) {
  console.error("Missing SMARTPANTRY_API_URL. Example:");
  console.error("SMARTPANTRY_API_URL=https://your-render-app.onrender.com SMARTPANTRY_IMPORT_TOKEN=your-token pnpm migrate:api");
  process.exit(1);
}

if (!importToken) {
  console.error("Missing SMARTPANTRY_IMPORT_TOKEN. Set the same temporary token locally and in Render.");
  process.exit(1);
}

const snapshot = {};

for (const [key, filePath] of Object.entries(files)) {
  if (!existsSync(filePath)) {
    console.log(`Skipped ${key}: ${filePath} does not exist`);
    continue;
  }
  snapshot[key] = JSON.parse(await readFile(filePath, "utf8"));
}

const response = await fetch(`${apiUrl}/api/snapshot`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${importToken}`, "Content-Type": "application/json" },
  body: JSON.stringify(snapshot),
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`API migration failed: ${response.status} ${text}`);
}

const saved = await response.json();
console.log(`Uploaded ${saved.inventory?.length || 0} inventory items`);
console.log(`Uploaded ${saved.shoppingList?.length || 0} shopping list items`);
console.log(`Uploaded ${saved.mealPlan?.length || 0} meal plan days`);
console.log(`Uploaded ${Object.keys(saved.dailyLog || {}).length} daily log keys`);
console.log(`Uploaded ${saved.deletedItemIds?.length || 0} deleted item tombstones`);
