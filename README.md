# FRENZO Ledger — the app

The FRENZO stock ledger as an iPhone and Android app: stock, reservations, events, event day for the crew, expenses, income, supplier orders, documents. Same screens as the ledger you use today, now with its own database and sign-in.

**How it's put together**

| Part | What it is |
|---|---|
| `src/ledger.html` | The ledger page itself (unchanged from the artifact). |
| `www/js/adapter.js` | Connects the page to the Supabase database, sign-in, and the phone's file sharing. |
| `www/js/login.js` | The sign-in screen and the Sign out link. |
| `supabase/migrations/0001_init.sql` | Database tables, roles (owner / crew) and security rules. |
| `android/`, `ios/` | The native app shells (Capacitor). |
| `.github/workflows/` | Automatic builds (Android APK/AAB, iOS → TestFlight), the hourly data snapshot, the one-time import, and the change inbox. |
| `seed/snapshot.json` | Your data exported from the old ledger, ready to import. |
| `data/snapshot.json` | Hourly copy of the live data that the scheduled Claude tasks read. |

---

## Setup, step by step

You need four accounts in your own name: **GitHub** (free), **Supabase** (free), **Google Play Console** (US$25 once), **Apple Developer Program** (US$99/year). Steps 1–5 take about an hour; the store steps depend on Apple's and Google's approvals.

### 1. GitHub — put the code in your account
1. Create a free account at github.com with your personal email.
2. Click **New repository**, name it `frenzo-ledger`, set it to **Private**, create it empty.
3. In claude.ai → Settings → Connectors, connect GitHub. Then ask Claude to push the app code to `frenzo-ledger`. (Or upload this folder yourself.)

### 2. Supabase — the database
1. Sign up at supabase.com (you can sign in with GitHub). Click **New project**: name `frenzo-ledger`, region **Southeast Asia (Singapore)**, choose a database password and save it.
2. When the project is ready, open **SQL Editor → New query**, paste the whole of `supabase/migrations/0001_init.sql`, and click **Run**. It should say "Success".
3. Open **Project Settings → API** and copy three things:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (safe to put in the app)
   - **service_role** key (secret — only ever goes into GitHub secrets, never into the app)
4. Open **Authentication → Providers → Email** and turn **off** "Confirm email" (so you and the crew can sign in right after creating an account). Optional: turn it back on later.

### 3. GitHub secrets — let the builds reach the database
In the `frenzo-ledger` repository: **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | the Project URL |
| `SUPABASE_ANON_KEY` | the anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key |

### 4. Import your data (once)
**Actions → "Import old ledger data (one time)" → Run workflow.** This loads everything from the old ledger (catalog, stock movements, reservations, events, supplier orders, expenses, event-day logs) into the new database. Takes under a minute.

### 5. Your account
The **first** account created in the app becomes the **owner** (full access). Everyone who signs up after that is **crew** (Event day screen only). So: install the app (step 6 or 7) and create your account first, before the crew. To change someone's role later: Supabase → Table Editor → `profiles` → edit `role`.

### 5b. No app store? Two ways to install without submitting anything
- **Android phone:** the test APK from step 6 installs directly from the GitHub Actions page. No Play Console account, no fee, no review. Share the same APK file with crew on Android.
- **Any phone, including iPhone:** publish the app as a website (free, on GitHub Pages: repository Settings → Pages → Source "GitHub Actions"; the "Web app" workflow does the rest) and **Add to Home Screen** from Safari or Chrome. It gets the FRENZO icon, opens full-screen, works offline for the app itself, and gets updates automatically. No Apple or Google account needed. This is the recommended route for iPhone if you don't want the App Store.
- An iPhone app that is installed *as an app* without the public store still needs the Apple Developer account (US$99/year) and TestFlight — step 7 minus the final "submit for review".

### 6. Android
- **Try it on your phone now:** Actions → **Android build** → the latest run → download `frenzo-ledger-debug.apk`, open it on an Android phone (allow "install from unknown sources"). This is for your own testing; it isn't the store version.
- **Play Store:** in Play Console create the app "FRENZO Ledger" (app, not game; free). Google asks for a signing key: create one with Android Studio or ask Claude for the one-line command, then add these secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The next Android build also produces `frenzo-ledger-release.aab`; upload it in Play Console → Testing → Internal testing first, then Production. Google's review usually takes 1–3 days the first time.

### 7. iPhone
1. In App Store Connect (appstoreconnect.apple.com) → **Users and Access → Integrations → App Store Connect API → Generate API key**, role **Admin**. Download the `.p8` file (you can only download it once) and note the **Key ID** and **Issuer ID**. Your **Team ID** is at developer.apple.com → Membership.
2. Add GitHub secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `APPLE_TEAM_ID`, and `ASC_KEY_P8_BASE64` (the .p8 file as base64 — on a Mac: `base64 -i AuthKey_XXXX.p8 | pbcopy`; or ask Claude to convert it).
3. In App Store Connect → **Apps → +** create the app: name "FRENZO Ledger", bundle ID `ph.frenzo.ledger` (register it first at developer.apple.com → Identifiers if it isn't offered), SKU `frenzo-ledger`.
4. Actions → **iOS build → TestFlight** → Run workflow. About 15 minutes later the build appears in App Store Connect → TestFlight. Install TestFlight on your iPhone, add yourself as a tester, and the app is on your phone.
5. For the public App Store listing, fill in screenshots and description in App Store Connect and submit the TestFlight build for review (1–3 days).

### 8. Crew devices
Crew install the same app (TestFlight / Play internal testing, or the public store later), tap **Create an account**, and they land straight on the Event day screen the moment you open an event — exactly like the shared tablet today.

### 9. Optional: the "paste an order" AI helper
This feature reads a customer's message or screenshot and fills the reservation form. It needs an Anthropic API key (console.anthropic.com, pay per use — a few centavos per order). Deploy `supabase/functions/parse-order` (Supabase → Edge Functions → deploy via CLI or the dashboard editor), set the secret `ANTHROPIC_API_KEY` under Edge Functions → Secrets, and set the GitHub **variable** `AI_PARSING` to `true`. Until then the helper is hidden in the app.

---

## After it's live

- **The old ledger** keeps working but is no longer the source of truth once you've imported and started using the app. Claude will switch the five scheduled tasks (iFern calendar sync, Household Ledger sync, Drive backup, day-before alert, weekly and monthly summaries) to read `data/snapshot.json` from this repository, which refreshes every hour.
- **Claude can still add bookings and fix data for you:** it commits a small change file to `data/inbox/`, and GitHub applies it to the database within a minute.
- **Updates to the app:** when Claude changes `src/ledger.html`, pushing to `main` builds a new Android APK automatically; the iOS build runs on demand (Actions → iOS build) or when a version tag like `v1.1.0` is pushed. Store versions need re-uploading each time (Play Console / TestFlight).

## Working locally (optional)
```
npm install
npm run build     # makes www/index.html from src/ledger.html
npm test          # runs the app end to end against a fake database
npm run sync      # copies the web app into android/ and ios/
```
