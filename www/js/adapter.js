/* FRENZO Ledger — runtime adapter.
   Gives the ledger page the same `window.claude.use(...)` capabilities it had as an artifact
   (db, user, downloads, sample), backed by Supabase and the phone's own file sharing.
   The ledger code itself is unchanged. */
(function () {
  "use strict";
  const cfg = { ...(window.FRENZO_CONFIG || {}) };
  if (cfg.supabaseUrl) cfg.supabaseUrl = String(cfg.supabaseUrl).trim().replace(/\/+$/, "").replace(/\/(rest|auth|storage|functions)\/v1$/, "");
  const sb = window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;
  window.frenzoSupabase = sb;

  // ---------- helpers ----------
  const TABLE = "docs";
  const rid = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const r = new Uint32Array(20); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(r) : r.forEach((_, i) => r[i] = Math.random() * 1e9); for (let i = 0; i < 20; i++) s += a[r[i] % a.length]; return s; };
  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  const err = e => { const m = e && (e.message || e.error_description || e.hint || String(e)); const x = new Error(m || "Database error"); x.code = e && e.code; return x; };
  const deepMerge = (a, b) => { const out = a && typeof a === "object" && !Array.isArray(a) ? { ...a } : {}; for (const [k, v] of Object.entries(b || {})) { if (v && typeof v === "object" && !Array.isArray(v) && v.__delete__ === true) delete out[k]; else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v); else out[k] = v; } return out; };

  // ---------- live cache per collection ----------
  // One realtime channel per collection; every onSnapshot on that collection shares it.
  const colls = {};
  function coll(name) {
    if (colls[name]) return colls[name];
    const C = { name, rows: null, loading: null, listeners: new Set(), channel: null, failed: null };
    C.emit = () => { for (const l of [...C.listeners]) { try { l(); } catch (e) { console.error(e); } } };
    C.load = async () => {
      if (C.rows) return;
      if (!C.loading) C.loading = (async () => {
        const { data, error } = await sb.from(TABLE).select("id,data").eq("collection", name).order("id");
        if (error) throw err(error);
        if (!C.rows) C.rows = new Map(data.map(r => [r.id, r.data || {}]));
        C.subscribe();
      })().catch(e => { C.loading = null; C.failed = e; throw e; });
      return C.loading;
    };
    C.subscribe = () => {
      if (C.channel) return;
      C.channel = sb.channel("docs:" + name)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE, filter: "collection=eq." + name }, p => {
          if (!C.rows) return;
          const row = p.new && p.new.id ? p.new : null, old = p.old && p.old.id ? p.old : null;
          if (p.eventType === "DELETE") { if (old) C.rows.delete(old.id); }
          else if (row) C.rows.set(row.id, row.data || {});
          C.emit();
        })
        .subscribe(status => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { for (const l of C.errListeners || []) l(new Error("Live updates paused")); }
          if (status === "SUBSCRIBED" && C.wasDown) { C.wasDown = false; C.refresh(); }
          if (status !== "SUBSCRIBED") C.wasDown = true;
        });
    };
    // Re-read after a reconnect so nothing that happened while offline is missed.
    C.refresh = async () => { try { const { data, error } = await sb.from(TABLE).select("id,data").eq("collection", name); if (!error && data) { C.rows = new Map(data.map(r => [r.id, r.data || {}])); C.emit(); } } catch (e) { } };
    C.setLocal = (id, data) => { if (C.rows) { C.rows.set(id, data); C.emit(); } };
    C.delLocal = id => { if (C.rows) { C.rows.delete(id); C.emit(); } };
    C.errListeners = [];
    colls[name] = C;
    return C;
  }

  const snapshotOf = (C, filter) => {
    const docs = [];
    for (const [id, data] of C.rows) if (!filter || filter(data)) docs.push({ id, data: () => clone(data), exists: true });
    return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
  };

  function watch(C, onNext, onError, filter) {
    let live = true;
    const fire = () => { if (live && C.rows) onNext(snapshotOf(C, filter)); };
    C.listeners.add(fire);
    if (onError) C.errListeners.push(onError);
    C.load().then(fire).catch(e => { if (onError) onError(e); });
    return () => { live = false; C.listeners.delete(fire); if (onError) C.errListeners = C.errListeners.filter(x => x !== onError); };
  }

  // ---------- db API (what the ledger calls) ----------
  const docRef = (name, id) => {
    const C = coll(name);
    return {
      id,
      get: async () => { const { data, error } = await sb.from(TABLE).select("data").eq("collection", name).eq("id", id).maybeSingle(); if (error) throw err(error); return { id, exists: !!data, data: () => data ? clone(data.data) : undefined }; },
      set: async d => { const { error } = await sb.from(TABLE).upsert({ collection: name, id, data: d }, { onConflict: "collection,id" }); if (error) throw err(error); C.setLocal(id, clone(d)); },
      update: async patch => { const { data, error } = await sb.rpc("merge_doc", { p_collection: name, p_id: id, p_patch: patch }); if (error) throw err(error); C.setLocal(id, data || deepMerge(C.rows && C.rows.get(id), patch)); },
      delete: async () => { const { error } = await sb.from(TABLE).delete().eq("collection", name).eq("id", id); if (error) throw err(error); C.delLocal(id); },
      onSnapshot: (onNext, onError) => watch(C, sn => { const d = C.rows.get(id); onNext({ id, exists: d !== undefined, data: () => clone(d) }); }, onError)
    };
  };
  const collRef = (name, filters = []) => ({
    doc: id => docRef(name, id),
    add: async d => { const id = rid(); await docRef(name, id).set(d); return { id }; },
    where: (field, op, value) => { if (op !== "==") throw new Error("Only == filters are supported"); return collRef(name, [...filters, [field, value]]); },
    get: async () => { const C = coll(name); await C.load(); return snapshotOf(C, filt(filters)); },
    onSnapshot: (onNext, onError) => watch(coll(name), onNext, onError, filt(filters))
  });
  const filt = f => f.length ? d => f.every(([k, v]) => d && d[k] === v) : null;
  const db = { collection: name => collRef(name), doc: path => { const i = path.indexOf("/"); return docRef(path.slice(0, i), path.slice(i + 1)); } };

  // ---------- user ----------
  let profileCache = null;
  async function profile() {
    if (profileCache) return profileCache;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data, error } = await sb.from("profiles").select("id,email,name,role").eq("id", session.user.id).maybeSingle();
    if (error) throw err(error);
    profileCache = data || { id: session.user.id, email: session.user.email, role: "crew" };
    return profileCache;
  }
  const user = { isOwner: async () => (await profile() || {}).role === "owner", profile, signOut: async () => { profileCache = null; await sb.auth.signOut(); location.reload(); } };

  // ---------- downloads (PDFs, Excel, zip) ----------
  const Cap = window.Capacitor, isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const toB64 = buf => { const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const mime = fn => /\.pdf$/i.test(fn) ? "application/pdf" : /\.xlsx$/i.test(fn) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : /\.zip$/i.test(fn) ? "application/zip" : /\.png$/i.test(fn) ? "image/png" : "application/octet-stream";
  const downloads = {
    save: async ({ filename, data }) => {
      const name = String(filename || "file").replace(/[\\/:*?"<>|]/g, "-");
      const plug = n => { try { return Cap.registerPlugin ? Cap.registerPlugin(n) : (Cap.Plugins || {})[n]; } catch (e) { return null; } };
      const Filesystem = isNative ? plug("Filesystem") : null, Share = isNative ? plug("Share") : null;
      if (Filesystem && Share) {
        const w = await Filesystem.writeFile({ path: name, data: toB64(data), directory: "CACHE" });
        await Share.share({ title: name, files: [w.uri] });
        return { status: "saved" };
      }
      const blob = new Blob([data], { type: mime(name) }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: "saved" };
    }
  };

  // ---------- sample (AI order parsing) — optional, via the parse-order edge function ----------
  const sample = cfg.aiParsing === false ? null : {
    limits: async () => ({ images: true }),
    json: async (prompt, opts = {}) => {
      if (opts.signal) opts.signal.addEventListener("abort", () => { }, { once: true });
      const { data: { session } } = await sb.auth.getSession();
      const toDataUrl = f => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
      const raw = opts.images ? (Array.isArray(opts.images) ? opts.images : [opts.images]) : [];
      const images = []; for (const f of raw) images.push(typeof f === "string" ? f : await toDataUrl(f));
      const r = await fetch(cfg.supabaseUrl + "/functions/v1/parse-order", { method: "POST", signal: opts.signal, headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session ? session.access_token : cfg.supabaseAnonKey) }, body: JSON.stringify({ prompt, images }) });
      if (!r.ok) { let code = r.status === 404 || r.status === 503 ? "not_granted" : "refused"; try { code = (await r.json()).error || code; } catch (e) { } const x = new Error("Order reading failed (" + code + ")"); x.code = code; throw x; }
      return r.json();
    }
  };
  // fetch aborts throw AbortError; the ledger expects code "cancelled"
  if (sample) { const j = sample.json; sample.json = async (p, o) => { try { return await j(p, o); } catch (e) { if (e && e.name === "AbortError") { const x = new Error("cancelled"); x.code = "cancelled"; throw x; } throw e; } }; }

  // ---------- sign-in gate ----------
  // `use("db")` resolves only once someone is signed in; the login screen handles that.
  let sessionReady;
  function waitForSession() {
    if (sessionReady) return sessionReady;
    sessionReady = new Promise(async resolve => {
      const { data: { session } } = await sb.auth.getSession();
      if (session) return resolve(session);
      window.frenzoLoginNeeded = true; window.dispatchEvent(new CustomEvent("frenzo:needlogin"));
      const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { if (s) { sub.subscription.unsubscribe(); resolve(s); } });
    });
    return sessionReady;
  }

  window.claude = {
    use: async name => {
      if (!sb) return null;
      if (name === "db") { await waitForSession(); return db; }
      if (name === "user") { await waitForSession(); return user; }
      if (name === "downloads") return downloads;
      if (name === "sample") { await waitForSession(); return (await user.isOwner()) ? sample : null; }
      return null;
    },
    auth: sb ? sb.auth : null,
    signOut: user.signOut
  };
})();
