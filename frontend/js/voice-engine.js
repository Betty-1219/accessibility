class DigitalBridgeVoiceEngine {
  constructor() {
    this.synth = window.speechSynthesis || null;
    this.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    this.ttsEnabled = false;
    this.lang = "en";
    this.apiBase = "http://localhost:8000/api/v1";

    this.recognition = null;
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.audioChunks = [];
    this.currentAudio = null;
    this._stopActiveListening = null;
  }

  setLanguage(langCode) {
    this.lang = langCode;
  }

  cancelSpeech() {
    if (this.synth) this.synth.cancel();
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }

  async speak(text, onComplete = null, force = false) {
    if ((!this.ttsEnabled && !force) || !text) {
      if (onComplete) onComplete();
      return;
    }

    this.cancelSpeech();

    if (this.lang === "am") {
      const played = await this._tryBackendTTS(text, onComplete);
      if (played) return;
    }

    if (this.synth) {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = this.lang === "am" ? "am-ET" : "en-US";
        utterance.rate = 0.95;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          if (onComplete) onComplete();
        };
        utterance.onend = done;
        utterance.onerror = done;
        this.synth.speak(utterance);
        return;
      } catch (_) {}
    }

    const played = await this._tryBackendTTS(text, onComplete);
    if (!played && onComplete) onComplete();
  }

  async _tryBackendTTS(text, onComplete) {
    try {
      const res = await fetch(`${this.apiBase}/voice/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: this.lang })
      });
      if (!res.ok) return false;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      this.currentAudio = new Audio(url);
      this.currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        if (onComplete) onComplete();
      };
      this.currentAudio.onerror = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        if (onComplete) onComplete();
      };
      await this.currentAudio.play();
      return true;
    } catch (_) {
      return false;
    }
  }

  async startListening(onResult, onError, options = {}) {
    this.stopListening();
    this.cancelSpeech();

    const waitForStartMs = options.waitForStartMs ?? 10000; // 10 seconds to begin speaking
    const silenceAfterSpeechMs = options.silenceAfterSpeechMs ?? 2500; // 2.5s pause after speaking

    if (this.SpeechRecognition) {
      let settled = false;
      let hasSpoken = false;
      let manuallyStopped = false;
      let finalTranscript = "";
      let latestInterim = "";
      let noSpeechTimer = null;
      let silenceTimer = null;
      const deadline = Date.now() + waitForStartMs;

      const clearTimers = () => {
        if (noSpeechTimer) clearTimeout(noSpeechTimer);
        if (silenceTimer) clearTimeout(silenceTimer);
      };

      const finishWithResult = () => {
        if (settled) return;
        const combined = `${finalTranscript} ${latestInterim}`.trim();
        settled = true;
        clearTimers();
        this._stopActiveListening = null;
        try { this.recognition?.stop(); } catch (_) {}
        this.recognition = null;
        if (combined) {
          if (onResult) onResult(combined);
        } else if (onError) {
          onError("No speech detected. Please speak clearly.");
        }
      };

      const finishWithError = (msg) => {
        if (settled) return;
        settled = true;
        clearTimers();
        this._stopActiveListening = null;
        try { this.recognition?.stop(); } catch (_) {}
        this.recognition = null;
        if (onError) onError(msg);
      };

      this._stopActiveListening = () => {
        manuallyStopped = true;
        if (hasSpoken) {
          finishWithResult();
        } else {
          finishWithError("Listening stopped.");
        }
      };

      noSpeechTimer = setTimeout(() => {
        if (!hasSpoken && !settled) {
          finishWithError("No speech detected within 10 seconds.");
        }
      }, waitForStartMs);

      const launchRecognition = () => {
        if (settled) return;
        try {
          const rec = new this.SpeechRecognition();
          rec.lang = this.lang === "am" ? "am-ET" : "en-US";
          rec.interimResults = true;
          rec.continuous = true;
          rec.maxAlternatives = 1;
          this.recognition = rec;

          rec.onresult = (event) => {
            if (settled) return;
            hasSpoken = true;
            if (noSpeechTimer) clearTimeout(noSpeechTimer);

            let finals = "";
            let interims = "";
            for (let i = 0; i < event.results.length; i++) {
              const res = event.results[i];
              if (res.isFinal) finals += " " + res[0].transcript;
              else interims += " " + res[0].transcript;
            }
            if (finals.trim()) finalTranscript = finals.trim();
            latestInterim = interims.trim();

            if (silenceTimer) clearTimeout(silenceTimer);
            silenceTimer = setTimeout(() => finishWithResult(), silenceAfterSpeechMs);
          };

          rec.onerror = (event) => {
            if (settled) return;
            if (["network", "service-not-allowed", "language-not-supported"].includes(event.error)) {
              settled = true;
              clearTimers();
              this._stopActiveListening = null;
              this.recognition = null;
              this._startMediaRecorderSTT(onResult, onError, waitForStartMs);
              return;
            }
            if (event.error === "no-speech" && !hasSpoken && Date.now() < deadline) {
              return; // Allow onend to restart transparently
            }
            if (event.error === "not-allowed") {
              finishWithError("Microphone permission blocked. Allow mic access in your browser bar.");
              return;
            }
            if (!hasSpoken) {
              finishWithError(`Voice recognition error: ${event.error}`);
            }
          };

          rec.onend = () => {
            if (settled) return;
            if (hasSpoken || manuallyStopped) {
              finishWithResult();
            } else if (Date.now() < deadline) {
              setTimeout(() => launchRecognition(), 120);
            } else {
              finishWithError("No speech detected. Try speaking closer to the mic.");
            }
          };

          rec.start();
        } catch (_) {
          settled = true;
          clearTimers();
          this._stopActiveListening = null;
          this._startMediaRecorderSTT(onResult, onError, waitForStartMs);
        }
      };

      launchRecognition();
      return;
    }

    await this._startMediaRecorderSTT(onResult, onError, waitForStartMs);
  }

  async _startMediaRecorderSTT(onResult, onError, maxRecordMs = 10000) {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.mediaStream, { mimeType })
        : new MediaRecorder(this.mediaStream);
      this.audioChunks = [];

      const autoStopTimer = setTimeout(() => {
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
          this.mediaRecorder.stop();
        }
      }, maxRecordMs);

      this._stopActiveListening = () => {
        clearTimeout(autoStopTimer);
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
          this.mediaRecorder.stop();
        }
      };

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        clearTimeout(autoStopTimer);
        this._stopActiveListening = null;
        this.mediaStream?.getTracks().forEach(track => track.stop());
        this.mediaStream = null;

        const audioBlob = new Blob(this.audioChunks, {
          type: this.mediaRecorder?.mimeType || "audio/webm"
        });
        const formData = new FormData();
        formData.append("file", audioBlob, "voice_input.webm");
        formData.append("language", this.lang);

        try {
          const res = await fetch(`${this.apiBase}/voice/stt`, {
            method: "POST",
            body: formData
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || "STT server error");
          const transcript = (data.transcript || "").trim();
          if (transcript) {
            if (onResult) onResult(transcript);
          } else if (onError) {
            onError("No speech detected in recording.");
          }
        } catch (err) {
          if (onError) onError(err.message);
        }
      };

      this.mediaRecorder.start();
    } catch (_) {
      if (onError) onError("Microphone permission denied or unsupported.");
    }
  }

  stopListening() {
    if (this._stopActiveListening) {
      this._stopActiveListening();
    } else if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
  }
}

window.DigitalBridgeVoiceEngine = DigitalBridgeVoiceEngine;