// FRENZO Ledger — app configuration.
// Fill these in from Supabase → Project Settings → API (the anon key is safe to ship in the app;
// row-level security in the database decides what each signed-in person can do).
window.FRENZO_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY",
  // The app is a live view of the FRENZO Stock Ledger: all editing happens in the ledger.
  readOnly: true,
  // Set to true only if the parse-order function is deployed (and readOnly is false).
  aiParsing: false
};
