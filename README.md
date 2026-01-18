# exclusivewebstore

Vanilla storefront + Cloud Run Express backend for Fiserv checkout and 24-hour cart lead capture.

## Folder structure

```
/public
  index.html
  /assets
    /css
      styles.css
    /js
      storefront.js
/server.js
/services
  supabase.js
/payments
  fiserv.js
/supabase_schema.sql
```

## Environment variables

Copy `.env.example` and set the required values.

- `FISERV_STORE_ID`
- `FISERV_SHARED_SECRET`
- `FISERV_FORM_ACTION`
- `DEFAULT_CURRENCY` (default `388`)
- `DEFAULT_TIMEZONE` (default `UTC`)
- `STORE_RETURN_URL` (optional)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `SMTP_FROM_NAME`
- `PORT` (default `8080`)

24-hour cart lead capture requires Supabase and writes to the `carts_24h` table:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Local development

```bash
npm install
npm start
```

Visit `http://localhost:8080` to load the storefront.

## Endpoints

- `GET /health`
- `POST /api/checkout/start`
- `POST /api/cart/save`
- `GET|POST /payment-result`
