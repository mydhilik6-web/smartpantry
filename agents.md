# SmartPantry Agents

## Project State
- React/Tailwind PWA served by `server.mjs` on port `8787`.
- Production storage uses Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
- Local development falls back to JSON files in `data/`.
- Inventory store key: `inventory`.
- Shopping list store key: `shoppingList`.
- Weekly meal plan store key: `mealPlan`.
- Daily food/exercise log store key: `dailyLog`.
- Deleted inventory ids store key: `deletedItemIds`.
- LocalStorage is fallback/cache only, not the source of truth when the API is reachable.

## Safety Rules
- Do not reset, truncate, reseed, or rewrite inventory data unless explicitly requested.
- Before risky data changes, create a backup in `work/smartpantry/data/`.
- Code changes should not mutate `data/inventory.json`.
- If `/api/inventory` succeeds, the UI must show `SYNCED`, even if local cache migration skips tombstoned items.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in client-side Vite code.
- Do not commit `.env` files or `data/*.json`; user pantry, grocery, meal, and macro data should stay private.

## Supabase Schema
```sql
create table if not exists smartpantry_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

## Inventory Schema
```ts
type InventoryItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  expirationDate: string; // YYYY-MM-DD
  barcode?: string;
  category?: "fridge" | "freezer" | "pantry" | "seasonings";
};
```

## Shopping List
```ts
type NeededEntry = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  reason: "Expired" | "Low stock" | "Out of stock" | string;
};
```
- Shopping List is persistent and should not vanish when automation rules change.
- Shopping List supports manual grocery entries from the Shopping List tab.
- Auto-needed entries are merged into the saved shopping list.
- Quantity `1` is in stock; quantity `0` is needed.

## Automation Logic
- `urgent`: expiration is within 48 hours.
- `expired`: expiration date is before today.
- `low`: quantity is `0`.
- `zeroItem`: unit is `item` and quantity is `0`.
- Any expired, low, or zero-item entry is cloned into the Shopping List tab.

## Storage Sorting
- Pantry inventory display is grouped by `Fridge`, `Freezer`, `Pantry`, and `Seasonings`.
- Existing items without a category are inferred at render time.
- Seasoning-like names should display under `Seasonings` even if an older item was saved with `category: pantry`.

## Recipes
- Recipe cards are source-linked references, not generated recipes.
- Main navigation splits nutrition work into `Recipe Finder`, `Meal Prep`, and `Macro Tracker`.
- Recipe search supports cuisine, ingredient, tag, source, and macro-oriented terms.
- Recipe recommendations prioritize inventory expiring within the next 7 days.
- Recipe cards can be added to multiple day/meal slots through the `Add to meal prep` dropdown.
- Individual recipes and weekly meal plans should offer grocery-list gap suggestions by comparing recipe ingredients against current inventory.
- Grocery gap suggestions should be user-confirmed via Add buttons; do not silently mutate the shopping list.
- Macro goals are user-entered targets and should only change when the user saves edited values.
- Weekly meal plans are editable by day and meal slot: breakfast, lunch, dinner, snack.
- Meal Prep generation supports full week or a specific day/meal; preserve existing entered meals unless the user clears or overwrites them.
- Meal Prep has clear-all and per-slot clear controls.
- Clicking `Meal Done` copies that meal and its macros into the daily log while leaving the plan intact.
- Daily logs track actual food, macros, calories burned, exercise type/minutes, and notes.
- Food log entries should auto-fill estimated macros from planned meals and the local common-food macro library, while remaining manually editable.
- Body recomposition tracking should emphasize planned vs actual calories/protein plus exercise burn, while avoiding medical claims.

## GitHub
- The local Git repo lives in `work/smartpantry`.
- Do not commit `data/*.json`, `dist/`, or `node_modules/`; user pantry and nutrition data should stay private/local.
- Add a GitHub remote only after the user provides the intended repository URL.
