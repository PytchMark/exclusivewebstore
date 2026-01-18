create table if not exists public.carts_24h (
  cart_id text primary key,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  site text,
  customer_name text,
  customer_email text,
  customer_phone text,
  items_json jsonb,
  subtotal numeric,
  currency text,
  source text,
  user_agent text,
  ip text
);
