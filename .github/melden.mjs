// Vergleicht freigaben.json (verschlüsselt) mit dem Stand der letzten Meldung und meldet Petras Änderungen an René.
// Petras Wünsche (Notizen) kommen NICHT in die Meldung, das Repo ist öffentlich. Sie stehen verschlüsselt auf der Seite.
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const gh = (...a) => execFileSync("gh", a, { encoding: "utf8" });
const pw = process.env.SEITEN_PASSWORT, salzText = process.env.SEITEN_SALZ;
if (!pw || !salzText) { console.log("Secrets SEITEN_PASSWORT / SEITEN_SALZ fehlen."); process.exit(1); }

const enc = new TextEncoder();
const basis = await webcrypto.subtle.importKey("raw", enc.encode(pw.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt: Buffer.from(salzText.trim(), "base64"), iterations: 600000, hash: "SHA-256" }, basis, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
const lies = async (ref) => {
  let t; try { t = git("show", `${ref}:freigaben.json`); } catch { return {}; }
  const o = JSON.parse(t);
  const pt = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(o.iv, "base64") }, key, Buffer.from(o.data, "base64"));
  return JSON.parse(new TextDecoder().decode(pt)).items || {};
};

git("fetch", "--force", "origin", "daten", "+refs/tags/*:refs/tags/*");
const neu = await lies("origin/daten");
let gemeldet = true; try { git("rev-parse", "gemeldet"); } catch { gemeldet = false; }
const alt = gemeldet ? await lies("gemeldet") : {};

const TAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const wann = (iso) => { if (!iso) return ""; const d = new Date(iso + "T12:00:00Z"); return `${TAG[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`; };
const zeilen = [];
let frei = 0, ueber = 0, zurueck = 0;
for (const [id, v] of Object.entries(neu)) {
  if (v.by !== "Petra" || JSON.stringify(v) === JSON.stringify(alt[id] || null)) continue;
  const was = v.status === "frei" ? (frei++, "✅ freigegeben") : v.status === "ueber" ? (ueber++, "✏️ zum Überarbeiten markiert" + (v.notiz ? ", mit Wunsch" : "")) : (zurueck++, "↩️ wieder auf „offen“ gesetzt");
  zeilen.push(`- ${wann(v.datum)} · ${v.art || ""} „${v.titel || id}“: ${was}`);
}

if (zeilen.length) {
  const teile = [frei && `${frei} freigegeben`, ueber && `${ueber} zum Überarbeiten`, zurueck && `${zurueck} zurückgenommen`].filter(Boolean);
  const titel = `Petra: ${teile.join(", ")}`;
  const body = `@RnR389 Petra hat auf der Freigabe-Seite gerade Folgendes eingetragen:\n\n${zeilen.sort().join("\n")}\n\n`
    + `Zur Seite: https://rnr389.github.io/borchers/\n\n`
    + `Petras Wünsche stehen verschlüsselt auf der Seite. Claude liest sie mit \`node stand.mjs\` im Ordner 04-freigabe-seite aus.`;
  writeFileSync("/tmp/meldung.md", body);
  const url = gh("issue", "create", "--title", titel, "--body-file", "/tmp/meldung.md").trim();
  console.log("Meldung angelegt: " + url);
  try { gh("issue", "close", url, "--reason", "completed"); } catch (e) { console.log("Schließen nicht geklappt: " + e.message); }
} else {
  console.log("Keine neuen Rückmeldungen von Petra.");
}
git("tag", "-f", "gemeldet", "origin/daten");
git("push", "-f", "origin", "refs/tags/gemeldet");
