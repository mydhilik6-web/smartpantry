# SmartPantry Agents

## Project State
- React/Tailwind PWA served by `server.mjs` on port `8787`.
- Inventory is stored in `data/inventory.json`.
- Shopping list is stored separately in `data/shopping-list.json`.
- Weekly meal plans are stored in `data/meal-plan.json`.
- Daily food/exercise logs are stored in `data/daily-log.json`.
- Deleted inventory ids are tombstoned in `data/deleted-item-ids.json`.
- LocalStorage is fallback/cache only, not the source of truth when the API is reachable.

## Safety Rules
- Do not reset, truncate, reseed, or rewrite inventory data unless explicitly requested.
- Before risky data changes, create a backup in `work/smartpantry/data/`.
- Code changes should not mutate `data/inventory.json`.
- If `/api/inventory` succeeds, the UI must show `SYNCED`, even if local cache migration skips tombstoned items.

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
- Body recomposition tracking should emphasize planned vs actual calories/protein plus exercise burn, while avoiding medical claims.
