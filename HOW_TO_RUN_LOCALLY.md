# Global BookShelf — Complete Local Setup Guide
# Connect Frontend + Backend + Database on Windows

## What you already have (no need to build)
- server.js       ← Node.js backend, 88 API endpoints, ready to run
- db.js           ← PostgreSQL database layer, all queries written
- api.js          ← Frontend client, loaded by every HTML page
- All HTML pages  ← Already call api.js which points to localhost:4000
- .env.example    ← Template for all environment variables
- global-bookshelf-schema.sql ← Complete database structure

## What you need to install (one time only)

1. Node.js v20 LTS        → https://nodejs.org  (click the LTS button)
2. PostgreSQL 16           → https://www.postgresql.org/download/windows
3. VS Code                 → https://code.visualstudio.com
4. VS Code Live Server ext → search "Live Server" by Ritwick Dey in VS Code extensions

## Step 1 — Create your project folder

Open File Explorer → create a folder called:
  C:\Users\YourName\GlobalBookShelf

Copy ALL files from the ZIP into this folder:
  server.js, db.js, api.js, .env.example,
  global-bookshelf-schema.sql, all HTML files, soul_engine.py

## Step 2 — Install Node.js packages (one time only)

Open VS Code → open the GlobalBookShelf folder → press Ctrl+` to open terminal → run:

  npm init -y

Then install all required packages:

  npm install express cors dotenv bcryptjs jsonwebtoken stripe uuid pg express-rate-limit helmet express-validator nodemailer

Wait for it to finish. You will see a node_modules folder appear.

## Step 3 — Set up PostgreSQL database

Open pgAdmin (installed with PostgreSQL) → right-click Databases → Create → Database
Name it: globalbookshelf

Or use the terminal:
  psql -U postgres
  CREATE DATABASE globalbookshelf;
  \q

Then load the schema (creates all 42 tables):
  psql -U postgres -d globalbookshelf -f "C:\Users\YourName\GlobalBookShelf\global-bookshelf-schema.sql"

## Step 4 — Create your .env file

In your GlobalBookShelf folder, copy .env.example and rename it to .env

Open .env and fill in these values:

  NODE_ENV=development
  PORT=4000
  JWT_SECRET=any-long-random-string-you-make-up-here-123abc
  DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/globalbookshelf
  STRIPE_SECRET_KEY=sk_test_placeholder
  STRIPE_PUBLISHABLE_KEY=pk_test_placeholder

Replace YOUR_POSTGRES_PASSWORD with the password you set when installing PostgreSQL.
For now the Stripe keys can stay as sk_test_placeholder — payments won't charge real cards.

## Step 5 — Start the backend server

In VS Code terminal:
  node server.js

You should see:
  Global BookShelf server running on port 4000
  Database: connected

Test it by opening your browser and going to:
  http://localhost:4000/health

You should see: {"status":"ok","database":"connected"}

## Step 6 — Open the frontend

In VS Code, right-click global-bookshelf.html → Open with Live Server

Your browser opens at http://127.0.0.1:5500/global-bookshelf.html

The homepage now shows REAL data from your database. Every page navigation
works fully. Sign In, Join Free, all API calls go to localhost:4000.

## Every time you work on the project

1. Open VS Code → open GlobalBookShelf folder
2. Open terminal (Ctrl+`) → run: node server.js
3. Right-click global-bookshelf.html → Open with Live Server
4. Keep both running while you work

## Troubleshooting

Problem: "Cannot find module 'express'"
Fix: Run npm install again

Problem: "password authentication failed for user postgres"  
Fix: Check your DATABASE_URL password in .env matches your PostgreSQL password

Problem: "port 4000 already in use"
Fix: Kill the old server: in terminal press Ctrl+C, then node server.js again

Problem: Pages show empty book shelves
Fix: Make sure node server.js is running AND you opened with Live Server (not double-click)

Problem: http://localhost:4000/health shows "database: disconnected"
Fix: Make sure PostgreSQL service is running (search Services in Windows, find postgresql-x64-16, Start it)
