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

If you already inventoried food locally, set the Supabase variables in a local `.env` or shell and run:

```bash
pnpm migrate:supabase
```

The migration uploads existing `data/*.json` store files to Supabase. It does not delete or rewrite your local files.
