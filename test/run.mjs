// End-to-end test: the built app (www/index.html) running in jsdom against a fake Supabase
// that enforces the same roles. Covers sign-in, live data, writes, realtime, crew mode, downloads.
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const makeFake = require("./fake-supabase.cjs");
const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
// Inline the app's own scripts (jsdom doesn't fetch src= files); vendor globals are supplied in beforeParse.
const html = fs.readFileSync(path.join(root, "www/index.html"), "utf8")
  .replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => "<script>" + fs.readFileSync(path.join(root, "www", f), "utf8") + "</script>")
  .replace(/<script src="vendor\/[^"]+"><\/script>/g, "");
const seed = JSON.parse(fs.readFileSync(path.join(root, "seed/snapshot.json"), "utf8")).collections;
const wait = ms => new Promise(r => setTimeout(r, ms));
let failures = 0; const ok = (cond, what) => { console.log((cond ? "  ✓ " : "  ✗ ") + what); if (!cond) failures++; };

function boot(users, { noSession = true } = {}) {
  const { createClient, client } = makeFake({ docs: seed, users });
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", resources: undefined, url: "https://app.local/",
    beforeParse(w) {
      w.supabase = { createClient }; w.Element.prototype.scrollIntoView = function () { };
      w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => { }; w.HTMLAnchorElement.prototype.click = function () { w.__downloaded = this.download; };
      w.jspdf = require("jspdf"); w.XLSX = require("xlsx"); w.JSZip = require("jszip");
      w.confirm = () => true; w.alert = () => { }; w.prompt = () => "";
      w.addEventListener("error", e => errors.push(e.message));
    }
  });
  // vendor scripts referenced by src= don't load in jsdom (no resources); the globals above stand in.
  return { dom, w: dom.window, d: dom.window.document, client, errors };
}
const T = (d, s) => (d.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim();
const users = [{ id: "u-owner", email: "joana@example.com", password: "secret123", role: "owner", name: "Joana" },
               { id: "u-crew", email: "crew@example.com", password: "crew1234", role: "crew", name: "Crew" }];

console.log("1. Owner: sign in, live ledger, writes, realtime");
{
  const { d, w, client, errors } = boot(users);
  await wait(300);
  ok(!d.getElementById("fz-login").hidden, "login screen shows when there is no session");
  ok(T(d, "#status").startsWith("Connecting"), "ledger waits for sign-in");
  d.getElementById("fz-email").value = "joana@example.com"; d.getElementById("fz-pass").value = "wrong";
  d.getElementById("fz-form").dispatchEvent(new w.Event("submit", { cancelable: true })); await wait(100);
  ok(/Invalid login/.test(T(d, "#fz-msg")), "wrong password is reported");
  d.getElementById("fz-pass").value = "secret123";
  d.getElementById("fz-form").dispatchEvent(new w.Event("submit", { cancelable: true })); await wait(800);
  ok(d.getElementById("fz-login").hidden, "login screen hides after sign-in");
  ok(T(d, "#status") === "Live · synced", "status is Live · synced (" + T(d, "#status") + ")");
  ok(!!d.getElementById("fz-signout"), "sign-out control added");
  ok(/₱/.test(T(d, "#k-value")) && T(d, "#k-value") !== "₱0", "inventory value rendered: " + T(d, "#k-value"));
  const invCount = d.querySelectorAll("#inv-list .item").length;
  ok(invCount > 0, invCount + " reservation cards rendered");
  // write via UI: put a delivered reservation back to Reserved (delete movement + update invoice)
  d.querySelector('[data-tab="invoices"]').click(); const f = d.getElementById("i-filter"); f.value = "fulfilled"; f.dispatchEvent(new w.Event("change")); await wait(100);
  const n0 = client._log.length;
  d.querySelector('[data-inv-reopen="inv-inv-010-ley"], [data-inv-reopen="inv-010-ley"]').click(); await wait(50);
  d.querySelector('[data-inv-reopen-yes="inv-010-ley"]').click(); await wait(400);
  const wr = client._log.slice(n0);
  ok(wr.some(x => x[0] === "delete" && x[1] === "movements/inv-inv-010-ley"), "stock-out deleted in the database");
  ok(wr.some(x => x[0] === "update" && x[1] === "invoices/inv-010-ley" && x[2].status === "reserved"), "invoice updated via merge_doc");
  ok(client._docs.get("invoices/inv-010-ley").status === "reserved" && client._docs.get("invoices/inv-010-ley").customer === "Kit Ley", "merge kept the other fields");
  // deep merge: tick a packing checkbox
  const ev = client._docs.get("events/ev-ryker-20261212"); const before = JSON.stringify(ev.packed || {});
  await w.claude.use("db").then(db => db.doc("events/ev-ryker-20261212").update({ packed: { "medium_pink": true } }));
  const after = client._docs.get("events/ev-ryker-20261212");
  ok(after.packed.medium_pink === true && after.name === "Ryker's 7th Birthday Party", "nested update merges instead of replacing (" + before + " → " + JSON.stringify(after.packed) + ")");
  // realtime: an external change shows up in the UI
  const nm = "Zed Test " + Date.now();
  client._external("invoices", "inv-rt-test", { invoiceNo: "INV-099", customer: nm, date: "2026-10-20", targetDate: "2026-11-01", status: "reserved", items: [{ product: "duffel", size: "medium", color: "red", qty: 1 }], prices: { "duffel|medium": 680 }, downPayment: 0, costs: {}, extras: [], names: [], packed: {} });
  await wait(300); f.value = "reserved"; f.dispatchEvent(new w.Event("change")); await wait(100);
  ok(T(d, "#inv-list").includes(nm), "realtime insert appears in the list");
  client._externalDelete("invoices", "inv-rt-test"); await wait(300);
  ok(!T(d, "#inv-list").includes(nm), "realtime delete removes it");
  // downloads (web path)
  d.querySelector('[data-doc="invoice"][data-id="inv-002-boac"]').click(); await wait(2500);
  ok(/INV-002/.test(w.__downloaded || ""), "invoice PDF handed to the browser download: " + w.__downloaded);
  // add via collection().add (supplier order quick-tag path)
  const db = await w.claude.use("db"); const r = await db.collection("purchases").add({ supplier: "Test", status: "ordered", items: [] });
  ok(r.id && client._docs.has("purchases/" + r.id), "collection.add creates a doc with a generated id");
  const got = await db.doc("purchases/" + r.id).get(); ok(got.exists && got.data().supplier === "Test", "doc.get reads it back");
  await db.doc("purchases/" + r.id).delete(); ok(!client._docs.has("purchases/" + r.id), "doc.delete removes it");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
}

console.log("2. Crew: sign in → event day only, can log bags, cannot read bookings");
{
  const { d, w, client, errors } = boot(users);
  // open the station for Johanna's event, as the owner's device does when Event day is open
  const ev = seed.events.find(e => e.id === "efdt23rg0eibvy7ovvvy").data, cat = Object.fromEntries(seed.catalog.map(c => [c.id, c.data]));
  client._docs.set("station/current", { eventId: "efdt23rg0eibvy7ovvvy", name: ev.name, date: ev.date, theme: ev.theme, catalog: cat, items: ev.items, extras: [], names: ev.names.map(x => ({ g: "", n: x.n })), shirtSizes: true, updatedAt: Date.now() });
  await wait(300);
  d.getElementById("fz-email").value = "crew@example.com"; d.getElementById("fz-pass").value = "crew1234";
  d.getElementById("fz-form").dispatchEvent(new w.Event("submit", { cancelable: true })); await wait(800);
  ok(d.body.classList.contains("helper") && !d.getElementById("kiosk").hidden, "helper mode: event day screen is shown");
  ok(T(d, "#k-title") === "Ms Johanna Que's Event", "station event loaded: " + T(d, "#k-title"));
  ok(/logged/.test(T(d, "#wrap-live")), "event logs subscribed: " + T(d, "#wrap-live"));
  const db = await w.claude.use("db");
  let denied = false; try { await db.collection("invoices").get(); const sn = await db.collection("invoices").get(); denied = sn.size === 0; } catch (e) { denied = true; }
  ok(denied, "crew cannot read reservations");
  const n0 = client._log.length;
  d.getElementById("wrap-name").value = "Testkid"; d.getElementById("wrap-name").dispatchEvent(new w.Event("input", { bubbles: true }));
  d.querySelector('[data-wcolor="navy"]').click(); await wait(400);
  ok(client._log.slice(n0).some(x => x[0] === "set" && x[1].startsWith("eventLogs/") && x[2].name === "Testkid"), "crew logged a bag (insert allowed)");
  let blocked = false; try { await db.doc("events/ev-ryker-20261212").update({ name: "hacked" }); } catch (e) { blocked = true; }
  ok(blocked && client._docs.get("events/ev-ryker-20261212").name !== "hacked", "crew cannot edit events (RLS)");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
}

console.log("3. Sign-up: first account becomes owner, later ones crew");
{
  const { d, w, client } = boot([]);
  await wait(300);
  d.getElementById("fz-toggle").click();
  d.getElementById("fz-name").value = "Joana"; d.getElementById("fz-email").value = "new@example.com"; d.getElementById("fz-pass").value = "secret123";
  d.getElementById("fz-form").dispatchEvent(new w.Event("submit", { cancelable: true })); await wait(800);
  ok([...client._profiles.values()][0].role === "owner", "first sign-up is the owner");
  ok(T(d, "#status") === "Live · synced", "owner ledger loads after sign-up");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
