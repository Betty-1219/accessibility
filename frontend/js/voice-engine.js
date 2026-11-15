(function (global) {
  function VoiceEngine(apiBase, onStateChange) {
    this.apiBase = apiBase || "";
    this.onStateChange = onStateChange || function () {};
    this.language = "en";
    this.muted = false;
    this.isSpeaking = false;
    this.isListening = false;
    this.currentAudio = null;
    this.recognition = null;
    this._mediaRecorder = null;
    this._speechToken = 0;
    this._listenToken = 0;
  }

  VoiceEngine.prototype.setLanguage = function (lang) {
    this.language = lang === "am" ? "am" : "en";
  };

  VoiceEngine.prototype.setMuted = function (muted) {
    this.muted = Boolean(muted);
    if (this.muted) {
      this.stopAll();
    }
  };

  VoiceEngine.prototype.stopSpeaking = function () {
    this._speechToken++;
    this.isSpeaking = false;
    if (global.speechSynthesis) {
      try {
        global.speechSynthesis.cancel();
      } catch (_e) {}
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = "";
      } catch (_e) {}
      this.currentAudio = null;
    }
  };

  VoiceEngine.prototype.stopListening = function () {
    this._listenToken++;
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch (_e) {}
      this.recognition = null;
    }
    if (this._mediaRecorder && this._mediaRecorder.state !== "inactive") {
      try {
        this._mediaRecorder.stop();
      } catch (_e) {}
    }
  };

  VoiceEngine.prototype.stopAll = function () {
    this.stopSpeaking();
    this.stopListening();
    this.onStateChange({ isSpeaking: false, isListening: false });
  };

  VoiceEngine.prototype.playBeep = function (freq, durationMs) {
    if (this.muted) {
      return;
    }
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) {
        return;
      }
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq || 660;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(function () {
        try {
          osc.stop();
          ctx.close();
        } catch (_e) {}
      }, durationMs || 110);
    } catch (_e) {}
  };

  VoiceEngine.prototype.speak = async function (text, langOverride) {
    var lang = langOverride || this.language;
    this.stopListening();
    this.stopSpeaking();
    if (this.muted || !text) {
      return;
    }

    var token = ++this._speechToken;
    this.isSpeaking = true;
    this.onStateChange({ isSpeaking: true, isListening: false });

    try {
      if (lang === "am" && this.apiBase) {
        var ok = await this._speakViaBackend(text, lang, token);
        if (ok || token !== this._speechToken) {
          return;
        }
      }
      await this._speakViaBrowser(text, lang, token);
    } finally {
      if (token === this._speechToken) {
        this.isSpeaking = false;
        this.onStateChange({ isSpeaking: false, isListening: false });
      }
    }
  };

  VoiceEngine.prototype._speakViaBackend = async function (text, language, token) {
    var self = this;
    try {
      var res = await fetch(this.apiBase + "/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text, language: language }),
      });
      if (!res.ok || token !== this._speechToken) {
        return false;
      }
      var blob = await res.blob();
      if (token !== this._speechToken) {
        return false;
      }
      var url = URL.createObjectURL(blob);
      return await new Promise(function (resolve) {
        var audio = new Audio(url);
        self.currentAudio = audio;
        var cleanup = function (ok) {
          URL.revokeObjectURL(url);
          if (self.currentAudio === audio) {
            self.currentAudio = null;
          }
          resolve(ok);
        };
        audio.onended = function () {
          cleanup(true);
        };
        audio.onerror = function () {
          cleanup(false);
        };
        audio.play().catch(function () {
          cleanup(false);
        });
      });
    } catch (_e) {
      return false;
    }
  };

  VoiceEngine.prototype._speakViaBrowser = function (text, language, token) {
    var self = this;
    return new Promise(function (resolve) {
      if (!global.speechSynthesis) {
        resolve();
        return;
      }
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = language === "am" ? "am-ET" : "en-US";
      utter.rate = 0.94;

      var settled = false;
      var finish = function () {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      utter.onend = finish;
      utter.onerror = finish;
      var maxWait = Math.max(4500, Math.min(28000, text.length * 95));
      setTimeout(finish, maxWait);

      if (token !== self._speechToken) {
        finish();
        return;
      }
      global.speechSynthesis.speak(utter);
    });
  };

  VoiceEngine.prototype.listenOnce = async function (langOverride, options) {
    var self = this;
    var lang = langOverride || this.language;
    var opts = options || {};
    var initialWaitMs = opts.initialWaitMs || 12000;
    var trailingSilenceMs = opts.trailingSilenceMs || 2600;

    this.stopListening();
    await new Promise(function (r) {
      setTimeout(r, 650);
    });

    var token = ++this._listenToken;
    var SpeechRec = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SpeechRec) {
      return await this._recordAndTranscribeViaServer(lang, token);
    }

    this.playBeep(700, 110);
    this.isListening = true;
    this.onStateChange({ isSpeaking: false, isListening: true });

    var browserRes = await new Promise(function (resolve) {
      var settled = false;
      var finalChunks = [];
      var latestInterim = "";
      var initialTimer = null;
      var trailingTimer = null;

      var clearTimers = function () {
        if (initialTimer) {
          clearTimeout(initialTimer);
        }
        if (trailingTimer) {
          clearTimeout(trailingTimer);
        }
      };

      var finalize = function (errCode) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        if (self.recognition) {
          try {
            self.recognition.onresult = null;
            self.recognition.onerror = null;
            self.recognition.onend = null;
            self.recognition.stop();
          } catch (_e) {}
          self.recognition = null;
        }
        if (token === self._listenToken) {
          self.isListening = false;
          self.onStateChange({ isSpeaking: false, isListening: false });
        }
        var combined = (finalChunks.join(" ") + " " + latestInterim)
          .replace(/\s+/g, " ")
          .trim();
        resolve({
          transcript: combined,
          error: combined ? null : errCode || "no-speech",
        });
      };

      try {
        var rec = new SpeechRec();
        self.recognition = rec;
        rec.lang = lang === "am" ? "am-ET" : "en-US";
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 3;

        initialTimer = setTimeout(function () {
          finalize("no-speech");
        }, initialWaitMs);

        rec.onresult = function (event) {
          if (initialTimer) {
            clearTimeout(initialTimer);
            initialTimer = null;
          }
          finalChunks = [];
          latestInterim = "";
          for (var i = 0; i < event.results.length; i++) {
            var res = event.results[i];
            var piece = (res[0] && res[0].transcript) || "";
            if (res.isFinal) {
              finalChunks.push(piece.trim());
            } else {
              latestInterim += " " + piece.trim();
            }
          }
          if (trailingTimer) {
            clearTimeout(trailingTimer);
          }
          trailingTimer = setTimeout(function () {
            finalize(null);
          }, trailingSilenceMs);
        };

        rec.onerror = function (event) {
          var err = (event && event.error) || "speech_error";
          if (err === "no-speech" && !settled) {
            return;
          }
          finalize(err);
        };

        rec.onend = function () {
          if (!settled) {
            var hasText = (finalChunks.join(" ") + latestInterim).trim().length > 0;
            if (hasText) {
              finalize(null);
            } else {
              finalize("no-speech");
            }
          }
        };

        rec.start();
      } catch (err) {
        finalize((err && err.message) || "mic_blocked");
      }
    });

    if (
      !browserRes.transcript &&
      (browserRes.error === "language-not-supported" || browserRes.error === "unsupported")
    ) {
      return await this._recordAndTranscribeViaServer(lang, token);
    }
    return browserRes;
  };

  VoiceEngine.prototype._recordAndTranscribeViaServer = async function (language, token) {
    var self = this;
    if (!this.apiBase || !global.navigator || !global.navigator.mediaDevices || !global.MediaRecorder) {
      return { transcript: "", error: "unsupported" };
    }
    try {
      var stream = await global.navigator.mediaDevices.getUserMedia({ audio: true });
      this.playBeep(700, 110);
      this.isListening = true;
      this.onStateChange({ isSpeaking: false, isListening: true });

      var chunks = [];
      var recorder = new global.MediaRecorder(stream);
      this._mediaRecorder = recorder;

      return await new Promise(function (resolve) {
        recorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };
        recorder.onstop = async function () {
          stream.getTracks().forEach(function (tr) {
            tr.stop();
          });
          if (token === self._listenToken) {
            self.isListening = false;
            self.onStateChange({ isSpeaking: false, isListening: false });
          }
          try {
            var blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            var fd = new FormData();
            fd.append("file", blob, "voice.webm");
            fd.append("language", language);
            var res = await fetch(self.apiBase + "/voice/stt", { method: "POST", body: fd });
            if (!res.ok) {
              resolve({ transcript: "", error: "stt_unavailable" });
              return;
            }
            var json = await res.json();
            resolve({ transcript: (json.transcript || "").trim(), error: null });
          } catch (_e) {
            resolve({ transcript: "", error: "stt_failed" });
          }
        };
        recorder.start();
        setTimeout(function () {
          if (recorder.state !== "inactive") {
            recorder.stop();
          }
        }, 5500);
      });
    } catch (_e) {
      return { transcript: "", error: "not-allowed" };
    }
  };

  var LETTER_HOMOPHONES = {
    a: "A", ay: "A", eh: "A", alpha: "A",
    b: "B", be: "B", bee: "B", bravo: "B",
    c: "C", see: "C", sea: "C", charlie: "C",
    d: "D", dee: "D", delta: "D",
    e: "E", echo: "E",
    f: "F", ef: "F", foxtrot: "F",
    g: "G", gee: "G", golf: "G",
    h: "H", aitch: "H", hotel: "H",
    i: "I", eye: "I", india: "I",
    j: "J", jay: "J", juliet: "J",
    k: "K", kay: "K", okay: "K", kilo: "K",
    l: "L", el: "L", lima: "L",
    m: "M", em: "M", mike: "M",
    n: "N", en: "N", november: "N",
    o: "O", oh: "O", oscar: "O",
    p: "P", pea: "P", pee: "P", papa: "P",
    q: "Q", cue: "Q", queue: "Q", quebec: "Q",
    r: "R", are: "R", romeo: "R",
    s: "S", es: "S", sierra: "S",
    t: "T", tea: "T", tee: "T", tango: "T",
    u: "U", you: "U", uniform: "U",
    v: "V", vee: "V", victor: "V",
    w: "W", doubleu: "W", whiskey: "W",
    x: "X", ex: "X", xray: "X",
    y: "Y", why: "Y", yankee: "Y",
    z: "Z", zee: "Z", zed: "Z", zulu: "Z",
  };

  function norm(s) {
    return (s || "").toLowerCase().replace(/[.,!?'"`]/g, " ").replace(/\s+/g, " ").trim();
  }

  function isYes(text) {
    var n = norm(text);
    var words = [
      "yes", "yeah", "yep", "correct", "right", "confirm", "ok", "okay", "sure", "true", "continue",
      "አዎ", "አወ", "ትክክል", "ትክክል ነው", "እሺ", "awo", "ishi", "tikikil",
    ];
    return words.some(function (k) {
      return n === k || n.split(" ").indexOf(k) !== -1;
    });
  }

  function isNo(text) {
    var n = norm(text);
    var words = [
      "no", "nope", "wrong", "incorrect", "not correct", "spell", "change", "retry", "redo",
      "አይ", "አይደለም", "ስህተት", "ፊደል", "ቀይር", "ay", "aydelem", "sihtet",
    ];
    return words.some(function (k) {
      return n === k || n.split(" ").indexOf(k) !== -1 || n.indexOf(k) !== -1;
    });
  }

  function isSubmitCommand(text) {
    var n = norm(text);
    var triggers = [
      "submit", "finish", "complete", "register", "done", "send", "confirm and submit",
      "ላክ", "አስገባ", "መዝግብ", "መዝግበኝ", "ጨርስ", "ጨርሻለሁ", "አጠናቅቅ",
      "lak", "asgeba", "mezgib", "cheris", "cherishalehu",
    ];
    return triggers.some(function (k) {
      return n === k || n.split(" ").indexOf(k) !== -1 || n.indexOf(k) !== -1;
    });
  }

  function parseSpelledSegment(text, currentBuffer) {
    var raw = (text || "").trim();
    var buffer = currentBuffer || "";
    var finished = false;

    raw = raw
      .replace(/\bdouble\s+(u|you)\b/gi, "doubleu")
      .replace(/\b([a-zA-Z])\s+(?:as\s+in|for|like)\s+[a-zA-Z]+\b/gi, "$1")
      .replace(/[.,]/g, " ");

    var finishWords = [
      "done", "down", "don", "dan", "dunn", "finish", "finished", "complete",
      "confirm", "yes", "ok", "okay", "ready", "ጨርሻለሁ", "ጨርስ", "አልቋል", "በቃ", "አዎ", "እሺ",
    ];

    var tokens = raw.split(/\s+/).filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var low = tok.toLowerCase();

      if (finishWords.indexOf(low) !== -1) {
        if (low === "okay" && tokens.length > 1 && i < tokens.length - 1) {
          buffer += "K";
          continue;
        }
        finished = true;
        break;
      }
      if (["clear", "restart", "እንደገና"].indexOf(low) !== -1) {
        buffer = "";
        continue;
      }
      if (["backspace", "delete", "undo", "አጥፋ"].indexOf(low) !== -1) {
        buffer = buffer.slice(0, -1);
        continue;
      }
      if (["space", "blank", "next", "ክፍተት"].indexOf(low) !== -1) {
        if (buffer.slice(-1) !== " ") {
          buffer += " ";
        }
        continue;
      }
      if (LETTER_HOMOPHONES[low]) {
        buffer += LETTER_HOMOPHONES[low];
        continue;
      }
      if (/^[a-zA-Z]$/.test(tok)) {
        buffer += tok.toUpperCase();
      } else if (/^[\u1200-\u137F]+$/.test(tok)) {
        buffer += tok;
      } else if (/^[a-zA-Z]{2,}$/.test(tok)) {
        buffer += (buffer && buffer.slice(-1) !== " " ? " " : "") + tok.toUpperCase();
      }
    }

    buffer = buffer.replace(/\s+/g, " ").replace(/^\s+/, "");
    if (buffer.replace(/\s+/g, "").length >= 2) {
      finished = true;
    }
    return { buffer: buffer, finished: finished };
  }

  function formatTitleCase(name) {
    return (name || "")
      .trim()
      .split(/\s+/)
      .map(function (w) {
        return /^[a-zA-Z]+$/.test(w)
          ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
          : w;
      })
      .join(" ");
  }

  function normalizeContact(text) {
    var raw = (text || "").trim();
    if (/\bat\b/i.test(raw) || /\bdot\b/i.test(raw)) {
      return raw
        .replace(/\s+at\s+/gi, "@")
        .replace(/\s+dot\s+/gi, ".")
        .replace(/\s+underscore\s+/gi, "_")
        .replace(/\s+/g, "");
    }
    var digits = parseDigits(raw);
    return digits.length >= 7 ? digits : raw.replace(/\s+/g, "");
  }

  function parseDigits(text) {
    var wordMap = {
      "zero": "0", "oh": "0", "o": "0", "ዜሮ": "0",
      "one": "1", "won": "1", "አንድ": "1",
      "two": "2", "to": "2", "too": "2", "ሁለት": "2",
      "three": "3", "ሶስት": "3",
      "four": "4", "for": "4", "አራት": "4",
      "five": "5", "አምስት": "5",
      "six": "6", "ስድስት": "6",
      "seven": "7", "ሰባት": "7",
      "eight": "8", "ስምንት": "8",
      "nine": "9", "ዘጠኝ": "9",
    };
    var tokens = norm(text).split(" ");
    var out = "";
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (/^\d+$/.test(tok)) {
        out += tok;
      } else if (wordMap[tok] !== undefined) {
        out += wordMap[tok];
      }
    }
    return out;
  }

  global.DigitalBridgeVoice = {
    VoiceEngine: VoiceEngine,
    isYes: isYes,
    isNo: isNo,
    isSubmitCommand: isSubmitCommand,
    parseSpelledSegment: parseSpelledSegment,
    formatTitleCase: formatTitleCase,
    normalizeContact: normalizeContact,
    parseDigits: parseDigits,
    norm: norm,
  };
})(window);