# Moscow Bakers deployment

## Recommended free-tier stack

- **GitHub** remains the source-code repository.
- **Render** runs the Node.js/Express app and serves the customer website plus the authenticated `/admin` panel from one origin. Its free web service can sleep when idle and may have cold starts; upgrade the web instance if uninterrupted response time is needed.
- **Supabase** provides managed PostgreSQL and persistent object storage for product images/videos. This repository already contains Supabase client dependencies, so it avoids introducing another storage vendor. Free-plan quotas and inactivity rules can change; check the current plan limits before launch.

At the time this deployment setup was prepared, Supabase Free listed 500 MB of database, 1 GB of Storage, and automatic project pausing after one week of inactivity. Render Free web services use limited shared compute and may sleep while idle. These tiers can serve a small site while your computer is off, but they are not an always-on or backup guarantee. Review the [Render pricing](https://render.com/pricing) and [Supabase pricing](https://supabase.com/pricing) before launch.

The app uses Supabase PostgreSQL through `DATABASE_URL`, Supabase Storage through a server-only service-role key, and PostgreSQL-backed sessions. The customer site and admin use the same deployed Express service by default. The public homepage has no admin-panel link; `/admin` redirects unauthenticated visitors to `/admin-login.html`.

## Preserve and migrate current data

The original `database.sqlite` and `uploads/` directory are kept locally and are not deleted by deployment. Do not replace or remove them until the migration has been verified.

1. Create a Supabase project. In Project Settings, get a PostgreSQL connection string suitable for a hosted Node service (the Supabase session pooler is usually the practical choice), the project URL, and the service-role key.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Choose a new owner email and strong password in `ADMIN_EMAIL` and `ADMIN_PASSWORD`; set a long random `SESSION_SECRET`. The migration refuses to copy the old seeded `admin123` credential unless these replacement credentials are provided.
3. Install dependencies with `npm ci`.
4. Check the source counts and media references without writing anything:

   ```sh
   npm run migrate:cloud -- --dry-run
   ```

5. Run the migration:

   ```sh
   npm run migrate:cloud
   ```

   It creates missing tables, copies existing SQLite rows using conflict-safe inserts, copies referenced media into a public-read Supabase Storage bucket, and reports row counts before and after. It never drops, truncates, or deletes source or destination records. If a migration is interrupted, the row copy can be safely rerun; existing IDs are left intact.
6. Confirm the reported destination counts and test product images before deployment. Keep the SQLite file and uploads backup.

If the existing SQLite file has already been modified with a non-default admin password, the migration preserves that password hash. Store the matching credentials securely and rotate them through the owner account process if needed.

## Deploy from GitHub to Render

1. Push this repository to GitHub and create a Render Web Service from that repository. Render detects `render.yaml`; use `npm ci` for build and `npm start` for start.
2. Set the service environment variables from `.env.example` in Render. Use the same `DATABASE_URL`, Supabase project URL/key, bucket name, owner credentials, and session secret used for migration. Do not add the service-role key to `config.js`, GitHub Pages, or any browser script.
3. Wait for `/health` to return `{ "ok": true, "status": "healthy" }`. Visit the Render service root for the customer site and `/admin` for the protected dashboard.
4. Test login, edit a product price, add an offer, submit a test order, and confirm changes appear on the customer page. The customer page refreshes database data periodically so changes appear without a redeploy.
5. In Render, enable automatic deploys from the GitHub repository. GitHub remains the source repository; the deployed site/API run on Render rather than GitHub Pages.

The Render blueprint leaves secrets as `sync: false`; enter them in the Render dashboard after creating the service. Supabase's database and storage are separate resources from Render, so their credentials are configured there rather than provisioned by the blueprint.

## Optional GitHub Pages customer mirror

The recommended deployment serves the customer website and API from Render. If you also publish the customer-only static files with GitHub Pages, set `window.MB_API_BASE` in `config.js` to the Render service origin, for example `https://moscow-bakers.onrender.com` (without a trailing slash). Add the GitHub Pages **origin** to Render's comma-separated `CUSTOMER_ORIGINS`; origins contain only scheme and host, such as `https://account.github.io` or `https://organization.github.io`. This grants browser access to public store data and order submission only; administer the store at the Render `/admin` URL, not the GitHub Pages copy.

## Local development

Without `DATABASE_URL`, Express continues using the existing SQLite file. Without Supabase storage credentials, new uploads stay in the local `uploads/` folder. Start the server with `npm start` and visit `http://localhost:3011`. VS Code Live Server on port 5500 uses that Express instance for API and uploaded-media URLs.
