// A small in-memory stand-in for supabase-js, covering exactly what adapter.js uses:
// auth (email/password), from("docs"/"profiles") queries, rpc("merge_doc"), realtime channels.
// It also applies the same row-level rules as the real database so the crew flow can be tested.
module.exports = function makeFakeSupabase(seed = {}) {
  const docs = new Map(); // key "collection/id" -> data
  for (const [c, rows] of Object.entries(seed.docs || {})) for (const r of rows) docs.set(c + "/" + r.id, JSON.parse(JSON.stringify(r.data)));
  const users = seed.users || []; // {id,email,password,role,name}
  const profiles = new Map(users.map(u => [u.id, { id: u.id, email: u.email, name: u.name || "", role: u.role }]));
  const log = [];
  let session = null;
  const authListeners = new Set();
  const channels = new Set();

  const role = () => session ? (profiles.get(session.user.id) || {}).role : null;
  const canRead = c => role() === "owner" || (role() === "crew" && (c === "station" || c === "eventLogs"));
  const canWrite = c => role() === "owner" || (role() === "crew" && c === "eventLogs");
  const deepMerge = (a, b) => { const out = a && typeof a === "object" && !Array.isArray(a) ? { ...a } : {}; for (const [k, v] of Object.entries(b || {})) { if (v && typeof v === "object" && !Array.isArray(v) && v.__delete__ === true) delete out[k]; else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v); else out[k] = v; } return out; };

  const broadcast = (eventType, collection, id, data, old) => {
    for (const ch of channels) for (const h of ch.handlers) {
      if (h.filter && h.filter !== "collection=eq." + collection) continue;
      if (!canRead(collection)) continue;
      setTimeout(() => h.cb({ eventType, new: eventType === "DELETE" ? {} : { collection, id, data }, old: eventType === "DELETE" ? { collection, id, data: old } : {} }), 0);
    }
  };

  function builder(table) {
    const q = { table, filters: [], op: "select", single: false, payload: null };
    const run = async () => {
      if (table === "profiles") {
        if (!session) return { data: null, error: { message: "not signed in" } };
        let rows = [...profiles.values()].filter(p => role() === "owner" || p.id === session.user.id);
        for (const [k, v] of q.filters) rows = rows.filter(r => r[k] === v);
        return { data: q.single ? (rows[0] || null) : rows, error: null };
      }
      if (table !== "docs") return { data: null, error: { message: "unknown table " + table } };
      if (!session) return { data: null, error: { message: "JWT expired or missing", code: "401" } };
      const get = k => q.filters.find(f => f[0] === k)?.[1];
      if (q.op === "select") {
        let rows = [...docs.entries()].map(([key, data]) => { const i = key.indexOf("/"); return { collection: key.slice(0, i), id: key.slice(i + 1), data }; });
        for (const [k, v] of q.filters) rows = rows.filter(r => r[k] === v);
        rows = rows.filter(r => canRead(r.collection)).sort((a, b) => a.id.localeCompare(b.id));
        const out = rows.map(r => ({ id: r.id, data: JSON.parse(JSON.stringify(r.data)) }));
        return { data: q.single ? (out[0] || null) : out, error: null };
      }
      if (q.op === "upsert") {
        const { collection, id, data } = q.payload;
        if (!canWrite(collection)) return { data: null, error: { message: "new row violates row-level security policy for table \"docs\"", code: "42501" } };
        const existed = docs.has(collection + "/" + id);
        docs.set(collection + "/" + id, JSON.parse(JSON.stringify(data))); log.push(["set", collection + "/" + id, data]);
        broadcast(existed ? "UPDATE" : "INSERT", collection, id, data);
        return { data: null, error: null };
      }
      if (q.op === "delete") {
        const collection = get("collection"), id = get("id");
        if (!canWrite(collection)) return { data: null, error: { message: "row-level security", code: "42501" } };
        const old = docs.get(collection + "/" + id); docs.delete(collection + "/" + id); log.push(["delete", collection + "/" + id]);
        if (old !== undefined) broadcast("DELETE", collection, id, null, old);
        return { data: null, error: null };
      }
      return { data: null, error: { message: "unsupported" } };
    };
    const api = {
      select() { q.op = "select"; return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      order() { return api; },
      maybeSingle() { q.single = true; return api; },
      single() { q.single = true; return api; },
      upsert(row) { q.op = "upsert"; q.payload = row; return api; },
      delete() { q.op = "delete"; return api; },
      then(res, rej) { return run().then(res, rej); }
    };
    return api;
  }

  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: cb => { authListeners.add(cb); return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } }; },
      signInWithPassword: async ({ email, password }) => {
        const u = users.find(x => x.email === email && x.password === password);
        if (!u) return { data: {}, error: { message: "Invalid login credentials" } };
        session = { user: { id: u.id, email }, access_token: "tok-" + u.id };
        for (const cb of [...authListeners]) cb("SIGNED_IN", session);
        return { data: { session }, error: null };
      },
      signUp: async ({ email, password, options }) => {
        const id = "u" + (users.length + 1), r = [...profiles.values()].some(p => p.role === "owner") ? "crew" : "owner";
        users.push({ id, email, password, role: r, name: options?.data?.name || "" }); profiles.set(id, { id, email, name: options?.data?.name || "", role: r });
        session = { user: { id, email }, access_token: "tok-" + id }; for (const cb of [...authListeners]) cb("SIGNED_IN", session);
        return { data: { session, user: { id } }, error: null };
      },
      signOut: async () => { session = null; for (const cb of [...authListeners]) cb("SIGNED_OUT", null); return { error: null }; },
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null })
    },
    from: builder,
    rpc: async (name, args) => {
      if (name !== "merge_doc") return { data: null, error: { message: "no such function" } };
      const key = args.p_collection + "/" + args.p_id;
      if (!session || !canWrite(args.p_collection)) return { data: null, error: { message: "row-level security", code: "42501" } };
      const merged = deepMerge(docs.get(key) || {}, args.p_patch); const existed = docs.has(key);
      docs.set(key, merged); log.push(["update", key, args.p_patch]);
      broadcast(existed ? "UPDATE" : "INSERT", args.p_collection, args.p_id, merged);
      return { data: JSON.parse(JSON.stringify(merged)), error: null };
    },
    channel: name => { const ch = { name, handlers: [], on(_t, opts, cb) { ch.handlers.push({ filter: opts.filter, cb }); return ch; }, subscribe(cb) { channels.add(ch); setTimeout(() => cb && cb("SUBSCRIBED"), 0); return ch; } }; return ch; },
    removeChannel: ch => channels.delete(ch),
    // test hooks
    _docs: docs, _log: log, _profiles: profiles,
    _external: (collection, id, data) => { const existed = docs.has(collection + "/" + id); docs.set(collection + "/" + id, data); broadcast(existed ? "UPDATE" : "INSERT", collection, id, data); },
    _externalDelete: (collection, id) => { const old = docs.get(collection + "/" + id); docs.delete(collection + "/" + id); broadcast("DELETE", collection, id, null, old); }
  };
  return { createClient: () => client, client };
};
