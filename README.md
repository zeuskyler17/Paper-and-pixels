# Paper & Pixels — POS · Job Orders · Inventory

A web app for **Paper & Pixels**, a printing and custom-fabrication shop in San Carlos City, Pangasinan
(wedding albums, picture frames, tarpaulins, invitations, flyers, photo printing).
It runs in any browser — the shop PC for the cashier, phones for the production team.

- [Features](#features)
- [Why this stack](#why-this-stack)
- [Folder structure](#folder-structure)
- [Run locally](#run-locally)
- [Deploy cheaply](#deploy-cheaply)
- [Backup & restore](#backup--restore)
- [Workflow rules](#workflow-rules)
- [Roles & permissions](#roles--permissions)
- [Troubleshooting](#troubleshooting)
- More docs: [Data model / ERD](docs/ERD.md) · [Cashier guide](docs/USER_GUIDE_CASHIER.md) · [Worker guide](docs/USER_GUIDE_WORKER.md) · [Inventory guide](docs/USER_GUIDE_INVENTORY.md) · [Payroll guide (owner)](docs/USER_GUIDE_PAYROLL.md)

## Features

**POS / New order** — pick a customer (or add one on the spot), add products from the price list.
Prices are computed from options: base price + chosen options (cover type, size, add-ons) +
per-unit options (₱120 per album leaf); tarpaulins are priced per sq ft from width × height.
Price override needs a reason. Specs notes, file source (Gmail / USB / Messenger), target date,
order discount with reason and the owner's **approval PIN**. Payment terms: full, downpayment, pay after production, or credit.
Order numbers `PP-2026-00001`, printable order slip.

**Orders & payments** — order list with filters, order detail, add payments at any time
(cash, GCash, Maya, bank transfer — for non-cash payments the cashier picks **which of the shop's GCash / Maya / bank accounts received it**, set up in *Settings → Payment accounts*) with official receipt numbers `AR-2026-00001`, printable receipt,
void a payment with a reason and the owner's approval PIN (a cashier can void when the owner enters their PIN), cancel an order with a reason, release / mark delivered.

**Customers** — contact details, Facebook name, order and payment history, outstanding balance.

**Production board** — one job card per production item, columns Pending → In Process →
Quality Check → Completed. Assign workers; workers see only their jobs on their phone, read specs,
add notes and progress photos, move jobs along. Overdue jobs are red. The order status follows its jobs.

**Products & pricing** — categories, products, options and values, and each product's
bill of materials (BOM).

**Inventory** — four levels: raw-raw (what you buy, e.g. PVC sheet 4×8), raw (what you cut,
e.g. PVC 12×12), printing consumables (ink, photo paper) and daily consumption (tape, gloves, alcohol, cleaning supplies).
Every material is also tagged with what it is **used for** — Albums, Picture frames, Printing, General
consumables or Shared — filterable on the Inventory page (new materials are tagged from the products that
use them when the seed runs). Stock in/out/adjustments, conversions
(cut 1 sheet → 32 pieces), stock card per material, low-stock list, weighted-average cost.
**Photo paper rolls** (*Inventory → Photo paper rolls*): roll paper is stocked in **cm** with the roll's width and
length on the material; the page shows length on hand as full rolls + the open roll, length printed this month, and has
**Load new roll(s)** (adds roll length × count at the per-cm cost) and **Record a print outside an order** (deducts a printed
length in inches / cm). Material costs may hold fractions of a centavo (e.g. ₱0.5695 per cm). Orders deduct print lengths automatically through the Photo Print product's material lines (size × paper).
Materials are **auto-deducted from the BOM** when a job is started (or completed — see Settings). A material line can be
limited to a chosen option value (*Only when* Cover = Leather) and, since the photo-print setup, to two values at once
(*and only when*: Size = 10x14 **and** Paper = Luster).

**Suppliers & purchase orders** — suppliers, POs `PO-2026-00001`, partial/complete receiving
(adds stock at PO cost), supplier payments and payables.

**Deliveries** — pickup, Lalamove/Grab, LBC/J&T, own delivery; rider, tracking no., fee, status,
printable delivery slip.

**Expenses** — daily expenses by category with optional receipt photo; void with reason.

**Production boards per line** — the Production Board has tabs (with open-job counts) for *All boards*, *Wedding Album*,
*Picture Frame*, *Printing Press* and *Photo Printing*; the menu lists them as Albums / Framing / Printing press / Photo printing
board. Any product category with **Goes to production** ticked gets its own tab automatically.
Production workers see their own jobs **plus unassigned pending jobs**, with a **Take this job** button that assigns
the job to themselves (recorded as "Assigned by" the worker); a job still cannot start without an assigned worker. Photo Printing now goes to
production too, so photo-print orders appear on the Photo printing board.

**Dashboard & reports (admin)** — today's sales and collections, receivables, jobs due/overdue,
low stock, and a **Profit & loss chart** (monthly income vs spending with a profit line, 6 / 12 / 24 months — owner roles only;
spending = expenses + materials used at cost, the same formula as the Profit summary report);
sales, collections, receivables, expenses, profit, inventory reports with Excel export.

**Tutorials** — *Menu → Tutorial* (everyone): a narrated, auto-playing walkthrough for staff (23 slides with real
screenshots; Taglish captions, English voice) with chapters for the cashier, production workers, inventory personnel and
the time clock. *Menu → Owner tutorial* (Admin role only, 9 slides): money (P&L, expenses, reports), people (timekeeping
with selfies & GPS, payroll) and setup (users, roles, settings, clean-up, printing). Fullscreen button for a shop TV.
Slides live in `src/app/(app)/tutorial/slides.ts` (`SLIDES` / `OWNER_SLIDES`); after editing them run
`node scripts/tutorial-audio.mjs` to regenerate the voice files (macOS `say`).

**Employees & HR (admin)** — employee database (daily rate or monthly salary, weekly or semi-monthly, work schedule,
SSS/PhilHealth/Pag-IBIG/TIN numbers), **time clock** (employee taps their name + 4-digit PIN on the shop PC or phone; a **selfie and the device's GPS location are taken at every punch**, admin-only, so nobody can time in for someone else or from somewhere else — Timekeeping shows the distance from the shop, and flags punches made from another employee's login or from one device for several people),
daily time records with late / undertime / overtime computed automatically, holiday calendar, admin corrections
(with reason, logged). **Incidents & violations** notes per employee — admins only, never visible to employees.

**Payroll (admin)** — payroll runs `PR-2026-00001` computed from the time records (Philippine rules: OT 125%, rest day 130%,
holidays, paid leave), recurring deductions (SSS now; PhilHealth, Pag-IBIG, tax can be added the same way),
**cash advances** repaid in installments, manual earnings/deductions per payslip, finalize → mark paid
(recorded as a Salaries expense), printable payslips and register, 13th-month report.
Employees with a login see **their own** time records and payslips under *My Time & Pay*.

**Admin** — users and custom roles (tick what each role can open), shop settings (receipt header/footer, BOM deduction timing),
full audit log of every change.

## Why this stack

**Next.js (App Router) + PostgreSQL + Prisma, all in TypeScript.** One codebase holds both the
screens and the server logic: pages read the database directly on the server and forms call
*server actions*, so there is no separate API to build, secure and keep in sync. PostgreSQL is
rock-solid, free, and offered by every host (including free tiers on Neon and Supabase); its
transactions keep order numbers, payments and stock consistent. Prisma gives type-safe queries
and versioned migrations (`prisma/migrations`). The whole thing runs comfortably on a
₱300–₱500/month VPS or on a free-tier managed database plus a small app host.

## Folder structure

```
prisma/
  schema.prisma            data model (money = integer centavos)
  migrations/              SQL migrations (apply with `npx prisma migrate deploy`)
  seed.ts                  demo users, price list, materials, customers, sample orders
scripts/
  backup.sh, restore.sh    database backup / restore (pg_dump / pg_restore)
backups/                   backup dumps (git-ignored)
docs/                      ERD + user guides
src/
  middleware.ts            login check (page access is checked per page from the role's permissions, src/lib/permissions.ts)
  lib/                     shared server logic: auth, money, dates (Asia/Manila), pricing,
                           inventory (stock moves, BOM deduction), orders, jobs, counters, audit
  components/              shared UI (cards, badges, forms, nav, image upload, print button)
  app/
    login/                 login page
    (app)/                 the logged-in app (sidebar layout)
      dashboard/ orders/ customers/ jobs/ deliveries/ products/ inventory/
      purchase-orders/ suppliers/ expenses/ reports/ audit/ users/ settings/ account/
    print/                 printable order slips, receipts, delivery slips, POs
    api/                   attachment downloads, Excel exports
```

## Running on this Mac (Documents/PAPER AND PIXELS)

Everything needed is inside the **PAPER AND PIXELS** folder — no installs required:

| Double-click | What it does |
|---|---|
| **Start Paper & Pixels.command** | Starts the database and the app, then opens http://localhost:3000. Keep the Terminal window open while using the app. |
| **Stop Paper & Pixels.command** | Stops the app and shuts the database down cleanly (do this before shutting down the Mac). |
| **Backup Paper & Pixels.command** | Saves a dated zip of the whole database in `paper-and-pixels/backups/` (keeps the newest 30). Copy that folder to Google Drive or a USB drive regularly. |

- `tools/node` and `tools/postgres` are portable copies of Node.js 22 and PostgreSQL 17 used by these scripts.
- The database lives in `paper-and-pixels/.pgdata` (port 5433). Don't move or edit it while it's running.
- First time: macOS may ask to confirm opening a `.command` file — right-click → **Open**.
- To restore a backup: run **Stop**, rename `.pgdata` to `.pgdata-old`, unzip the backup into `paper-and-pixels/`, run **Start**.

## Run locally

1. **Install Node.js 20 or newer (LTS)** from <https://nodejs.org>.
2. **Get a PostgreSQL database**, either:
   - Mac: install [Postgres.app](https://postgresapp.com), start it, then create a database:
     `/Applications/Postgres.app/Contents/Versions/latest/bin/createdb paperpixels`
   - or a free cloud database at [Neon](https://neon.tech) or [Supabase](https://supabase.com) and copy its connection string.
3. **Configure the app**
   ```bash
   cp .env.example .env
   openssl rand -base64 32      # copy the output into AUTH_SECRET
   ```
   Edit `.env`:
   - `DATABASE_URL` — e.g. `postgresql://YOUR_MAC_USERNAME@localhost:5432/paperpixels?schema=public` for Postgres.app, or the Neon/Supabase string (keep `?sslmode=require`).
   - `AUTH_SECRET` — the random string from `openssl`.
4. **Install, create the tables, load demo data, start**
   ```bash
   npm install
   npx prisma migrate deploy
   npx prisma db seed
   npm run dev
   ```
5. Open <http://localhost:3000>.

**Default logins** (created by the seed):

| Username | Password | Role |
|---|---|---|
| `admin` | `papernpixels123` | Admin (owner) |
| `cashier` | `papernpixels123` | Cashier / Staff |
| `worker` | `papernpixels123` | Production worker (Juan) |
| `worker2` | `papernpixels123` | Production worker (Maria) |
| `inventory` | `papernpixels123` | Inventory personnel (stock out, stock in, conversions) |

> ⚠️ **Change every password right after the first login** (My account → Change password, or
> Users → Reset password as admin). Delete or deactivate the demo users you don't need, and
> replace the sample customers/orders before going live (or start from an empty database and
> run the seed only once for the price list).

Useful commands: `npm run typecheck`, `npm run db:studio` (browse the database),
`npx prisma migrate dev --name <change>` (create a new migration after editing the schema).

## Deploy cheaply

The app needs: Node 20+, a PostgreSQL database, and two environment variables
(`DATABASE_URL`, `AUTH_SECRET`). Always run `npx prisma migrate deploy` before starting a new version.

### Option A — Railway or Render (easiest, ~$5–7/month)

1. Push this folder to a private GitHub repository.
2. **Railway**: New project → Deploy from GitHub repo → add a **PostgreSQL** service.
   **Render**: New → PostgreSQL (copy the *Internal Database URL*), then New → Web Service from the repo.
3. Set environment variables on the web service:
   `DATABASE_URL` (Railway: reference `${{Postgres.DATABASE_URL}}`), `AUTH_SECRET` (random 32+ chars),
   `NODE_ENV=production`.
4. Build command: `npm install && npm run build` · Start command: `npm start`
5. Pre-deploy / release command: `npx prisma migrate deploy`
   (Railway: Settings → Deploy → *Pre-deploy command*; Render: *Pre-Deploy Command*, or prepend it
   to the start command: `npx prisma migrate deploy && npm start`).
6. Once, after the first deploy, load the price list and logins: run `npx prisma db seed` from the
   service shell (Railway: `railway run npx prisma db seed`; Render: *Shell* tab), then change the passwords.

> **About Vercel:** the free *Hobby* plan is for non-commercial use only, so a business should use
> Railway/Render/a VPS — or Vercel Pro together with a Neon database.

### Option B — a small VPS (DigitalOcean / Hetzner / Vultr, ~$5/month)

Ubuntu 24.04, 1 GB RAM is enough. The app is built with `output: 'standalone'`.

```bash
# 1. System packages (as root)
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs postgresql postgresql-client git debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
npm install -g pm2
timedatectl set-timezone Asia/Manila     # so cron times are Manila time

# 2. Database
sudo -u postgres psql -c "CREATE USER paperpixels WITH PASSWORD 'CHANGE_THIS_DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE paperpixels OWNER paperpixels;"

# 3. App user and code
adduser --disabled-password --gecos "" app
su - app
git clone https://github.com/YOUR_ACCOUNT/paper-and-pixels.git && cd paper-and-pixels
cp .env.example .env
nano .env   # DATABASE_URL="postgresql://paperpixels:CHANGE_THIS_DB_PASSWORD@localhost:5432/paperpixels?schema=public"
            # AUTH_SECRET="$(openssl rand -base64 32)"

# 4. Build and start
npm ci
npx prisma migrate deploy
npx prisma db seed            # first time only
npm run build
cp -r .next/static .next/standalone/.next/static
PORT=3000 HOSTNAME=127.0.0.1 pm2 start .next/standalone/server.js --name paperpixels --node-args="--env-file=.env"
pm2 save
exit                          # back to root
env PATH=$PATH:/usr/bin pm2 startup systemd -u app --hp /home/app   # start on boot
```

**HTTPS with Caddy** — point your domain's A record to the server IP, then put this in
`/etc/caddy/Caddyfile` and run `systemctl reload caddy` (Caddy gets the certificate automatically):

```
pos.papernpixels.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Updating to a new version** (as `app`, inside the folder):

```bash
git pull && npm ci && npx prisma migrate deploy && npm run build \
  && cp -r .next/static .next/standalone/.next/static && pm2 restart paperpixels
```

**Time zone:** the app always shows dates in Asia/Manila regardless of the server time zone, so
`TZ` is not required for the app itself. Still set the server to `Asia/Manila` (above) or put
`CRON_TZ=Asia/Manila` in the crontab so the nightly backup runs at Manila time.

## Backup & restore

Everything — orders, payments, inventory, **and the job photos and expense receipts** (stored in the
database) — is in PostgreSQL. **One database dump = a complete backup.**

### Daily automatic backup (VPS)

`scripts/backup.sh` reads `DATABASE_URL` from `.env`, writes
`backups/paperpixels-YYYY-MM-DD_HHMM.dump` (`pg_dump --format=custom`), keeps the newest 30 and
prints the file path. Schedule it every night at **11:30 PM Manila time** (`crontab -e` as `app`):

```cron
CRON_TZ=Asia/Manila
30 23 * * * cd /home/app/paper-and-pixels && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Check it works: `./scripts/backup.sh` then `ls -lh backups/`.
`pg_dump` must be the same or newer major version than the database server
(`apt install postgresql-client-16` etc. if needed).

### Managed databases

Neon, Railway and Supabase keep their own automatic backups / point-in-time restore — check that it
is enabled on your plan. It's still worth running `backup.sh` from any computer with the
connection string once a week (`DATABASE_URL="..." ./scripts/backup.sh`) so you own a copy.

### Copy backups off the server

A backup on the same server dies with the server. Install [rclone](https://rclone.org)
(`apt install rclone`), run `rclone config` once to add a Google Drive remote named `gdrive`, then
uncomment the `rclone copy` line at the bottom of `scripts/backup.sh`. Each nightly dump is then
also uploaded to Google Drive → `PaperPixelsBackups/`.

### Restore (tested procedure)

1. Stop the app: `pm2 stop paperpixels`.
2. Pick the dump: `ls -lt backups/` (or download it from Google Drive into `backups/`).
3. Restore: `./scripts/restore.sh backups/paperpixels-2026-10-16_2330.dump` and type `RESTORE`
   to confirm. It runs `pg_restore --clean --if-exists --no-owner` into `DATABASE_URL`.
4. Start the app: `pm2 start paperpixels`, log in, check the latest orders and payments.

**Practice once a month**: restore the latest dump into a *separate* test database
(`createdb paperpixels_test`, then `DATABASE_URL=postgresql://.../paperpixels_test ./scripts/restore.sh <file>`)
and open a few orders. A backup you have never restored is only a hope.

## Workflow rules

The app enforces these shop rules:

1. **No release without full payment.** An order can only be marked Delivered / Picked up when its balance is ₱0. Only the admin can override, with a reason that is logged (`OVERRIDE` in the audit log).
2. **A job can't start until a worker is assigned.** Workers can only move jobs assigned to them; materials are auto-deducted from stock when the job starts (or completes — see Settings).
3. **Nothing is deleted.** Orders are cancelled and payments/expenses are voided — always with a reason — and every action is recorded in the audit log.
4. **Numbers are sequential and never reused.** Order (PP-YYYY-#####), receipt (AR-YYYY-#####) and PO (PO-YYYY-#####) numbers come from a counter that is incremented inside the same database transaction as the record, so a failed save never skips or reuses a number.
5. **Money is never a float.** All amounts are stored as whole centavos (integers).

Also: overriding a suggested price or giving a discount requires a reason, and both prices are kept. **Discounts and payment voids need the owner's approval PIN** (each admin sets a 4–8 digit PIN under *My account → Approval PIN*); the approver is saved on the record and in the audit log. 5 wrong PINs lock approvals for 5 minutes.

## Roles & permissions

Adding an employee also creates their login (username, role, initial password) in the same step, so every employee can time in and see their own records; because that creates a login, **only the Admin role can add employees**. Older employees without a login get a **Create login** card on their page (Admin only). Employees, logins and roles live in one place: *Menu → Employees & Users*, with tabs **Employees** (HR permission), **Logins (users)** and **Roles & access** (Admin only). Roles are managed by the owner under the **Roles & access** tab. Click **+ New role**, name it
(e.g. "Front desk", "Helper", "Supervisor") and tick what it can open, module by module. Then pick the role when adding or editing a user. You can also choose **+ New role** right in the user form, type the role name and tick its access; the role is saved with the user and can be picked for others later.
Changing a role's ticks applies to everyone with that role on their next click. Nobody has to log out.

- **Admin (owner)** is locked: always full access, can't be edited or deleted. Only Admin can manage users & roles and set the approval PIN.
- The other three roles below are ready-made presets. Edit or rename them freely; a role can only be deleted once no user has it.
- A role with **My jobs (production worker)** ticked makes its users show up in the worker lists (assign job, stock out "released to").
- Reports: **All reports** opens every report. **Production reports** (worker productivity) and **Inventory reports** (inventory valuation & movement) open just that report, including its Excel/CSV export.
- Ready-made supervisor roles: **Production Supervisor** (production board, deliveries, price list view, production reports) and **Inventory Supervisor** (inventory, stock out, purchasing, inventory reports).
- Everyone can always use the Time Clock, My Time & Pay (if linked) and My account.

The presets start out as:

| Area | Admin (owner) | Cashier / Staff | Production worker | Inventory personnel |
|---|:-:|:-:|:-:|:-:|
| Dashboard | ✔ | ✔ | | |
| New order, orders, payments, receipts | ✔ | ✔ | | |
| Customers | ✔ | ✔ | | |
| Production board | ✔ all jobs, assign | ✔ all jobs, assign | ✔ own jobs only | |
| Deliveries | ✔ | ✔ | | |
| Products & pricing | ✔ | ✔ (view) | | |
| Inventory: materials, stock out (released to a worker), stock in, counts, conversions | ✔ | ✔ | | ✔ |
| Suppliers, purchase orders | ✔ | ✔ | | |
| Expenses | ✔ | ✔ | | |
| Cancel an order (with reason) | ✔ | ✔ | | |
| Void a payment (reason + owner approval PIN) | ✔ | ✔ with owner PIN | | |
| Void an expense (with reason) | ✔ | | | |
| Edit price list, expense categories | ✔ | | | |
| Approve a discount / void (approval PIN) | ✔ | | | |
| Release order with unpaid balance (override) | ✔ | | | |
| Reports & Excel export | ✔ | | | |
| Audit log | ✔ | | | |
| Users, Settings | ✔ | | | |
| Employees, timekeeping, payroll, incidents | ✔ | | | |
| Time Clock (with own PIN) | ✔ | ✔ | ✔ | ✔ |
| My Time & Pay (own records & payslips only, if linked) | ✔ | ✔ | ✔ | ✔ |
| My account (change own password) | ✔ | ✔ | ✔ | ✔ |

## Branches

The app serves three branches — **Paper & Pixels** (main), **Keoni Studio** and **KY Digital Photo Services** — from one
installation, each with its **own database**: customers, orders, products, inventory, employees, time records, users,
roles and settings are completely separate. You pick the branch on the sign-in page; the choice is kept for the session
(cookie + signed token, checked on every request), and every database call is routed to that branch — a request with no
branch fails closed rather than falling back to another branch's data.

- Branch list: `src/lib/branches.ts`. Database URLs: `DATABASE_URL` (P&P), `DATABASE_URL_KEONI`, `DATABASE_URL_KY` in `.env`
  (same local Postgres, databases `paperpixels`, `keoni`, `kydigital`). `start.sh` migrates all of them.
- New branch database: add it to `branches.ts` and `.env`, start the app once (migrations create it), then run
  `npx tsx --tsconfig tsconfig.json scripts/branch-init.ts <key> "<Owner name>"` to create the roles, shop name and the
  `owner` login (prints a temporary password — change it on first sign-in).
- Keoni Studio and KY Digital use **simple inventory** (`simpleInventory: true` in `branches.ts`). Their materials have three
  types: **Finished products (from P&P)** — albums and frames made by the main branch, received with Stock in from the preset
  supplier "Paper & Pixels (main branch)" and deducted when sold (put the finished item on the product's bill of materials, qty 1);
  **Printing consumables** for the branch's own printer; **Daily consumption**. No raw-raw / raw levels, no cutting, no "used for".
  Paper & Pixels keeps the full three-level inventory.
- Each branch has its own owner/admin account and staff logins. The Mac backup (`local-backup.sh`) covers all branches.

### Transfers to a branch (main branch)

In Paper & Pixels the two branches exist as **customers** flagged *One of our branches* (Customers → edit → checkbox).
An order for such a customer is a **stock transfer**, not a sale: every line is priced ₱0, no discount or payment is
accepted, the slip prints as a *Branch Transfer Slip — no charge*, and the order is left out of today's sales, the P&L,
receivables and the sales/profit reports. Production, the board and deliveries work exactly as for a normal order, and the
materials used are deducted as usual. The branch then records the received items with **Stock in** (type *Finished product*).

## Phones on the shop Wi-Fi (HTTPS)

Phones open the app at **https://<this Mac's IP>:3443** (Start prints the exact address, e.g. `https://192.168.1.32:3443`).
HTTPS is needed because phone browsers only allow the **time-clock camera and GPS** on secure addresses. It is built in,
with nothing to download:

- `scripts/make-cert.sh` creates a private **certificate authority** once (`certs/ca.key`, keep it private) and issues the
  app's certificate for the Mac's current IP and `<mac-name>.local`; `start.sh` re-issues it automatically when the IP changes.
- `scripts/https-proxy.mjs` serves HTTPS on port 3443 and forwards to the app on 3000 (started/stopped with the app).
- **Each phone, once:** open `http://<ip>:3000/phone-setup.html`, download the certificate and trust it (the page has the
  iPhone and Android steps). After that, `https://<ip>:3443` opens without warnings and the time clock can use the camera and GPS.
- The Mac itself keeps using http://localhost:3000, which browsers already treat as secure.

If the router gives the Mac a new IP, phones use the new address (or `https://<mac-name>.local:3443`); nothing needs reinstalling.

## Troubleshooting

| Problem | Fix |
|---|---|
| `AUTH_SECRET is missing or too short` | Set `AUTH_SECRET` in `.env` to a random string of 16+ characters (`openssl rand -base64 32`) and restart. |
| `Can't reach database server` / `P1001` | Is Postgres running (Postgres.app elephant icon / `systemctl status postgresql`)? Is `DATABASE_URL` correct? Cloud databases need `?sslmode=require`. |
| `The table "public.users" does not exist` | Run `npx prisma migrate deploy`. |
| Login says wrong username or password on a new install | Run `npx prisma db seed`; usernames are lowercase. |
| Forgot the admin password | Another admin can reset it under **Users**. If you are the only admin: generate a hash with `node -e "require('bcryptjs').hash('newpass123',10).then(console.log)"`, open `npx prisma studio`, paste it into that user's `passwordHash`, save, then log in and change the password. |
| `@prisma/client did not initialize yet` | Run `npx prisma generate` (it also runs automatically after `npm install`). |
| Order slip / receipt prints on the wrong paper size | In the print dialog choose the correct paper and set margins to "None"/"Default", scale 100%. |
| Photos won't upload | Very large files are resized on the phone first; if it still fails check the internet connection and that the file is an image. |
| Backup fails with `server version mismatch` | Install a `pg_dump` matching (or newer than) the server's PostgreSQL major version. |
| `next start` warns about `output: standalone` | Harmless on Railway/Render. On a VPS use `node .next/standalone/server.js` as shown above. |
