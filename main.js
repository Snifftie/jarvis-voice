/* Jarvis Voice – Alex & Claude. Kein Build nötig (CommonJS).
   Ablauf: Mikrofon (MediaRecorder) → Groq Whisper → KI (Claude, sonst Groq) mit Notizen als Kontext → AKTION-Zeilen ausführen → Antwort anzeigen + vorlesen (Gemini TTS, sonst Systemstimme).
   Schlüssel liegen nur auf diesem Gerät (App-Speicher), nicht im Tresor und nicht auf GitHub. */
const { Plugin, PluginSettingTab, Setting, Notice, requestUrl } = require("obsidian");
const KEYS = ["groq", "claude", "gemini"];
const DEF = { woerter: "", groq: "", claude: "", gemini: "", stimme: "Sulafat", ton: true, ttsModel: "gemini-3.1-flash-tts-preview" };
const STIMMEN = ["Sulafat", "Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr", "Enceladus"];
const SYS = `Du bist JARVIS, der persönliche Assistent von Alex. Du antwortest gesprochen, also natürlich, locker und kurz (meist 1–4 Sätze, keine Listen, keine Tabellen, keine Emojis, keine Überschriften). Deutsch, Du-Form.
Grundlage ist Alex' Wissensspeicher (Notizen unten). Erfinde keine Fakten, Termine, Zahlen oder Aufgaben. Steht etwas nicht in den Notizen, sag das kurz.
Du kannst in den Wissensspeicher schreiben. Hänge dafür ans ENDE eine oder mehrere eigene Zeilen:
AKTION: notiz | <Text>   (Notiz in den Eingang)
AKTION: idee | <Text>    (Idee in den Ideen-Ordner)
AKTION: fokus | <heute|morgen|übermorgen> | <A>; <B>; <C>   (ersetzt den Fokus dieses Tages im Cockpit, höchstens 3 kurze Aufgaben)
AKTION: termin | <Titel> | <Start JJJJ-MM-TTTHH:MM oder JJJJ-MM-TT für ganztägig> | <Dauer in Minuten, Standard 60>   (Google Kalender)
AKTION: erinnerung | <JJJJ-MM-TTTHH:MM> | <Text>   (Jarvis meldet sich genau dann in Telegram – Pop-up und Vibration)
„Erinnere mich …“, „sag mir Bescheid …“ mit Zeitpunkt ist IMMER AKTION erinnerung (nicht notiz), eine Zeile pro Zeitpunkt. Ist die Uhrzeit unklar (z. B. 4:15 nachts statt 14:15), frag nach. Will Alex an einen Termin erinnert werden: Termin eintragen UND Erinnerung setzen.
WICHTIG: Nennt Alex ein Datum oder einen Wochentag zusammen mit einem Vorhaben (z. B. „30.11. Pokern bei Marco, 11.30“, „Mittwoch Zahnarzt 10 Uhr“), ist das IMMER ein Termin → AKTION termin, nicht notiz. Zusatzinfos (z. B. „Pizza mitbringen“) gehören in den Titel. Termine mit Datum/Uhrzeit immer per AKTION termin eintragen; rechne Wochentage vom heutigen Datum aus; fehlt die Uhrzeit, frag nach. Alex' Termine stehen in der Notiz 00-Cockpit/Kalender.md.
Nutze AKTION, wenn Alex etwas plant, sich vornimmt, notieren oder merken will. Übernimm nur, was Alex selbst gesagt hat. Die AKTION-Zeilen werden nicht vorgelesen; sag davor kurz, was du festgehalten hast.
Schreib Titel, Notizen und Erinnerungen immer in korrektem Deutsch: verschluckte oder abgeschnittene Wortenden ergänzen (z. B. „Grundschul-Marklohe“ = „Grundschule Marklohe“), falsche Bindestriche und Großschreibung korrigieren, Füllwörter weglassen, kurz und klar formulieren. Erinnerungstexte ohne Vorsilbe „Erinnerung:“, dafür mit dem Anlass und ggf. Uhrzeit des Termins.
Die Frage kommt oft aus der Spracherkennung und kann Hörfehler enthalten. Korrigiere offensichtliche Fehler anhand der Notizen und der Fachwörter, bevor du antwortest oder etwas notierst (z. B. „Cloud Quote ABI“ = „Claude Code API“, „Bio Office“ = „BioOffice“). Speichere Notizen immer in der korrigierten Schreibweise. Ist etwas wirklich unklar, frag kurz nach.
Keine Kauf-/Verkaufsempfehlungen beim Trading.`;

function stamp() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`; }
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
    const v = { btn, st, out }; this.views.add(v);
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
    const mp = multipart({ model: "whisper-large-v3", language: "de", temperature: "0", response_format: "json", prompt: "Deutsch. Häufige Wörter: Claude, Grundschule Marklohe, Elisa, Klassenbesprechung, Dani, Claude Code, API, API-Schlüssel, Anthropic, Groq, Gemini, Mistral, Obsidian, GitHub, Telegram, Jarvis, Cockpit, BioOffice, Bioladen, Weiling, Shelly, Hyperliquid, Kraken, Trading, MMBM, C2-Bot, TRADEWOOOW, Iggesen, Athen, Kosak, Marklohe, Nienburg, Fokus, Notiz, Idee, Eingang" + (this.cfg.woerter ? ", " + this.cfg.woerter : "") + "." }, { name: "sprache." + ext, type: blob.type.split(";")[0], data: await blob.arrayBuffer() });
    const r = await requestUrl({ url: "https://api.groq.com/openai/v1/audio/transcriptions", method: "POST", headers: { Authorization: "Bearer " + this.cfg.groq }, body: mp.body, contentType: mp.contentType, throw: false });
    if (r.status >= 300) throw new Error("Spracherkennung (Groq " + r.status + "): " + ((r.json && r.json.error && r.json.error.message) || r.text || "").slice(0, 120));
    return String(r.json.text || "").trim();
  }

  async kontext(max = 24000) {
    const files = this.app.vault.getMarkdownFiles(), prio = p => p.startsWith("00-") || p === "Start.md" ? 0 : p.startsWith("90-") ? 2 : 1;
    files.sort((a, b) => prio(a.path) - prio(b.path) || a.path.localeCompare(b.path));
    let out = ""; for (const f of files) { if (out.length > max) break; const t = (await this.app.vault.cachedRead(f)).replace(/<[^>]+>/g, " ").replace(/^---[\s\S]*?---\n/, "").replace(/\n{3,}/g, "\n\n").trim(); if (t) out += `\n\n=== ${f.path} ===\n${t.slice(0, 6000)}`; }
    return out.slice(0, max);
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
    const baue = async max => SYS + `\n\nHeute: ${heute()}.${wx}\nWissensspeicher:${await this.kontext(max)}`;
    const verlauf = this.hist.filter(h => Date.now() - h.t < 30 * 60e3).slice(-4).flatMap(h => [{ role: "user", content: h.q }, { role: "assistant", content: h.a }]);
    const msgs = [...verlauf, { role: "user", content: q }], fehler = [];
    if (this.cfg.claude) {
      const r = await requestUrl({ url: "https://api.anthropic.com/v1/messages", method: "POST", contentType: "application/json", throw: false,
        headers: { "x-api-key": this.cfg.claude, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 600, system: await baue(24000), messages: msgs, temperature: 0.4 }) });
      if (r.status < 300) return { text: r.json.content.filter(x => x.type === "text").map(x => x.text).join("").trim(), via: "Claude" };
      fehler.push("Claude " + r.status); new Notice("Claude-Fehler " + r.status + " – nehme Groq");
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
    throw new Error("Keine KI erreichbar (" + fehler.slice(-4).join(", ") + ").");
  }

  async ask(q, ton) {
    this.ui("Denke nach …", "„" + q + "“", true);
    try {
      const r = await this.ki(q);
      const akts = [...r.text.matchAll(/^\s*AKTION:\s*(notiz|idee|fokus|termin|erinnerung)\s*\|\s*(.+)$/gim)].map(m => [m[1].toLowerCase(), m[2].trim()]);
      let text = r.text.replace(/^\s*AKTION:.*$/gim, "").trim(); const done = [];
      for (const [w, t] of akts) { try { await this.aktion(w, t); done.push(w === "erinnerung" ? "⏰ Erinnerung kommt per Telegram" : w === "termin" ? "📅 Termin geht in ~2 Min. in deinen Kalender" : w === "fokus" ? "🎯 Fokus gesetzt" : w === "idee" ? "💡 Idee gespeichert" : "📥 Notiz im Eingang"); } catch (e) { done.push("⚠️ " + e.message); } }
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
    if (w === "erinnerung") {
      if (!/^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\s*\|\s*\S/.test(t)) throw new Error("Erinnerung ohne Zeitpunkt");
      const ef = v.getAbstractFileByPath("00-Cockpit/Erinnerungen-neu.md"), el = "- " + t.replace(/\n+/g, " ");
      return ef ? v.process(ef, s => s.replace(/\n*$/, "\n") + el + "\n") : v.create("00-Cockpit/Erinnerungen-neu.md", "# Erinnerungs-Warteschlange\n\nDer Telegram-Jarvis holt diese Zeilen ab und meldet sich zur Zeit.\n\n" + el + "\n");
    }
    if (w === "termin") {
      if (!/\|\s*\d{4}-\d{2}-\d{2}/.test(t)) throw new Error("Termin ohne Datum");
      const tf = v.getAbstractFileByPath("00-Cockpit/Termine-neu.md"), zl = "- " + t.replace(/\n+/g, " ");
      return tf ? v.process(tf, s => s.replace(/\n*$/, "\n") + zl + "\n") : v.create("00-Cockpit/Termine-neu.md", "# Termine-Warteschlange\n\n" + zl + "\n");
    }
    const path = w === "idee" ? "60-Ideen/Übersicht.md" : "00-Eingang/Eingang.md", f = v.getAbstractFileByPath(path);
    if (!f) return v.create(path, z + "\n");
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
    if (tag.schicht) kopf.createSpan({ cls: "jt-chip " + (/Früh/.test(tag.schicht) ? "jt-f" : /Spät/.test(tag.schicht) ? "jt-s" : /Nacht/.test(tag.schicht) ? "jt-n" : "jt-grau"), text: tag.schicht });
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
