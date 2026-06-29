import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".");
loadDotEnv(join(root, ".env"));
const dataDir = join(root, "data");
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseTable = process.env.SUPABASE_TABLE || "smartpantry_store";

const stores = {
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

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

function supabaseHeaders(extraHeaders = {}) {
  return {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
}

async function upsertStore(key, value) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${supabaseTable}?on_conflict=key`, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase upload failed for ${key}: ${response.status} ${text}`);
  }
}

let uploaded = 0;

for (const [key, filePath] of Object.entries(stores)) {
  if (!existsSync(filePath)) {
    console.log(`Skipped ${key}: ${filePath} does not exist`);
    continue;
  }

  const value = JSON.parse(await readFile(filePath, "utf8"));
  await upsertStore(key, value);
  uploaded += 1;
  console.log(`Uploaded ${key}`);
}

console.log(`Done. Uploaded ${uploaded} store file${uploaded === 1 ? "" : "s"} to ${supabaseTable}.`);
