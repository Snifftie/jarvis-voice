/* Jarvis Voice – Alex & Claude. Kein Build nötig (CommonJS).
   Ablauf: Mikrofon (MediaRecorder) → Groq Whisper → KI (Claude, sonst Groq) mit Notizen als Kontext → AKTION-Zeilen ausführen → Antwort anzeigen + vorlesen (Gemini TTS, sonst Systemstimme).
   Schlüssel liegen nur auf diesem Gerät (App-Speicher), nicht im Tresor und nicht auf GitHub. */
const { Plugin, PluginSettingTab, Setting, Notice, requestUrl } = require("obsidian");
const KEYS = ["groq", "claude", "gemini"];
const DEF = { woerter: "", groq: "", claude: "", gemini: "", stimme: "Sulafat", ton: true, ttsModel: "gemini-3.1-flash-tts-preview" };
const STIMMEN = ["Sulafat", "Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr", "Enceladus"];
const SI_REGEL = "Schreib ganz am Ende eine eigene Zeile „QUELLEN: <Pfad>; <Pfad>“ mit höchstens 3 Notizen aus dem Kontext, auf die sich deine Antwort wirklich stützt (genau die Pfade aus den === Zeilen). Hast du keine Notiz gebraucht, schreib „QUELLEN: –“.";
const SYS_GRUND = `Du bist JARVIS, der persönliche Assistent von Alex. Du antwortest gesprochen, also natürlich, locker und kurz (meist 1–4 Sätze, keine Listen, keine Tabellen, keine Emojis, keine Überschriften). Deutsch, Du-Form.

Grundsätze:
- Grundlage ist Alex' Wissensspeicher (Notizen unten). Erfinde keine Fakten, Termine, Zahlen oder Aufgaben; steht etwas nicht in den Notizen, sag das kurz.
- Die Frage kommt aus der Spracherkennung und kann Hörfehler enthalten: offensichtliche Fehler anhand der Notizen und Fachwörter korrigieren, bevor du antwortest oder etwas speicherst (z. B. „Cloud Quote ABI“ = „Claude Code API“, „Bio Office“ = „BioOffice“). Ist etwas wirklich unklar, frag kurz nach.
- Keine Kauf-/Verkaufsempfehlungen beim Trading.`;
// Gemeinsame Regeln mit Jarvis (Telegram): Quelle ist 90-Claude/Jarvis-Regeln.md im Tresor (ab 0.5.0). Eingebauter Ersatz, falls die Datei fehlt
// oder ein AKTION-Format fehlt (der Code liest diese Formate ein).
const REGELN = `Speichern: Hänge ans Ende deiner Antwort eigene Zeilen in genau diesem Format (Alex sieht oder hört sie nicht – sag davor kurz in normalen Worten, was du festgehalten hast):
  AKTION: notiz | <Text>   (zeitlose Info in den Eingang)
  AKTION: notizseite | <Thema> | <Text>   (persönliche Sammlung im Ordner Notizen, eine Seite pro Thema, z. B. Elisa Weihnachtsgeschenke | Schachbrett)
  AKTION: idee | <Text>   (Idee in den Ideen-Ordner)
  AKTION: fokus | <heute|morgen|übermorgen> | <A>; <B>; <C>   (ersetzt den Fokus dieses Tages im Cockpit, höchstens 3 kurze Aufgaben)
  AKTION: termin | <Titel> | <Start JJJJ-MM-TTTHH:MM oder JJJJ-MM-TT für ganztägig> | <Dauer in Minuten, Standard 60>   (trägt in Alex' Google Kalender ein)
  AKTION: termin_weg | <JJJJ-MM-TT> | <Titel wie im Kalender>   (Termin löschen – Jarvis fragt vorher in Telegram mit Knopf nach)
  AKTION: termin_verschieben | <bisheriges Datum JJJJ-MM-TT> | <Titel wie im Kalender> | <neuer Start JJJJ-MM-TTTHH:MM oder JJJJ-MM-TT>   (Termin verschieben, Dauer bleibt)
  AKTION: schichten_weg | <von JJJJ-MM-TT> | <bis JJJJ-MM-TT>   (alle Schichten im Zeitraum aus Google löschen – eine Rückfrage per Knopf)
  AKTION: erinnerung | <JJJJ-MM-TT>T<HH:MM> | <Text>   z. B. AKTION: erinnerung | 2026-11-25T17:30 | Elisa bei Sophia abholen   (Jarvis meldet sich genau dann in Telegram)
  AKTION: urlaub | <Alex oder Dani> | <von JJJJ-MM-TT> | <bis JJJJ-MM-TT> | <Urlaub, krank oder frei>   (Abwesenheit – ersetzt die Schichten in „Mein Tag“ und „Wir zwei“)
  AKTION: buch | <Titel – Autor (falls genannt)>   (Buchwunsch auf die Liste Buchwünsche)
  AKTION: wort | <richtig> | <falsch>   (Schreibweise merken)

Was wohin gehört:
- Speichere, wenn Alex etwas plant, sich vornimmt, notieren oder merken will. Übernimm nur, was er selbst gesagt hat, eine Zeile pro Gedanke, nichts doppelt.
- Will Alex einen Termin absagen oder löschen („lösch den Zahnarzt am Mittwoch“, „Pokern fällt aus“) → termin_weg mit Datum und Titel aus Kalender.md; den Titel so nehmen, wie er dort steht. Sag nur, dass du nachfragst – gelöscht ist erst nach seinem Knopfdruck. Will er einen Termin verlegen („Zahnarzt auf Donnerstag 9 Uhr“) → termin_verschieben; fehlt die neue Uhrzeit bei einem Termin mit Uhrzeit, frag nach.
- Termin = Ereignis oder Verabredung zu einer Zeit, oft mit Ort oder anderen Personen („30.11. Pokern bei Marco, 11.30“, „Mittwoch Zahnarzt 10 Uhr“) → termin, Zusatzinfos (z. B. „Pizza mitbringen“) in den Titel. Wochentage vom heutigen Datum aus rechnen. Fehlt bei einem Termin die Uhrzeit, frag nach. Alex' Termine stehen in 00-Cockpit/Kalender.md.
- Aufgabe = etwas, das Alex selbst erledigen muss („muss noch“, „nicht vergessen“, „Freitag Reifen wechseln“) → mit Uhrzeit erinnerung, mit Tag ohne Uhrzeit fokus für diesen Tag (heute/morgen/übermorgen), ohne Tag fokus für heute. Plant er den nächsten Tag, fokus | morgen.
- „Erinnere mich …“, „sag mir Bescheid …“ mit Zeitpunkt → erinnerung, eine Zeile pro Zeitpunkt. Bei unklarer Uhrzeit (z. B. 4:15 nachts statt 14:15) nachfragen. Will Alex an einen Termin erinnert werden: termin und erinnerung. Erinnerungstexte ohne Vorsilbe „Erinnerung:“, dafür mit Anlass und ggf. Uhrzeit.
- Schichten heißen im Kalender „Frühschicht“, „Spätschicht“, „Nachtschicht“. Will Alex Schichten in einem Zeitraum aus dem Kalender entfernen (z. B. wegen Urlaub) → schichten_weg mit von und bis. Trägt er neuen Urlaub ein, fragt Jarvis das automatisch nach – dann kein zusätzliches schichten_weg.
- Urlaub, Krankheit oder freie Tage („Ich habe Urlaub von morgen bis Sonntag“, „Dani ist krank“) → urlaub. Das ist keine Aufgabe und keine Notiz, weil es die Schichtanzeige ersetzt.
- Der Ideen-Ordner ist nur für Ideen zu Projekten, Geschäft, Websites, Jarvis und Produkten. Persönliches (Geschenkideen, Listen, Wünsche, Dinge zu einer Person, Merkzettel) → notizseite mit kurzem Thema; führe eine bestehende Seite aus „Alle Notizen“ weiter, statt eine ähnliche neu anzulegen. Einzelnes ohne Thema → notiz.
- Buchwünsche („Buchwunsch …“, „das Buch will ich lesen …“) → buch, ein Buch pro Zeile, Titel richtig geschrieben, Autor nur wenn genannt. Das Buch wird danach automatisch in einer Bücher-Datenbank geprüft – sag deshalb nur, dass du es prüfst (die Antwort kommt in Telegram), nicht dass es eingetragen ist.
- Korrigiert Alex eine Schreibweise oder einen Namen („Tonies, nicht Tonys“, „ich meinte …“) → wort; damit werden auch die heutigen Einträge korrigiert. Schreibweisen aus dem Wörterbuch übernehmen.
- Schreib Gespeichertes in korrektem Deutsch: abgeschnittene Wortenden ergänzen („Grundschul-Marklohe“ = „Grundschule Marklohe“), Bindestriche und Großschreibung korrigieren, Füllwörter weglassen.`;
const JR_DATEI = "90-Claude/Jarvis-Regeln.md", JR_FORMATE = ["notiz", "notizseite", "idee", "fokus", "termin", "termin_weg", "termin_verschieben", "schichten_weg", "erinnerung", "urlaub", "buch", "wort"];
function jrPruefen(t) { const i = String(t || "").indexOf("## Regeln"); if (i < 0) return null; const r = t.slice(i + 9).trim(); return JR_FORMATE.every(a => r.includes("AKTION: " + a + " |")) ? r : null; }

function stamp() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`; }
// Zeitpunkt einer Erinnerung tolerant lesen → "JJJJ-MM-TTTHH:MM" (Berliner Zeit). Akzeptiert ISO (mit Leerzeichen/Sekunden), 25.11.(2026) 17:30, heute/morgen/übermorgen 17:30, nur 17:30 / 17.30 / 17 Uhr.
// Auch vertauschte Felder (Text | Zeit). Liefert {at, text, morgen:true wenn die Uhrzeit heute schon vorbei war} oder null.
function erLesen(txt, jetzt) {
  const p2 = n => String(n).padStart(2, "0"), teile = String(txt).split("|").map(x => x.trim()).filter(Boolean);
  const berl = new Date((jetzt || new Date()).toLocaleString("en-US", { timeZone: "Europe/Berlin" })), d0 = new Date(berl.getFullYear(), berl.getMonth(), berl.getDate());
  const iso = (d, h, m) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(h)}:${p2(m)}`;
  for (let i = 0; i < teile.length; i++) {
    const s = teile[i].toLowerCase().replace(/\s*uhr\b/g, "").trim(); let m, d = null, h, mi, nurZeit = false;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s]+(\d{1,2})[:.](\d{2})(?::\d{2})?)?$/.exec(s)) && m[4] != null) { d = new Date(+m[1], m[2] - 1, +m[3]); h = +m[4]; mi = +m[5]; }
    else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s*,?\s*(\d{1,2})[:.](\d{2})$/.exec(s))) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : d0.getFullYear(); d = new Date(y, m[2] - 1, +m[1]); h = +m[4]; mi = +m[5]; if (!m[3] && d < d0) d.setFullYear(y + 1); }
    else if ((m = /^(heute|morgen|übermorgen|uebermorgen)\s*,?\s*(?:um\s*)?(\d{1,2})(?:[:.](\d{2}))?$/.exec(s))) { d = new Date(d0); d.setDate(d.getDate() + (m[1] === "heute" ? 0 : m[1] === "morgen" ? 1 : 2)); h = +m[2]; mi = +(m[3] || 0); }
    else if ((m = /^(?:um\s*)?(\d{1,2})(?:[:.](\d{2}))?$/.exec(s)) && (m[2] != null || /uhr/i.test(teile[i]))) { d = new Date(d0); h = +m[1]; mi = +(m[2] || 0); nurZeit = true; }
    if (!d || h > 23 || mi > 59 || isNaN(d)) continue;
    let morgen = false; if (nurZeit && d.getTime() + (h * 60 + mi) * 60e3 <= berl.getTime()) { d.setDate(d.getDate() + 1); morgen = true; }
    const text = teile.filter((_, j) => j !== i).join(" | ").trim(); if (!text) return null;
    return { at: iso(d, h, mi), text, morgen };
  }
  return null;
}
// ---------- Suche (Jarvis 1.2 / Plugin 0.3): Stichwort + Wortstamm + Titel, BM25 über Abschnitte, ohne Zusatzpakete ----------
// Gleicher Code im Telegram-Jarvis und im Obsidian-Plugin. docs = [{p: Pfad, t: Text}]
const SI_STOP = new Set("der die das und oder aber den dem des ein eine einer eines einem einen ist sind war waren wird werden hat haben hatte mit von vom zum zur fur für auf aus bei nach uber über unter vor ich du er sie es wir ihr mein dein sein mir mich dir dich uns euch was wie wer wo wann warum noch schon auch nur nicht kein keine mal bitte sich als wenn dann dass weil hier dort heute morgen gestern sowie etwa".split(" ").map(w => w.normalize("NFD").replace(/[̀-ͯ]/g, "")));
function siWorte(s) { return String(s || "").toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !SI_STOP.has(w)); }
const siStamm = w => w.slice(0, 6);
function siTitel(p) { return String(p).split("/").pop().replace(/\.md$/, ""); }
function siSaeubern(t) { return String(t || "").replace(/^---[\s\S]*?\n---\n/, "").replace(/```[\s\S]*?```/g, " ").replace(/<[^>]+>/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
// Notizen in Abschnitte (an Überschriften, höchstens ~1200 Zeichen)
function siAbschnitte(docs) {
  const out = [];
  for (const d of docs) {
    const t = siSaeubern(d.t); if (!t) continue; let cur = "", h = "";
    const push = () => { if (cur.trim()) out.push({ p: d.p, h, t: cur.trim() }); cur = ""; };
    for (const l of t.split("\n")) { if (/^#{1,4}\s/.test(l) && cur.length > 200) { push(); h = l.replace(/^#+\s*/, ""); } else if (/^#{1,4}\s/.test(l) && !cur.trim()) h = l.replace(/^#+\s*/, ""); if (cur.length + l.length > 1200) push(); cur += l + "\n"; }
    push();
  }
  return out;
}
function siIndex(docs) {
  const ch = siAbschnitte(docs), df = new Map();
  for (const c of ch) {
    const tf = new Map(), add = (w, n) => { const s = siStamm(w); tf.set(s, (tf.get(s) || 0) + n); };
    for (const w of siWorte(c.t)) add(w, 1);
    for (const w of siWorte(siTitel(c.p) + " " + c.h)) add(w, 3); // Titel und Überschrift zählen dreifach
    c.tf = tf; c.len = [...tf.values()].reduce((a, b) => a + b, 0) || 1;
    for (const s of tf.keys()) df.set(s, (df.get(s) || 0) + 1);
  }
  const avg = ch.reduce((a, c) => a + c.len, 0) / (ch.length || 1);
  return { ch, df, avg, n: ch.length, terms: [...df.keys()] };
}
// BM25; Wortanfänge zählen halb (z. B. „buch“ → „buchwu“), ab 4 Buchstaben
function siSuche(ix, q, k = 8) {
  const qs = [...new Set(siWorte(q).map(siStamm))]; if (!qs.length || !ix.n) return [];
  const varianten = qs.map(s => { const v = [[s, 1]]; if (s.length >= 4) for (const t of ix.terms) if (t !== s && (t.startsWith(s) || (t.length >= 4 && s.startsWith(t)))) v.push([t, 0.5]); return v; });
  const K1 = 1.4, B = 0.75, res = [];
  for (const c of ix.ch) {
    let sc = 0, treffer = 0;
    for (const v of varianten) { let best = 0; for (const [t, w] of v) { const f = c.tf.get(t); if (!f) continue; const idf = Math.log(1 + (ix.n - ix.df.get(t) + 0.5) / (ix.df.get(t) + 0.5)); best = Math.max(best, w * idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * c.len / ix.avg))); } if (best) { sc += best; treffer++; } }
    if (sc) res.push({ p: c.p, h: c.h, t: c.t, s: sc * (0.6 + 0.4 * treffer / qs.length) });
  }
  return res.sort((a, b) => b.s - a.s).slice(0, k);
}
// Kontext für die KI: Cockpit immer, dazu Titelliste und die passendsten Abschnitte; liefert auch die Kandidaten für Quellen
function siKontext(docs, q, max = 20000) {
  const kern = docs.filter(d => d.p.startsWith("00-Cockpit/")).map(d => `\n\n=== ${d.p} ===\n${siSaeubern(d.t).slice(0, 2500)}`).join("").slice(0, 6000);
  const titel = "\n\nAlle Notizen: " + docs.map(d => siTitel(d.p)).join(" · ");
  const hits = siSuche(siIndex(docs), q, 12); let teile = "", pfade = [];
  for (const h of hits) { const s = `\n\n=== ${h.p}${h.h ? " › " + h.h : ""} ===\n${h.t}`; if ((kern + titel + teile + s).length > max) break; teile += s; if (!pfade.includes(h.p)) pfade.push(h.p); }
  return { text: kern + titel + "\n\nPassende Stellen (Suche):" + (teile || " keine Treffer"), pfade, n: docs.length };
}
// „QUELLEN: a; b“ aus der Antwort lösen, nur Pfade erlauben, die wirklich im Kontext waren
function siQuellen(text, erlaubt) {
  let q = []; const t = String(text).replace(/^\s*QUELLEN:\s*(.*)$/gim, (_, l) => { q.push(...l.split(/[;,]/).map(x => x.trim().replace(/^\[\[|\]\]$/g, ""))); return ""; }).trim();
  const ok = []; for (const x of q) { const p = erlaubt.find(e => e === x || siTitel(e) === siTitel(x) || e === x + ".md"); if (p && !ok.includes(p)) ok.push(p); }
  return { text: t, quellen: ok.slice(0, 3) };
}

// ---------- Wörterbuch (Jarvis 1.5 / Plugin 0.4): richtige Schreibweisen für die Spracherkennung + automatische Korrektur ----------
// Datei 90-Claude/Wörterbuch.md, Zeilen „- Tonies (nicht: Tonys, Tonis)“. Gleicher Code im Telegram-Jarvis und im Plugin.
const WB_DATEI = "90-Claude/Wörterbuch.md";
const WB_BASIS = "Claude, Grundschule Marklohe, Elisa, Lieschen, Klassenbesprechung, Dani, Claude Code, API, Anthropic, Groq, Obsidian, GitHub, Telegram, Jarvis, Cockpit, BioOffice, Bioladen, Weiling, Shelly, Hyperliquid, Kraken, Trading, MMBM, C2-Bot, TRADEWOOOW, Iggesen, Athen, Kosak, Marklohe, Nienburg, Fokus, Notiz, Idee, Eingang";
const WB_KOPF = "# 📖 Wörterbuch\n\n[[Regeln|← Claude]]\n\nRichtige Schreibweisen für Jarvis' Spracherkennung. Jarvis trägt selbst ein, wenn du ihn korrigierst („Tonies, nicht Tonys“). Du kannst auch selbst Zeilen ergänzen: `- Richtig (nicht: falsch1, falsch2)`\n\n";
function wbLesen(t) {
  const out = [];
  for (const m of String(t || "").matchAll(/^- ([^(\n]+?)\s*(?:\((?:nicht|statt):\s*([^)]*)\))?\s*$/gm)) { const r = m[1].trim(); if (!r || r.length > 40) continue; out.push({ richtig: r, falsch: (m[2] || "").split(",").map(x => x.trim()).filter(x => x && x.toLowerCase() !== r.toLowerCase()) }); }
  return out;
}
function wbEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// falsche Schreibweisen als ganze Wörter ersetzen (Groß/klein egal)
function wbKorrektur(text, wb) {
  let t = String(text || "");
  for (const w of wb) for (const f of w.falsch) t = t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${wbEsc(f)}(?=$|[^\\p{L}\\p{N}])`, "giu"), (_, a) => a + w.richtig);
  return t;
}
function wbPrompt(wb) { const extra = wb.map(w => w.richtig).filter(r => !WB_BASIS.includes(r)); return ("Deutsch. Häufige Wörter: " + WB_BASIS + (extra.length ? ", " + extra.join(", ") : "") + ".").slice(0, 900); }
// Zeile fürs Wörterbuch ergänzen (bestehende Zeile erweitern statt doppelt)
function wbEintragen(t, richtig, falsch) {
  const r = String(richtig || "").trim().slice(0, 40), f = String(falsch || "").split(",").map(x => x.trim()).filter(x => x && x.toLowerCase() !== r.toLowerCase());
  if (!r) return null; let b = t || WB_KOPF; const L = b.split("\n"), i = L.findIndex(l => new RegExp(`^- ${wbEsc(r)}\\s*(\\(|$)`, "i").test(l));
  if (i >= 0) { const alt = wbLesen(L[i])[0] || { falsch: [] }, alle = [...new Set([...alt.falsch, ...f])]; L[i] = `- ${r}${alle.length ? ` (nicht: ${alle.join(", ")})` : ""}`; return L.join("\n"); }
  return b.replace(/\n*$/, "\n") + `- ${r}${f.length ? ` (nicht: ${f.join(", ")})` : ""}\n`;
}
// in Zeilen von heute/gestern (Zeitstempel _(TT.MM. …)_) die falsche Schreibweise nachträglich korrigieren
function wbNachtraeglich(t, wb, jetzt) {
  const d = new Date(new Date(jetzt || Date.now()).toLocaleString("en-US", { timeZone: "Europe/Berlin" })), tage = [0, 1].map(n => { const x = new Date(d.getTime() - n * 864e5); return `${x.getDate()}.${x.getMonth() + 1}.`; });
  let n = 0; const out = String(t || "").split("\n").map(l => { const m = /_\((\d{1,2})\.(\d{1,2})\./.exec(l); if (!m || !tage.includes(`${+m[1]}.${+m[2]}.`)) return l; const k = wbKorrektur(l, wb); if (k !== l) n++; return k; }).join("\n");
  return { t: out, n };
}

// Lernkreislauf (0.2.5): passende Lektionen aus 90-Claude/Lektionen.md (pflegt der Telegram-Jarvis) + Lernfälle an ihn melden
const LF_KORR = /^\s*(nein|ne|nö|falsch|stimmt nicht|nicht richtig|quatsch|so nicht)\b|\b(ich (hab|habe)\b.{0,40}\bgesagt|ich meinte|meinte ich|du hast\b.{0,25}\b(falsch|vergessen|nicht)|warum (hast|machst|verbessert|kommt|ist)|funktioniert nicht|geht nicht|klappt nicht|kacke|immer noch (nicht|falsch|kacke)|nicht gespeichert|nicht eingetragen|hat nicht geklappt)\b/i;
const lfStamm = s => [...new Set(String(s).toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(w => w.slice(0, 5)))];
function lkAusText(t, q, max = 5) {
  const teil = String(t || "").split(/^## /m).find(x => x.startsWith("Aktiv")) || "", a = lfStamm(q), L = [];
  const re = /^- \*\*(L\d+)\*\* · (.+)\n\s+- `([^`]*)` · für (\w+)/gm; let m;
  while ((m = re.exec(teil))) { if (m[4] === "claude") continue; const s = m[3].split(/\s+/).map(x => lfStamm(x)[0] || x.slice(0, 5)).filter(x => a.includes(x)).length; if (s) L.push({ id: m[1], wd: m[2], s }); }
  return L.sort((x, y) => y.s - x.s).slice(0, max);
}
// Nächste 14 Tage mit Wochentag – die KI soll Wochentage nicht selbst ausrechnen (Fehler 27.11.: „Montag“ wurde Samstag)
function tage() { const d = new Date(), p = n => String(n).padStart(2, "0"); return "Kalender ab heute: " + Array.from({ length: 14 }, (_, i) => { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 12); return t.toLocaleString("de-DE", { weekday: "short" }) + ` ${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; }).join(" · "); }
function heute() { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.toLocaleString("de-DE", { weekday: "long" }) + ` ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}, ${p(d.getHours())}:${p(d.getMinutes())} Uhr`; }

function multipart(fields, file) {
  const b = "----jarvis" + Math.random().toString(16).slice(2), enc = new TextEncoder(), parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(enc.encode(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(enc.encode(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(new Uint8Array(file.data)); parts.push(enc.encode(`\r\n--${b}--\r\n`));
  const len = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return { body: out.buffer, contentType: "multipart/form-data; boundary=" + b };
}
function wav(pcm, rate) { // 16-bit mono PCM → WAV
  const h = new ArrayBuffer(44), v = new DataView(h), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length, true);
  return new Blob([h, pcm], { type: "audio/wav" });
}

module.exports = class JarvisVoice extends Plugin {
  async onload() {
    this.cfg = Object.assign({}, DEF, this.app.loadLocalStorage("jarvis-voice-cfg") || {});
    this.hist = []; this.rec = null; this.audio = null; this.views = new Set();
    this.addSettingTab(new JVSettings(this.app, this));
    this.registerMarkdownCodeBlockProcessor("jarvis", (src, el) => this.render(el));
    // „Mein Tag“: Widget über 00-Cockpit/Fokus.md (pflegt der Telegram-Jarvis), zeichnet sich bei jeder Änderung neu
    this.tagViews = new Set(); this.tagSel = null;
    this.registerMarkdownCodeBlockProcessor("jarvis-tag", (src, el) => { const v = new MeinTag(this, el); this.tagViews.add(v); v.draw(); });
    this.registerEvent(this.app.vault.on("modify", f => { if (f.path === FK_DATEI) for (const v of [...this.tagViews]) { if (!v.el.isConnected) this.tagViews.delete(v); else v.draw(); } }));
    this.addRibbonIcon("mic", "Jarvis fragen", () => this.toggle());
    this.addCommand({ id: "jarvis-aufnahme", name: "Sprechen (Start/Stopp)", callback: () => this.toggle() });
  }
  onunload() { this.stopAudio(); try { this.rec && this.rec.stream.getTracks().forEach(t => t.stop()); } catch (e) {} }
  save() { this.app.saveLocalStorage("jarvis-voice-cfg", this.cfg); }

  render(el) {
    const box = el.createDiv({ cls: "jv-box" });
    const btn = box.createEl("button", { cls: "jv-mic", text: "🎙️" });
    const st = box.createDiv({ cls: "jv-status", text: this.cfg.groq ? "Tippen und sprechen" : "Erst Schlüssel eintragen: Einstellungen → Jarvis Voice" });
    const out = box.createDiv({ cls: "jv-out" });
    const row = box.createDiv({ cls: "jv-row" });
    const inp = row.createEl("input", { cls: "jv-input", attr: { type: "text", placeholder: "…oder schreiben" } });
    const send = row.createEl("button", { cls: "jv-send", text: "➤" });
    const src = box.createDiv({ cls: "jv-src" });
    const v = { btn, st, out, src }; this.views.add(v);
    btn.onclick = () => this.toggle();
    const go = () => { const t = inp.value.trim(); if (!t) return; inp.value = ""; this.ask(t, false); };
    send.onclick = go; inp.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    this.register(() => this.views.delete(v));
  }
  ui(status, text, busy) { for (const v of this.views) { if (status != null) v.st.setText(status); if (text != null) v.out.setText(text); v.btn.toggleClass("jv-rec", !!this.rec); v.btn.toggleClass("jv-busy", !!busy); v.btn.setText(this.rec ? "⏹" : busy ? "⏳" : "🎙️"); } }

  async toggle() {
    if (this.rec) return this.rec.stop();
    if (!this.cfg.groq) { new Notice("Jarvis: Groq-Schlüssel fehlt (Einstellungen → Jarvis Voice)"); return this.ui("Groq-Schlüssel fehlt – Einstellungen → Jarvis Voice"); }
    this.stopAudio();
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { return this.ui("⚠️ Kein Mikrofon-Zugriff: " + e.message + " – in den Android-Einstellungen Obsidian das Mikrofon erlauben."); }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 64000 }, mime ? { mimeType: mime } : {})), chunks = [];
    rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); this.rec = null; clearTimeout(this.recT);
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
      if (blob.size < 2000) return this.ui("Zu kurz – nochmal.");
      this.ui("Verstehe …", null, true);
      try { const q = await this.stt(blob); if (!q) return this.ui("Nichts verstanden – nochmal.", null, false); await this.ask(q, true); }
      catch (e) { this.ui("⚠️ " + e.message, null, false); }
    };
    rec.start(); this.rec = rec; this.recT = setTimeout(() => this.rec && this.rec.stop(), 60000);
    this.ui("Ich höre … (nochmal tippen zum Senden)");
  }

  async stt(blob) {
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const mp = multipart({ model: "whisper-large-v3", language: "de", temperature: "0", response_format: "json", prompt: wbPrompt(await this.wb()) + (this.cfg.woerter ? ", " + this.cfg.woerter : "") + "." }, { name: "sprache." + ext, type: blob.type.split(";")[0], data: await blob.arrayBuffer() });
    const r = await requestUrl({ url: "https://api.groq.com/openai/v1/audio/transcriptions", method: "POST", headers: { Authorization: "Bearer " + this.cfg.groq }, body: mp.body, contentType: mp.contentType, throw: false });
    if (r.status >= 300) throw new Error("Spracherkennung (Groq " + r.status + "): " + ((r.json && r.json.error && r.json.error.message) || r.text || "").slice(0, 120));
    return wbKorrektur(String(r.json.text || "").trim(), await this.wb());
  }

  async wb() { try { const f = this.app.vault.getAbstractFileByPath(WB_DATEI); return f ? wbLesen(await this.app.vault.cachedRead(f)) : []; } catch (e) { return []; } }

  async kontext(max = 24000, q) {
    const docs = []; for (const f of this.app.vault.getMarkdownFiles()) { if (f.path.startsWith(".") || f.path === JR_DATEI) continue; try { docs.push({ p: f.path, t: await this.app.vault.cachedRead(f) }); } catch (e) { } }
    const k = siKontext(docs, q || "", max); this.lastPfade = k.pfade; return k.text;
  }

  async wetter() {
    const C = { 0: "klar", 1: "überwiegend klar", 2: "teils bewölkt", 3: "bedeckt", 45: "Nebel", 48: "Reifnebel", 51: "Niesel", 53: "Niesel", 55: "Niesel", 61: "leichter Regen", 63: "Regen", 65: "starker Regen", 71: "leichter Schnee", 73: "Schnee", 75: "starker Schnee", 80: "Regenschauer", 81: "Regenschauer", 82: "heftige Schauer", 85: "Schneeschauer", 86: "Schneeschauer", 95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Gewitter mit Hagel" };
    const r = await requestUrl({ url: "https://api.open-meteo.com/v1/forecast?latitude=52.68&longitude=9.14&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FBerlin&forecast_days=3" });
    const c = r.json.current, d = r.json.daily, t = ["Heute", "Morgen", "Übermorgen"];
    return `Wetter Marklohe (Open-Meteo): jetzt ${Math.round(c.temperature_2m)} °C, gefühlt ${Math.round(c.apparent_temperature)} °C, ${C[c.weather_code] || "?"}, Wind ${Math.round(c.wind_speed_10m)} km/h.\n` +
      d.time.map((_, i) => `${t[i]}: ${Math.round(d.temperature_2m_min[i])} bis ${Math.round(d.temperature_2m_max[i])} °C, ${C[d.weather_code[i]] || "?"}, Regenrisiko ${d.precipitation_probability_max[i]} %`).join("\n");
  }

  async ki(q) {
    let wx = ""; if (/wetter|regen|schnee|sonne|temperatur|grad|warm|kalt|frost|glatt|wind|jacke|schirm|draußen/i.test(q)) { try { wx = "\n\n" + await this.wetter(); } catch (e) { wx = "\n\nWetterdienst gerade nicht erreichbar."; } }
    let lk = ""; try { const f = this.app.vault.getAbstractFileByPath("90-Claude/Lektionen.md"); const L = f ? lkAusText(await this.app.vault.cachedRead(f), q) : []; if (L.length) lk = "\n\nGelernte Lektionen aus früheren Fehlern (Hinweise – die Regeln oben gehen vor):\n" + L.map(l => `- ${l.id}: ${l.wd}`).join("\n"); } catch (e) { }
    try { const wl = await this.wb(); if (wl.length) lk += "\n\nWörterbuch (richtige Schreibweisen): " + wl.map(w => w.richtig).join(", "); } catch (e) { }
    let regeln = REGELN; try { const f = this.app.vault.getAbstractFileByPath(JR_DATEI); const r = f ? jrPruefen(await this.app.vault.cachedRead(f)) : null; if (r) regeln = r; else if (f) new Notice("Jarvis: " + JR_DATEI + " unvollständig – nutze eingebaute Regeln"); } catch (e) { }
    const SYS = SYS_GRUND + "\n\n" + regeln;
    const baue = async max => SYS + lk + `\n\nHeute: ${heute()}.\n${tage()}${wx}\nWissensspeicher:${await this.kontext(max, q)}`;
    const verlauf = this.hist.filter(h => Date.now() - h.t < 30 * 60e3).slice(-4).flatMap(h => [{ role: "user", content: h.q }, { role: "assistant", content: h.a }]);
    const msgs = [...verlauf, { role: "user", content: q }], fehler = [];
    if (this.cfg.claude) {
      const r = await requestUrl({ url: "https://api.anthropic.com/v1/messages", method: "POST", contentType: "application/json", throw: false,
        headers: { "x-api-key": this.cfg.claude, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 4000, output_config: { effort: "low" }, // Claude 5.5 denkt immer mit: Grenze deckt Denken + Antwort
          system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }, { type: "text", text: (await baue(24000)).slice(SYS.length) }], messages: msgs }) }); // Regeln gecacht
      if (r.status < 300) { const t = r.json.content.filter(x => x.type === "text").map(x => x.text).join("").trim(); if (t) return { text: t, via: "Claude" }; fehler.push("Claude leer" + (r.json.stop_reason === "max_tokens" ? " (Grenze)" : "")); } else {
      fehler.push("Claude " + r.status); new Notice("Claude-Fehler " + r.status + " – nehme Groq"); }
    }
    if (!this.cfg.groq) throw new Error("Groq-Schlüssel fehlt (Einstellungen → Jarvis Voice).");
    // Gratis-Stufe von Groq begrenzt Token pro Minute: zu viel Kontext → 413/429. Dann mit weniger Notizen nochmal.
    for (const max of [14000, 6000, 2500]) {
      const sys = await baue(max); let zuGross = false;
      for (const model of ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"]) {
        let r; try { r = await requestUrl({ url: "https://api.groq.com/openai/v1/chat/completions", method: "POST", contentType: "application/json", throw: false,
          headers: { Authorization: "Bearer " + this.cfg.groq }, body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, ...msgs], max_tokens: 700, temperature: 0.4 }) }); }
        catch (e) { fehler.push(model.split("/").pop() + ": " + e.message); continue; }
        let j = null; try { j = r.json; } catch (e) {}
        if (r.status < 300) { const t = String(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim(); if (t) return { text: t, via: "Groq " + model.split("/").pop() }; fehler.push(model.split("/").pop() + ": leer"); continue; }
        const m = String(j && j.error && j.error.message || ""); fehler.push(model.split("/").pop() + " " + r.status);
        if (r.status === 401) throw new Error("Groq-Schlüssel ungültig (401) – in den Einstellungen neu eintragen.");
        if (r.status === 413 || /too large|tokens per minute|TPM|context/i.test(m)) { zuGross = true; break; }
      }
      if (!zuGross) break;
    }
    throw new Error("Keine KI erreichbar (" + fehler.slice(-4).join(", ") + ")." + (this.cfg.claude ? "" : " Tipp: Claude-Schlüssel eintragen (Einstellungen → Jarvis Voice), dann gibt es keine Gratis-Limits mehr."));
  }

  async lernfall(frage, signal) {
    try { const v = this.app.vault, P = "00-Cockpit/Lernfaelle-neu.md", z = "- " + stamp() + " | " + String(frage).replace(/[|\n]+/g, " ").slice(0, 300) + " | " + String(signal).replace(/\n+/g, " ").slice(0, 300), f = v.getAbstractFileByPath(P);
      if (f) await v.process(f, s => s.replace(/\n*$/, "\n") + z + "\n"); else await v.create(P, "# Lernfälle aus Obsidian\n\nDer Telegram-Jarvis holt diese Zeilen ab und denkt nachts darüber nach.\n\n" + z + "\n"); } catch (e) { console.log("Jarvis Lernfall:", e); }
  }

  quellen(L) {
    for (const v of this.views) { v.src.empty(); if (!L || !L.length) continue; v.src.createSpan({ text: "📎 " });
      L.forEach((p, i) => { if (i) v.src.createSpan({ text: " · " }); const a = v.src.createEl("a", { text: siTitel(p), cls: "jv-src-link", href: "#" }); a.onclick = e => { e.preventDefault(); this.app.workspace.openLinkText(p, "", false); }; }); }
  }

  async ask(q, ton) {
    this.quellen([]);
    { const last = this.hist.filter(h => Date.now() - h.t < 30 * 60e3).slice(-1)[0]; if (last && LF_KORR.test(q)) this.lernfall(last.q + " → " + last.a, "Korrektur: " + q); }
    this.ui("Denke nach …", "„" + q + "“", true);
    try {
      const r = await this.ki(q);
      const akts = [...r.text.matchAll(/^\s*AKTION:\s*(notizseite|notiz|idee|fokus|termin_weg|termin_verschieben|termin|schichten_weg|erinnerung|buch|urlaub|wort)\s*\|\s*(.+)$/gim)].map(m => [m[1].toLowerCase(), m[2].trim()]);
      let text = r.text.replace(/^\s*AKTION:.*$/gim, "").trim(); const done = [];
      for (const [w, t] of akts) { try { await this.aktion(w, t); done.push(w === "termin_weg" ? "🗑 Löschen bitte in Telegram bestätigen" : w === "termin_verschieben" ? "📅 Wird in ~2 Min. verschoben – Meldung kommt in Telegram" : w === "schichten_weg" ? "🗑 Schichten löschen bitte in Telegram bestätigen" : w === "buch" ? "📚 Buch wird geprüft – Antwort kommt in Telegram" : w === "erinnerung" ? "⏰ Erinnerung kommt per Telegram" : w === "termin" ? "📅 Termin geht in ~2 Min. in deinen Kalender" : w === "fokus" ? "🎯 Fokus gesetzt" : w === "wort" ? "📖 Schreibweise gemerkt: " + t.split("|")[0].trim() : w === "urlaub" ? "🏖️ Abwesenheit eingetragen – Schichten werden ausgeblendet (dauert bis zu 15 Min.)" : w === "notizseite" ? "🗒️ In Notizen: " + t.split("|")[0].trim() : w === "idee" ? "💡 Idee gespeichert" : "📥 Notiz im Eingang"); } catch (e) { done.push("⚠️ " + e.message); } }
      const fehl = done.filter(x => x.startsWith("⚠️")); if (fehl.length) { text = (text ? text + "\n\n" : "") + fehl.join("\n"); this.lernfall(q, fehl.join(" ")); }
      const sq = siQuellen(text, this.lastPfade || []); text = sq.text; this.quellen(sq.quellen);
      this.hist.push({ q, a: text || "(festgehalten)", t: Date.now() }); if (this.hist.length > 8) this.hist.shift();
      this.ui("v" + this.manifest.version + " · " + r.via + (done.length ? " · " + done.join(" · ") : ""), "„" + q + "“\n\n" + (text || done.join("\n")), false);
      if (ton && this.cfg.ton && text) await this.sprich(text);
    } catch (e) { this.ui("⚠️ " + e.message, null, false); }
  }

  async aktion(w, t) {
    const v = this.app.vault, z = `- ${t.replace(/\n+/g, " ")} _(${stamp()})_`;
    if (w === "fokus") {
      const m = /^\s*(heute|morgen|übermorgen|uebermorgen)\s*[|:]\s*/i.exec(t), off = !m || /^heute$/i.test(m[1]) ? 0 : /^morgen$/i.test(m[1]) ? 1 : 2;
      const items = (m ? t.slice(m[0].length) : t).split(/\s*;\s*/).map(x => x.trim()).filter(Boolean).slice(0, 5); if (!items.length) throw new Error("Fokus ohne Aufgaben");
      const d = new Date(); d.setDate(d.getDate() + off); const k = tagK(d);
      // Aufgaben dieses Tages in Fokus.md ersetzen, Termine (📅) bleiben; fehlt der Tag, wird er angehängt (der Bot sortiert ein)
      return fkAendern(this.app, L => { const h = L.findIndex(l => l.startsWith("## " + k)); const neu = items.map(x => "- [ ] " + x);
        if (h < 0) { L.push("", "## " + k, ...neu); return L; } let b = h + 1; while (b < L.length && !/^#/.test(L[b]) && L[b].trim()) b++;
        const termine = L.slice(h + 1, b).filter(l => l.includes("📅")); L.splice(h + 1, b - h - 1, ...termine, ...neu); return L; });
    }
    if (w === "buch") {
      // Buchwünsche prüft der Telegram-Jarvis (Bücher-Datenbank); Rückfrage und Bestätigung kommen dort
      const txt = t.replace(/\s+/g, " ").trim(); if (!txt) throw new Error("Buch ohne Titel");
      const p = "50-Privat/Buchwünsche-neu.md", bf = v.getAbstractFileByPath(p);
      return bf ? v.process(bf, s => s.replace(/\n*$/, "\n") + "- " + txt + "\n") : v.create(p, "# Buchwunsch-Warteschlange\n\nDer Telegram-Jarvis prüft diese Titel und trägt sie in die Buchwünsche ein.\n\n- " + txt + "\n");
    }
    if (w === "erinnerung") {
      const z = erLesen(t); if (!z) throw new Error("Erinnerung NICHT gespeichert – keine Uhrzeit erkannt. Sag sie bitte noch mal mit Uhrzeit.");
      const ef = v.getAbstractFileByPath("00-Cockpit/Erinnerungen-neu.md"), el = "- " + z.at + " | " + z.text.replace(/\n+/g, " ");
      return ef ? v.process(ef, s => s.replace(/\n*$/, "\n") + el + "\n") : v.create("00-Cockpit/Erinnerungen-neu.md", "# Erinnerungs-Warteschlange\n\nDer Telegram-Jarvis holt diese Zeilen ab und meldet sich zur Zeit.\n\n" + el + "\n");
    }
    if (w === "schichten_weg") { // Jarvis listet die Schichten und fragt in Telegram mit einem Knopf nach
      if (!/^\s*\d{4}-\d{2}-\d{2}/.test(t)) throw new Error("Schichten löschen ohne Datum");
      const P = "00-Cockpit/Termine-weg.md", wf = v.getAbstractFileByPath(P), zl = "- schichten | " + t.replace(/\n+/g, " ");
      return wf ? v.process(wf, s => s.replace(/\n*$/, "\n") + zl + "\n") : v.create(P, "# Termine löschen/verschieben (Warteschlange)\n\nJarvis übernimmt jede Zeile und entfernt sie dann.\n\n" + zl + "\n");
    }
    if (w === "termin_verschieben") { // gleiche Warteschlange wie Löschen; Jarvis verschiebt und meldet in Telegram
      if (!/^\s*\d{4}-\d{2}-\d{2}\s*\|/.test(t)) throw new Error("Verschieben ohne Datum");
      const P = "00-Cockpit/Termine-weg.md", wf = v.getAbstractFileByPath(P), zl = "- verschieben | " + t.replace(/\n+/g, " ");
      return wf ? v.process(wf, s => s.replace(/\n*$/, "\n") + zl + "\n") : v.create(P, "# Termine löschen/verschieben (Warteschlange)\n\nJarvis übernimmt jede Zeile und entfernt sie dann.\n\n" + zl + "\n");
    }
    if (w === "termin_weg") { // Jarvis sucht den Termin und fragt in Telegram mit Knöpfen nach (Löschen ist endgültig)
      if (!/^\s*\d{4}-\d{2}-\d{2}\s*\|/.test(t)) throw new Error("Löschwunsch ohne Datum");
      const P = "00-Cockpit/Termine-weg.md", wf = v.getAbstractFileByPath(P), zl = "- " + t.replace(/\n+/g, " ");
      return wf ? v.process(wf, s => s.replace(/\n*$/, "\n") + zl + "\n") : v.create(P, "# Termine löschen (Warteschlange)\n\nJarvis fragt jede Zeile in Telegram nach und entfernt sie dann.\n\n" + zl + "\n");
    }
    if (w === "termin") {
      if (!/\|\s*\d{4}-\d{2}-\d{2}/.test(t)) throw new Error("Termin ohne Datum");
      const tf = v.getAbstractFileByPath("00-Cockpit/Termine-neu.md"), zl = "- " + t.replace(/\n+/g, " ");
      return tf ? v.process(tf, s => s.replace(/\n*$/, "\n") + zl + "\n") : v.create("00-Cockpit/Termine-neu.md", "# Termine-Warteschlange\n\n" + zl + "\n");
    }
    if (w === "wort") {
      const [r, ...f] = t.split("|").map(x => x.trim()); if (!r) throw new Error("Wort fehlt");
      const wf = v.getAbstractFileByPath(WB_DATEI); if (wf) await v.process(wf, s => wbEintragen(s, r, f.join(",")) || s); else await v.create(WB_DATEI, wbEintragen(null, r, f.join(",")));
      const wl = wbLesen(`- ${r} (nicht: ${f.join(",")})`); if (!wl.length || !wl[0].falsch.length) return;
      for (const p of ["00-Eingang/Eingang.md", "60-Ideen/Übersicht.md", "00-Cockpit/Fokus.md", ...v.getMarkdownFiles().map(x => x.path).filter(x => x.startsWith("80-Notizen/"))]) { const zf = v.getAbstractFileByPath(p); if (zf) await v.process(zf, s => wbNachtraeglich(s, wl).t); }
      return;
    }
    if (w === "urlaub") {
      const [w0, von, b0, a0] = t.split("|").map(x => x.trim()), wer = /dani/i.test(w0) ? "Dani" : "Alex", bis = b0 || von, art = (a0 || "Urlaub").slice(0, 30);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(von || "") || !/^\d{4}-\d{2}-\d{2}$/.test(bis) || bis < von) throw new Error("Abwesenheit braucht Datum von/bis");
      const zz = `- ${wer} · ${von}${bis !== von ? " bis " + bis : ""} · ${art}`, P = "00-Cockpit/Abwesenheit.md", af = v.getAbstractFileByPath(P);
      if (!af) return v.create(P, "# 🏖️ Abwesenheit\n\n[[Start|← Cockpit]]\n\nUrlaub, krank, frei – ersetzt in „Mein Tag“ und „Wir zwei“ die Schichten bzw. Danis Ladentage.\n\n" + zz + "\n");
      return v.process(af, s => s.split("\n").includes(zz) ? s : s.replace(/\n*$/, "\n") + zz + "\n");
    }
    if (w === "notizseite") {
      const [th, ...r] = t.split("|").map(x => x.trim()), thema = th.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60), text = r.join(" | ").replace(/\n+/g, " ").trim();
      if (!thema || !text) throw new Error("Notiz braucht Thema und Text");
      if (!v.getAbstractFileByPath("80-Notizen")) await v.createFolder("80-Notizen").catch(() => { });
      const p = `80-Notizen/${thema}.md`, zz = `- ${text} _(${stamp()})_`, nf = v.getAbstractFileByPath(p);
      if (!nf) { await v.create(p, `[[Übersicht|← Notizen]]\n\n${zz}\n`); const u = v.getAbstractFileByPath("80-Notizen/Übersicht.md");
        if (u) await v.process(u, s => s.includes(`[[${thema}]]`) ? s : s.replace(/\n*$/, "\n") + `- [[${thema}]]\n`); else await v.create("80-Notizen/Übersicht.md", `# 🗒️ Notizen\n\n[[Start|← Cockpit]]\n\nPersönliche Sammlungen – eine Seite pro Thema.\n\n- [[${thema}]]\n`); return; }
      const alt = await v.read(nf), norm = x => String(x).toLowerCase().replace(/_\(.*?\)_/g, "").replace(/^\s*-\s*/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (dpDoppelt(text, alt) || alt.split("\n").some(l => /^\s*- /.test(l) && norm(l) === norm(text))) throw new Error("♻️ Steht schon drin – nicht doppelt gespeichert");
      return v.process(nf, s => s.replace(/\n*(- \s*)?$/, "\n") + zz + "\n");
    }
    const path = w === "idee" ? "60-Ideen/Übersicht.md" : "00-Eingang/Eingang.md", f = v.getAbstractFileByPath(path);
    if (!f) return v.create(path, z + "\n");
    if (dpDoppelt(t, await v.read(f))) throw new Error("♻️ Steht schon drin – nicht doppelt gespeichert");
    return v.process(f, s => s.replace(/\n*(- \s*)?$/, "\n") + z + "\n");
  }

  stopAudio() { try { if (this.audio) { this.audio.pause(); URL.revokeObjectURL(this.audio.src); } } catch (e) {} this.audio = null; try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {} }
  async sprich(text) {
    const clean = text.replace(/[*_`#>]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").slice(0, 1200);
    if (this.cfg.gemini) {
      for (const model of [this.cfg.ttsModel, "gemini-2.5-flash-preview-tts"]) {
        try {
          const r = await requestUrl({ url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, method: "POST", contentType: "application/json", throw: false,
            headers: { "x-goog-api-key": this.cfg.gemini },
            body: JSON.stringify({ contents: [{ parts: [{ text: "Sprich locker, warm und natürlich auf Deutsch, wie ein guter Freund: " + clean }] }],
              generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.cfg.stimme } } } } }) });
          if (r.status >= 300) { if (r.status === 404) continue; throw new Error("Gemini " + r.status + ": " + ((r.json && r.json.error && r.json.error.message) || "").slice(0, 100)); }
          const part = r.json.candidates[0].content.parts.find(p => p.inlineData); if (!part) throw new Error("Gemini: kein Ton");
          const raw = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0)), rate = +((part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1] || 24000);
          this.stopAudio(); this.audio = new Audio(URL.createObjectURL(wav(raw, rate))); await this.audio.play(); return;
        } catch (e) { new Notice("Sprachausgabe: " + e.message); break; }
      }
    }
    if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(clean); u.lang = "de-DE"; speechSynthesis.cancel(); speechSynthesis.speak(u); }
  }
};


/* Dopplungs-Schutz: ≥60 % und mind. 3 gleiche Wortstämme mit einer vorhandenen Zeile → nicht speichern */
const dpWorte = s => new Set(String(s).toLowerCase().replace(/_\(.*?\)_/g, "").replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(w => w.slice(0, 5)));
const dpDoppelt = (neu, text) => { const a = dpWorte(neu); if (a.size < 2) return false; return String(text || "").split("\n").filter(l => /^\s*- /.test(l)).some(l => { const b = dpWorte(l); if (b.size < 2) return false; let n = 0; for (const w of a) if (b.has(w)) n++; return n >= 3 && n / Math.min(a.size, b.size) >= 0.6; }); };

/* ---------- Widget „Mein Tag“ ---------- */
const FK_DATEI = "00-Cockpit/Fokus.md";
const tagK = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function fkAendern(app, fn) {
  let f = app.vault.getAbstractFileByPath(FK_DATEI);
  if (!f) f = await app.vault.create(FK_DATEI, "# 🎯 Fokus-Daten\n");
  return app.vault.process(f, s => fn(s.split("\n")).join("\n"));
}
function fkParse(text) {
  const tage = []; let cur = null;
  text.split("\n").forEach((l, i) => {
    const m = /^##\s+(\d{4}-\d{2}-\d{2})\s*(.*)$/.exec(l);
    if (m) { const p = m[2].split("·").map(x => x.trim()).filter(Boolean); cur = { k: m[1], schicht: p[1] || "", dani: p[2] || "", items: [] }; tage.push(cur); return; }
    if (/^#/.test(l)) { cur = null; return; }
    const t = /^\s*- \[([ xX])\]\s*(.*)$/.exec(l);
    if (cur && t && t[2].trim()) cur.items.push({ line: i, done: t[1] !== " ", txt: t[2].trim() });
  });
  return tage;
}
class MeinTag {
  constructor(plugin, el) { this.p = plugin; this.app = plugin.app; this.el = el; }
  async draw() {
    const f = this.app.vault.getAbstractFileByPath(FK_DATEI), el = this.el; el.empty();
    const card = el.createDiv({ cls: "jt-card" }), head = card.createDiv({ cls: "jt-head" });
    head.createEl("b", { text: "🎯 Mein Tag" }); head.createSpan({ text: "wischen ← →" });
    if (!f) { card.createDiv({ cls: "jt-leer", text: "Noch keine Daten – der Telegram-Jarvis legt sie gleich an." }); return; }
    const heute = tagK(new Date()), tage = fkParse(await this.app.vault.read(f)).filter(t => t.k >= heute).sort((a, b) => a.k.localeCompare(b.k));
    if (!tage.length) { card.createDiv({ cls: "jt-leer", text: "Keine Tage gefunden." }); return; }
    let i = Math.max(0, tage.findIndex(t => t.k === this.p.tagSel)); const tag = tage[i];
    const wahl = n => { if (n < 0 || n >= tage.length) return; this.p.tagSel = tage[n].k; for (const v of this.p.tagViews) if (v.el.isConnected) v.draw(); };
    // Tagesleiste
    const leiste = card.createDiv({ cls: "jt-days" });
    tage.slice(0, 14).forEach((t, n) => {
      const d = new Date(t.k + "T12:00:00"), c = leiste.createDiv({ cls: "jt-d" + (n === i ? " jt-on" : "") });
      c.createSpan({ text: t.k === heute ? "Heute" : d.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "") });
      c.createEl("b", { text: String(d.getDate()) });
      c.createEl("i", { text: t.schicht === "frei" || !t.schicht ? "frei" : t.schicht.split(" ")[0] });
      if (t.items.some(x => x.txt.startsWith("📅") && !x.done)) c.createSpan({ cls: "jt-dot" });
      c.onclick = () => wahl(n);
    });
    setTimeout(() => { const on = leiste.querySelector(".jt-on"); if (on) leiste.scrollLeft = Math.max(0, on.offsetLeft - leiste.offsetLeft - 8); }, 0);
    // Tageskopf
    const kopf = card.createDiv({ cls: "jt-dayhead" }), dd = new Date(tag.k + "T12:00:00");
    kopf.createEl("b", { text: dd.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) });
    if (tag.schicht) kopf.createSpan({ cls: "jt-chip " + (/Früh/.test(tag.schicht) ? "jt-f" : /Spät/.test(tag.schicht) ? "jt-s" : /Nacht/.test(tag.schicht) ? "jt-n" : /🏖️/.test(tag.schicht) ? "jt-u" : "jt-grau"), text: tag.schicht });
    if (tag.dani) kopf.createSpan({ cls: "jt-chip " + (/\?|frei/.test(tag.dani) ? "jt-grau" : "jt-g"), text: tag.dani });
    const termine = tag.items.filter(x => x.txt.startsWith("📅")), aufg = tag.items.filter(x => !x.txt.startsWith("📅"));
    const zeile = (box, x) => {
      const r = box.createDiv({ cls: "jt-row" + (x.done ? " jt-done" : "") }), cb = r.createDiv({ cls: "jt-cb" + (x.done ? " jt-ok" : ""), text: x.done ? "✓" : "" });
      let txt = x.txt.replace(/^📅\s*/, ""); const zt = /^(\d{1,2}:\d{2})\s+(.*)$/.exec(txt);
      if (x.txt.startsWith("📅") && zt) { r.createSpan({ cls: "jt-t", text: zt[1] }); txt = zt[2]; }
      const carry = txt.startsWith("↻ "), sp = r.createSpan({ cls: "jt-x", text: carry ? txt.slice(2) : txt });
      if (carry) sp.createSpan({ cls: "jt-carry", text: " ↻ von gestern" });
      r.onclick = () => this.toggle(x);
    };
    if (termine.length) { card.createDiv({ cls: "jt-sec", text: "Termine" }); termine.forEach(x => zeile(card, x)); }
    card.createDiv({ cls: "jt-sec", text: "Aufgaben" });
    if (aufg.length) aufg.forEach(x => zeile(card, x)); else card.createDiv({ cls: "jt-leer", text: "Noch nichts geplant." });
    // Eingabe
    const add = card.createDiv({ cls: "jt-add" }), inp = add.createEl("input", { type: "text", placeholder: "+ Aufgabe für " + (tag.k === heute ? "heute" : dd.toLocaleDateString("de-DE", { weekday: "long" })) + " …" });
    const btn = add.createEl("button", { text: "＋" }), neu = async () => { const v = inp.value.trim(); if (!v) return; inp.value = ""; await this.add(tag.k, v); };
    btn.onclick = neu; inp.addEventListener("keydown", e => { if (e.key === "Enter") neu(); });
    // Punkte + Vorschau
    const dots = card.createDiv({ cls: "jt-dots" }); tage.slice(0, 7).forEach((t, n) => dots.createEl("i", { cls: n === i ? "jt-on" : "" }));
    const nx = tage[i + 1];
    if (nx) { const t1 = nx.items.find(x => x.txt.startsWith("📅")); card.createDiv({ cls: "jt-next", text: `${i === 0 && tag.k === heute ? "Morgen" : new Date(nx.k + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long" })}: ${nx.schicht || "frei"}${t1 ? " · " + t1.txt.replace(/^📅\s*/, "") : ""}` }); }
    // Wischen
    let x0 = null, y0 = null;
    card.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    card.addEventListener("touchend", e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && !e.target.closest(".jt-days")) wahl(dx < 0 ? i + 1 : i - 1); }, { passive: true });
  }
  async toggle(x) {
    await fkAendern(this.app, L => { let n = x.line; const passt = l => l && l.replace(/^\s*- \[[ xX]\]\s*/, "").trim() === x.txt;
      if (!passt(L[n])) n = L.findIndex(passt); if (n >= 0) L[n] = L[n].replace(/- \[[ xX]\]/, x.done ? "- [ ]" : "- [x]"); return L; });
  }
  async add(k, txt) {
    await fkAendern(this.app, L => { const h = L.findIndex(l => l.startsWith("## " + k)); if (h < 0) { L.push("", "## " + k, "- [ ] " + txt); return L; }
      let b = h + 1; while (b < L.length && /^\s*- \[[ xX]\]/.test(L[b])) b++; L.splice(b, 0, "- [ ] " + txt); return L; });
  }
}

class JVSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl: c } = this, p = this.plugin; c.empty();
    c.createEl("h2", { text: "Jarvis Voice" });
    c.createEl("p", { text: "Die Schlüssel bleiben nur auf diesem Gerät – sie werden nicht in den Tresor oder zu GitHub synchronisiert." });
    const key = (id, name, desc) => new Setting(c).setName(name).setDesc(desc).addText(t => { t.inputEl.type = "password"; t.setPlaceholder("einfügen …").setValue(p.cfg[id]).onChange(v => { p.cfg[id] = v.trim(); p.save(); }); });
    key("groq", "Groq-Schlüssel (Pflicht)", "Spracherkennung und Gratis-KI · console.groq.com · beginnt mit gsk_");
    key("claude", "Claude-Schlüssel (optional)", "Bessere Antworten · console.anthropic.com · beginnt mit sk-ant-");
    key("gemini", "Gemini-Schlüssel (für die Stimme)", "Natürliche Stimme · aistudio.google.com → Get API key");
    new Setting(c).setName("Stimme").setDesc("Gemini-Stimme").addDropdown(d => { STIMMEN.forEach(s => d.addOption(s, s)); d.setValue(p.cfg.stimme).onChange(v => { p.cfg.stimme = v; p.save(); }); })
      .addButton(b => b.setButtonText("Test").onClick(() => p.sprich("Hallo Alex, so klinge ich.")));
    new Setting(c).setName("Eigene Wörter").setDesc("Namen und Fachwörter, die Jarvis oft falsch versteht – mit Komma getrennt").addTextArea(t => t.setPlaceholder("z. B. Dani, Elkershausen, VitaBalance").setValue(p.cfg.woerter).onChange(v => { p.cfg.woerter = v.trim(); p.save(); }));
    new Setting(c).setName("Antwort vorlesen").addToggle(t => t.setValue(p.cfg.ton).onChange(v => { p.cfg.ton = v; p.save(); }));
  }
}
