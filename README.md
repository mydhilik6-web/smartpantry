# SmartPantry

Inventory groceries, maintain shopping lists, track expiration dates, find source-linked recipes, plan meals, and track macros.

## Local Development

```bash
pnpm install
pnpm build
pnpm start
```

Without cloud database variables, the app uses local JSON files in `data/` so local development still works.

## Render Free Plan + Supabase

Render's free web services have ephemeral disk, so production data should not be saved to `data/*.json`. SmartPantry will use Supabase automatically when these environment variables are set on the server:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_TABLE=smartpantry_store
```

Create the Supabase table first from the Supabase SQL editor:

```sql
create table if not exists smartpantry_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

On Render, use:

```bash
Build Command: pnpm install --frozen-lockfile && pnpm build
Start Command: pnpm start
```

Add the environment variables above in Render's Environment tab. `SUPABASE_SERVICE_ROLE_KEY` must stay server-side only; do not put it in Vite client variables.

## Migrating Local Data To Supabase

If the Supabase variables are only set inside Render, upload your local `data/*.json` backup through the deployed app API. The API still writes into Supabase because Render has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; it does not persist this data on Render disk.

First add a temporary `SMARTPANTRY_IMPORT_TOKEN` environment variable in Render and redeploy. Use any long random value. Then run this locally with the same token:

```bash
SMARTPANTRY_API_URL=https://your-render-app.onrender.com SMARTPANTRY_IMPORT_TOKEN=your-token pnpm migrate:api
```

If you have the Supabase variables available locally too, you can upload straight to Supabase instead:

```bash
pnpm migrate:supabase
```

Both migration commands upload existing `data/*.json` store files. They do not delete or rewrite your local files.

For a one-file inventory restore after setting `SMARTPANTRY_IMPORT_TOKEN` in Render, this also works:

```bash
curl -X POST https://your-render-app.onrender.com/api/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d @data/inventory.json
```
