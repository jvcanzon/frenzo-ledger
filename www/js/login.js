/* Sign-in screen shown over the ledger until there is a session, plus a sign-out control. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const auth = window.claude && window.claude.auth;
  const css = `
  #fz-login{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#f6f4fb);padding:16px}
  #fz-login[hidden]{display:none}
  .fz-card{width:min(400px,100%);background:var(--surface,#fff);border:1px solid var(--line,#e6e2ef);border-radius:18px;padding:26px 22px;box-shadow:0 10px 40px rgba(60,30,90,.08)}
  .fz-card h1{margin:0 0 2px;font-size:24px}
  .fz-card .eyebrow{display:block;margin-bottom:10px}
  .fz-card label{display:grid;gap:4px;font-size:13px;font-weight:600;margin-top:12px}
  .fz-card input{padding:11px 12px;border:1px solid var(--line,#ddd);border-radius:10px;font:inherit;font-size:16px}
  .fz-card .btn{margin-top:14px;width:100%;justify-content:center;padding:11px}
  .fz-links{display:flex;justify-content:space-between;margin-top:12px;font-size:13px}
  .fz-links button{all:unset;cursor:pointer;color:var(--accent,#6b3fa0);text-decoration:underline}
  #fz-msg{min-height:1.4em;font-size:13px;margin-top:10px}
  #fz-msg.err{color:var(--bad,#b71c1c)}#fz-msg.good{color:var(--ok,#2e7d32)}
  #fz-signout{all:unset;cursor:pointer;font-size:12.5px;color:var(--ink-3,#777);text-decoration:underline;margin-left:10px}
  #fz-noconfig{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:#fff;font:15px/1.5 system-ui}`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

  if (!auth) {
    const d = document.createElement("div"); d.id = "fz-noconfig";
    d.innerHTML = `<div style="max-width:420px"><b>FRENZO Ledger isn't configured yet.</b><br>Add your Supabase project URL and anon key to <code>www/js/config.js</code>, then rebuild.</div>`;
    document.body.appendChild(d); return;
  }

  let mode = "signin";
  const box = document.createElement("div"); box.id = "fz-login"; box.hidden = true;
  box.innerHTML = `<form class="fz-card" id="fz-form" novalidate>
    <span class="eyebrow">FRENZO</span><h1 id="fz-title">Sign in</h1>
    <div class="faint" id="fz-sub" style="font-size:13px">Use the email and password for your FRENZO Ledger account.</div>
    <label id="fz-name-l" hidden>Your name<input type="text" id="fz-name" autocomplete="name"></label>
    <label>Email<input type="email" id="fz-email" autocomplete="username" inputmode="email" required></label>
    <label id="fz-pass-l">Password<input type="password" id="fz-pass" autocomplete="current-password" required minlength="6"></label>
    <button class="btn primary" type="submit" id="fz-go">Sign in</button>
    <div id="fz-msg" role="status"></div>
    <div class="fz-links"><button type="button" id="fz-toggle">Create an account</button><button type="button" id="fz-forgot">Forgot password?</button></div>
  </form>`;
  document.body.appendChild(box);

  const msg = (t, k) => { const m = $("fz-msg"); m.textContent = t || ""; m.className = k || ""; };
  const setMode = m => {
    mode = m; msg("");
    $("fz-title").textContent = m === "signup" ? "Create an account" : m === "reset" ? "Reset password" : "Sign in";
    $("fz-sub").textContent = m === "signup" ? "The first account becomes the owner. Later accounts are crew (event day only) until the owner changes their role." : m === "reset" ? "We'll email you a link to set a new password." : "Use the email and password for your FRENZO Ledger account.";
    $("fz-name-l").hidden = m !== "signup"; $("fz-pass-l").hidden = m === "reset";
    $("fz-go").textContent = m === "signup" ? "Create account" : m === "reset" ? "Send reset link" : "Sign in";
    $("fz-toggle").textContent = m === "signin" ? "Create an account" : "Back to sign in";
    $("fz-forgot").hidden = m !== "signin";
  };
  $("fz-toggle").addEventListener("click", () => setMode(mode === "signin" ? "signup" : "signin"));
  $("fz-forgot").addEventListener("click", () => setMode("reset"));
  $("fz-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const email = $("fz-email").value.trim(), password = $("fz-pass").value, name = $("fz-name").value.trim();
    if (!email) return msg("Enter your email.", "err");
    $("fz-go").disabled = true;
    try {
      if (mode === "reset") {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: (window.FRENZO_CONFIG || {}).resetRedirect || location.origin });
        if (error) throw error; msg("Check your email for the reset link.", "good");
      } else if (mode === "signup") {
        if (password.length < 6) throw new Error("Password needs at least 6 characters.");
        const { data, error } = await auth.signUp({ email, password, options: { data: { name } } });
        if (error) throw error;
        if (data.session) msg("Account created.", "good");
        else msg("Account created. Check your email to confirm it, then sign in.", "good");
      } else {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) { msg(e.message || "Something went wrong.", "err"); }
    $("fz-go").disabled = false;
  });

  const show = () => { box.hidden = false; setTimeout(() => $("fz-email").focus(), 50); };
  window.addEventListener("frenzo:needlogin", show);
  if (window.frenzoLoginNeeded) show(); // in case the adapter asked before this script loaded
  auth.onAuthStateChange((_e, session) => { if (session) { window.frenzoLoginNeeded = false; box.hidden = true; } });
  // Password recovery links land back in the app with a recovery session: ask for the new password.
  auth.onAuthStateChange(async (event) => {
    if (event !== "PASSWORD_RECOVERY") return;
    const p = prompt("Enter your new password (at least 6 characters):"); if (!p) return;
    const { error } = await auth.updateUser({ password: p }); alert(error ? error.message : "Password updated.");
  });

  // Live-view banner: the app shows the ledger, edits are made in the ledger.
  const addBanner = () => {
    if (!window.claude.readOnly || $("fz-ro")) return;
    const b = document.createElement("div"); b.id = "fz-ro";
    b.innerHTML = `<b>Live view</b> · <span id="fz-asof">loading…</span> · To add or change anything, use the FRENZO Stock Ledger, then ask Claude to sync.`;
    window.claude.use("db").then(db => db.doc("station/appSync").onSnapshot(sn => { const d = sn.exists ? sn.data() : null, el = $("fz-asof"); if (!el) return;
      el.textContent = d && d.syncedAt ? "Data as of " + new Date(d.syncedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "not synced yet"; }, () => { })).catch(() => { });
    const st = $("status"); (st ? st.closest("header") || st.parentElement : document.body).insertAdjacentElement("afterend", b);
    const sb2 = document.createElement("style"); sb2.textContent = `#fz-ro{margin:0 0 14px;padding:9px 12px;border-radius:10px;background:var(--accent-soft,#e3e7fb);color:var(--ink,#171a2b);font-size:13px;line-height:1.4}`; document.head.appendChild(sb2);
    // the status line: say "Live view" instead of "Live · synced"
    const fix = () => { if (st && /Live · synced/.test(st.textContent)) st.textContent = "Live view · synced"; }; fix(); new MutationObserver(fix).observe(st, { childList: true, characterData: true, subtree: true });
  };
  auth.onAuthStateChange((_e, s) => { if (s) addBanner(); });
  auth.getSession().then(({ data }) => { if (data.session) addBanner(); });

  // Sign-out link beside the sync status.
  const addSignOut = () => {
    const st = $("status"); if (!st || $("fz-signout")) return;
    const b = document.createElement("button"); b.id = "fz-signout"; b.type = "button"; b.textContent = "Sign out";
    b.addEventListener("click", () => { if (confirm("Sign out of FRENZO Ledger on this device?")) window.claude.signOut(); });
    st.insertAdjacentElement("afterend", b);
  };
  auth.onAuthStateChange((_e, s) => { if (s) addSignOut(); });
  auth.getSession().then(({ data }) => { if (data.session) addSignOut(); });
})();
