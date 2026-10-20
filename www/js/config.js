// FRENZO Ledger — app configuration.
// Fill these in from Supabase → Project Settings → API (the anon key is safe to ship in the app;
// row-level security in the database decides what each signed-in person can do).
window.FRENZO_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY",
  // Set to false to hide the "paste an order" AI helper until the parse-order function is deployed.
  aiParsing: true
};
