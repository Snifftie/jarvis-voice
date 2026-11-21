/* Jarvis Voice – Alex & Claude. Kein Build nötig (CommonJS).
   Ablauf: Mikrofon (MediaRecorder) → Groq Whisper → KI (Claude, sonst Groq) mit Notizen als Kontext → AKTION-Zeilen ausführen → Antwort anzeigen + vorlesen (Gemini TTS, sonst Systemstimme).
   Schlüssel liegen nur auf diesem Gerät (App-Speicher), nicht im Tresor und nicht auf GitHub. */
const { Plugin, PluginSettingTab, Setting, Notice, requestUrl } = require("obsidian");
const KEYS = ["groq", "claude", "gemini"];
const DEF = { groq: "", claude: "", gemini: "", stimme: "Sulafat", ton: true, ttsModel: "gemini-3.1-flash-tts-preview" };
const STIMMEN = ["Sulafat", "Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr", "Enceladus"];
const SYS = `Du bist JARVIS, der persönliche Assistent von Alex. Du antwortest gesprochen, also natürlich, locker und kurz (meist 1–4 Sätze, keine Listen, keine Tabellen, keine Emojis, keine Überschriften). Deutsch, Du-Form.
Grundlage ist Alex' Wissensspeicher (Notizen unten). Erfinde keine Fakten, Termine, Zahlen oder Aufgaben. Steht etwas nicht in den Notizen, sag das kurz.
Du kannst in den Wissensspeicher schreiben. Hänge dafür ans ENDE eine oder mehrere eigene Zeilen:
AKTION: notiz | <Text>   (Notiz/Erinnerung in den Eingang)
AKTION: idee | <Text>    (Idee in den Ideen-Ordner)
AKTION: fokus | <A>; <B>; <C>   (ersetzt „Heute im Fokus“, höchstens 3 kurze Aufgaben)
Nutze AKTION, wenn Alex etwas plant, sich vornimmt, notieren oder merken will. Übernimm nur, was Alex selbst gesagt hat. Die AKTION-Zeilen werden nicht vorgelesen; sag davor kurz, was du festgehalten hast.
Keine Kauf-/Verkaufsempfehlungen beim Trading.`;

function stamp() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`; }
function heute() { return new Date().toLocaleString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }

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
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { return this.ui("⚠️ Kein Mikrofon-Zugriff: " + e.message + " – in den Android-Einstellungen Obsidian das Mikrofon erlauben."); }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [];
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
    const mp = multipart({ model: "whisper-large-v3-turbo", language: "de", response_format: "json" }, { name: "sprache." + ext, type: blob.type.split(";")[0], data: await blob.arrayBuffer() });
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

  async ki(q) {
    const ctx = await this.kontext(), sys = SYS + `\n\nHeute: ${heute()}.\nWissensspeicher:${ctx}`;
    const verlauf = this.hist.filter(h => Date.now() - h.t < 30 * 60e3).slice(-4).flatMap(h => [{ role: "user", content: h.q }, { role: "assistant", content: h.a }]);
    const msgs = [...verlauf, { role: "user", content: q }];
    if (this.cfg.claude) {
      const r = await requestUrl({ url: "https://api.anthropic.com/v1/messages", method: "POST", contentType: "application/json", throw: false,
        headers: { "x-api-key": this.cfg.claude, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 600, system: sys, messages: msgs, temperature: 0.4 }) });
      if (r.status < 300) return { text: r.json.content.filter(x => x.type === "text").map(x => x.text).join("").trim(), via: "Claude" };
      new Notice("Claude-Fehler " + r.status + " – nehme Groq");
    }
    for (const model of ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"]) {
      const r = await requestUrl({ url: "https://api.groq.com/openai/v1/chat/completions", method: "POST", contentType: "application/json", throw: false,
        headers: { Authorization: "Bearer " + this.cfg.groq }, body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, ...msgs], max_tokens: 700, temperature: 0.4 }) });
      if (r.status < 300) { const t = String(r.json.choices[0].message.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim(); if (t) return { text: t, via: "Groq " + model.split("/").pop() }; }
    }
    throw new Error("Keine KI erreichbar (Groq/Claude).");
  }

  async ask(q, ton) {
    this.ui("Denke nach …", "„" + q + "“", true);
    try {
      const r = await this.ki(q);
      const akts = [...r.text.matchAll(/^\s*AKTION:\s*(notiz|idee|fokus)\s*\|\s*(.+)$/gim)].map(m => [m[1].toLowerCase(), m[2].trim()]);
      let text = r.text.replace(/^\s*AKTION:.*$/gim, "").trim(); const done = [];
      for (const [w, t] of akts) { try { await this.aktion(w, t); done.push(w === "fokus" ? "🎯 Fokus gesetzt" : w === "idee" ? "💡 Idee gespeichert" : "📥 Notiz im Eingang"); } catch (e) { done.push("⚠️ " + e.message); } }
      this.hist.push({ q, a: text || "(festgehalten)", t: Date.now() }); if (this.hist.length > 8) this.hist.shift();
      this.ui(r.via + (done.length ? " · " + done.join(" · ") : ""), "„" + q + "“\n\n" + (text || done.join("\n")), false);
      if (ton && this.cfg.ton && text) await this.sprich(text);
    } catch (e) { this.ui("⚠️ " + e.message, null, false); }
  }

  async aktion(w, t) {
    const v = this.app.vault, z = `- ${t.replace(/\n+/g, " ")} _(${stamp()})_`;
    if (w === "fokus") {
      const f = v.getAbstractFileByPath("Start.md"); if (!f) throw new Error("Start.md fehlt");
      return v.process(f, s => { const L = s.split("\n"), h = L.findIndex(l => /^##\s.*Fokus/i.test(l)); if (h < 0) return s; let a = h + 1; while (a < L.length && !L[a].trim()) a++; let b = a; while (b < L.length && /^\s*- \[[ xX]\]/.test(L[b])) b++;
        const neu = t.split(/\s*;\s*/).filter(Boolean).slice(0, 5).map(x => `- [ ] ${x}`); while (neu.length < 3) neu.push("- [ ] "); L.splice(a, b - a, ...neu); return L.join("\n"); });
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
    new Setting(c).setName("Antwort vorlesen").addToggle(t => t.setValue(p.cfg.ton).onChange(v => { p.cfg.ton = v; p.save(); }));
  }
}
