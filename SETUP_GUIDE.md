# Global BookShelf — Complete VS Code Setup Guide
## From zero to fully running locally

---

## WHAT YOU WILL HAVE WHEN DONE

```
Browser (your HTML pages)
        ↕  api.js talks to server
Node.js server (server.js : port 4000)
        ↕  db.js talks to database
PostgreSQL database (stores all data permanently)
```

---

## STEP 1 — CREATE YOUR PROJECT FOLDER

Open VS Code. Then open the Terminal inside VS Code:
```
Menu → Terminal → New Terminal
```

Run these commands in the terminal:

```bash
# Create the project folder on your Desktop
mkdir -p ~/Desktop/GlobalBookShelf
cd ~/Desktop/GlobalBookShelf
```

---

## STEP 2 — COPY ALL YOUR FILES INTO THE FOLDER

From your downloads, copy these files into `GlobalBookShelf/`:

**Backend files (must be together):**
```
server.js
db.js
soul_engine.py
.env.example
```

**Frontend files:**
```
api.js
global-bookshelf.html
ai-reading-soul.html
author-universe.html
book-detail.html
community-hub.html
admin-dashboard.html
index.html
schema-explorer.html
```

**Database file:**
```
global-bookshelf-schema.sql
```

Your folder should look like this in VS Code Explorer:
```
GlobalBookShelf/
├── server.js
├── db.js
├── api.js
├── soul_engine.py
├── global-bookshelf-schema.sql
├── .env.example
├── index.html
├── global-bookshelf.html
├── ai-reading-soul.html
├── author-universe.html
├── book-detail.html
├── community-hub.html
├── admin-dashboard.html
└── schema-explorer.html
```

---

## STEP 3 — INSTALL NODE.JS (if not installed)

Check if you have it:
```bash
node --version
```

If you see `v18` or higher — skip this step.
If you get an error — download Node.js from: https://nodejs.org
Choose the **LTS** version. Install it. Restart VS Code.

---

## STEP 4 — INSTALL ALL NODE PACKAGES

In the VS Code terminal, make sure you are in your project folder:
```bash
cd ~/Desktop/GlobalBookShelf
```

Run this ONE command — it installs everything server.js needs:
```bash
npm init -y && npm install express cors dotenv bcryptjs jsonwebtoken stripe uuid pg express-rate-limit helmet express-validator nodemailer
```

You will see packages downloading. Wait for it to finish.
You will now have a `node_modules/` folder and a `package.json` file.

---

## STEP 5 — INSTALL POSTGRESQL

PostgreSQL is the database that stores all your data permanently.

**On Windows:**
1. Go to https://www.postgresql.org/download/windows/
2. Download the installer (PostgreSQL 15 or 16)
3. Run the installer
4. Remember the password you set for the `postgres` user
5. Keep the default port: **5432**
6. After install, open **pgAdmin** (installed automatically) — this is the visual database manager

**On macOS:**
```bash
# Install Homebrew first if you don't have it:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then install PostgreSQL:
brew install postgresql@15
brew services start postgresql@15
```

**On Ubuntu/Linux:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

---

## STEP 6 — CREATE THE DATABASE

**On Windows (using pgAdmin):**
1. Open pgAdmin (search for it in Start menu)
2. Click on your server in the left panel
3. Right-click on **Databases** → **Create** → **Database**
4. Name: `globalbookshelf` → Click Save

Then run the schema:
1. Right-click on `globalbookshelf` → **Query Tool**
2. Click the folder icon to open a file
3. Select your `global-bookshelf-schema.sql` file
4. Press **F5** or click the ▶ Run button

**On macOS/Linux (in terminal):**
```bash
# Create the database
createdb globalbookshelf

# Run the schema (creates all 42 tables)
psql globalbookshelf < global-bookshelf-schema.sql
```

If you see lines like `CREATE TABLE`, `CREATE INDEX` — it worked.

---

## STEP 7 — CREATE YOUR .env FILE

In VS Code, in your project folder:
1. Right-click in the file explorer panel
2. Click **New File**
3. Name it exactly: `.env` (with the dot, no extension)
4. Paste this inside it:

```
# Server
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# JWT Secret — you can keep this as-is for local testing
JWT_SECRET=gbs-local-dev-secret-change-before-production

# Database — PostgreSQL connection
# Windows (replace YOUR_PASSWORD with the password you set during PostgreSQL install):
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/globalbookshelf

# macOS/Linux (no password needed for local):
# DATABASE_URL=postgresql://localhost/globalbookshelf

# Stripe — leave as-is for demo mode (no real money)
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_PUBLISHABLE_KEY=pk_test_placeholder

# Email — leave empty for now (emails will print to terminal instead)
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
```

**Important:** Save the file.

---

## STEP 8 — START THE BACKEND SERVER

In the VS Code terminal:
```bash
cd ~/Desktop/GlobalBookShelf
node server.js
```

You should see:
```
╔═══════════════════════════════════════════════════╗
║     GLOBAL BOOKSHELF API  v2.0  (PostgreSQL)      ║
╠═══════════════════════════════════════════════════╣
║  Port     : 4000                                  ║
║  Database : PostgreSQL via db.js                  ║
║  Health   : http://localhost:4000/health          ║
╚═══════════════════════════════════════════════════╝
```

**Test it:** Open your browser and go to:
```
http://localhost:4000/health
```

You should see:
```json
{
  "status": "ok",
  "database": "PostgreSQL 15.x",
  "stripe_mode": "test/demo"
}
```

If you see this — your backend is running. ✓

**If you see a database error:**
- Check your `.env` file — make sure `DATABASE_URL` has the right password
- Make sure PostgreSQL is running (pgAdmin should show it as connected)

---

## STEP 9 — OPEN THE FRONTEND

You have two options:

**Option A — Simple (just open the file):**
In VS Code file explorer, right-click on `index.html` → **Open with Live Server**

If you don't have Live Server:
- Click the **Extensions** icon in VS Code (left sidebar, looks like 4 squares)
- Search: `Live Server`
- Install it (by Ritwick Dey)
- Then right-click `index.html` → **Open with Live Server**

This opens your browser at `http://127.0.0.1:5500/index.html`

**Option B — Direct file:**
In VS Code, right-click `index.html` → **Reveal in File Explorer/Finder**
Then double-click the file to open in your browser.

---

## STEP 10 — TEST THAT EVERYTHING WORKS

Open your browser. You need **two tabs**:

**Tab 1** — Check the API is running:
```
http://localhost:4000/health
```
Should show: `"status": "ok"`

**Tab 2** — Open the frontend:
```
http://127.0.0.1:5500/index.html
```

Now test each feature:

### Test 1 — Register an account
1. Open `global-bookshelf.html`
2. Click **Sign In** in the top right
3. Click the **Join free** tab
4. Fill in: Name, Email, Password (8+ chars), Country (TZ)
5. Click **Create my account**
6. You should see: "Welcome, [your name] ✦" toast notification

**Check the backend terminal** — you should see the request logged.

### Test 2 — Books load from database
1. The homepage world map should show book pins
2. The book shelf at the bottom should show real books
3. If you see books — the `GET /api/books` endpoint is working ✓

### Test 3 — Soul quiz saves to database
1. Click **AI Reading Soul** page
2. Complete all 3 questions
3. You should see your archetype
4. Open a new terminal tab and run:
```bash
curl http://localhost:4000/api/soul/profile \
  -H "Authorization: Bearer YOUR_TOKEN_FROM_LOGIN"
```
You should see your soul profile data from PostgreSQL.

### Test 4 — Visa payment (demo mode)
1. Open `author-universe.html`
2. Click on a patron tier
3. Enter test Visa card: `4242 4242 4242 4242`
4. Expiry: `12/28` · CVV: `123`
5. Click Pay
6. Should show "You are now a patron!" ✦

---

## STEP 11 — TWO TERMINALS OPEN AT ONCE

For normal development, you want two terminals open in VS Code:

**Terminal 1 — Backend (keep running):**
```bash
node server.js
```

**Terminal 2 — Free for other commands:**
Use this for checking database, running tests, etc.

To open a second terminal in VS Code:
`Menu → Terminal → New Terminal`
or click the `+` icon in the terminal panel.

---

## COMMON ERRORS AND FIXES

**"Cannot find module 'express'"**
```bash
npm install
```

**"ECONNREFUSED 127.0.0.1:5432" (database not connecting)**
- PostgreSQL is not running
- Windows: Open pgAdmin, check server is running
- Mac: `brew services restart postgresql@15`
- Linux: `sudo systemctl restart postgresql`
- Check your DATABASE_URL password in `.env`

**"port 4000 already in use"**
```bash
# Mac/Linux:
kill $(lsof -ti:4000)
# Windows (in PowerShell):
netstat -ano | findstr :4000
taskkill /PID <PID_NUMBER> /F
```

**CORS error in browser console**
- Make sure `node server.js` is running
- Make sure you are opening the HTML files through Live Server (port 5500), not by double-clicking
- Check `.env` has `FRONTEND_URL=http://localhost:3000` or `*`

**"Failed to fetch" in browser**
- The backend is not running — go to Terminal 1 and run `node server.js`
- Check `http://localhost:4000/health` loads in your browser

**Books not showing on the map**
- The database is empty — you need to seed it
- Run this in a new terminal:
```bash
psql globalbookshelf -c "INSERT INTO books (title, author, origin_country, published_year, genres, original_language, reader_count, status) VALUES ('Things Fall Apart','Chinua Achebe','NG',1958,ARRAY['Fiction','African'],'en',420000,'published'), ('Americanah','Chimamanda Ngozi Adichie','NG',2013,ARRAY['Fiction','Contemporary'],'en',290000,'published'), ('The God of Small Things','Arundhati Roy','IN',1997,ARRAY['Fiction','Post-Colonial'],'en',284190,'published');"
```

---

## YOUR COMPLETE FILE STRUCTURE (final)

```
GlobalBookShelf/
│
├── 🟢 server.js              ← Backend API (run with node server.js)
├── 🟢 db.js                  ← PostgreSQL database layer
├── 🟢 api.js                 ← Frontend API client (loaded by all HTML pages)
├── 🟢 soul_engine.py         ← AI Soul Engine (optional, run separately)
│
├── 🟡 .env                   ← Your secrets (DATABASE_URL, etc.)
├── 🟡 .env.example           ← Template for .env
│
├── 🌐 index.html             ← Launch pad (links to all pages)
├── 🌐 global-bookshelf.html  ← Homepage with world map
├── 🌐 ai-reading-soul.html   ← Soul quiz
├── 🌐 author-universe.html   ← Author profile + Visa payments
├── 🌐 book-detail.html       ← Book page + reviews
├── 🌐 community-hub.html     ← Book clubs
├── 🌐 admin-dashboard.html   ← Admin panel
│
├── 🗄 global-bookshelf-schema.sql  ← Run ONCE to create database tables
│
└── 📦 node_modules/          ← Created automatically by npm install
```

🟢 = JavaScript files (run on Node.js)
🟡 = Configuration files
🌐 = HTML files (open in browser)
🗄 = SQL file (run once in PostgreSQL)

---

## QUICK START CHECKLIST

Every time you want to work on the project:

```
□ 1. Open VS Code → File → Open Folder → GlobalBookShelf
□ 2. Open Terminal (Ctrl+` or Cmd+`)
□ 3. Run: node server.js
□ 4. Open index.html with Live Server
□ 5. Go to http://localhost:4000/health — confirm it says "ok"
□ 6. Build and test
```

That is everything. Your full platform is now running locally.
