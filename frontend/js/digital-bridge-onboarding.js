class DigitalBridgeOnboarding extends HTMLElement {
  constructor() {
    super();
    this.store = new window.DigitalBridgeStateManager();
    this.voice = window.DigitalBridgeVoiceEngine
      ? new window.DigitalBridgeVoiceEngine()
      : {
          ttsEnabled: false,
          apiBase: "",
          setLanguage() {},
          cancelSpeech() {},
          speak(_text, cb) { if (cb) cb(); },
          startListening(_ok, err) { if (err) err("Voice engine not loaded."); },
          stopListening() {}
        };
    this.pendingConfirmation = null;
    this.showCustomContrast = false;
    this.aiReply = "";
    this.voiceStatus = "";
    this.demoOtpHint = "";
    this.autoListening = false;
    this.autoRetryCount = 0;
    this.voiceUnlocked = false;
  }

  connectedCallback() {
    this.apiBase = this.getAttribute("api-base") || "http://localhost:8000/api/v1";
    this.voice.apiBase = this.apiBase;
    this.store.applyVisualPreferences();
    this.syncVoicePrefs();

    if (this.store.state.registered && this.store.state.form.full_name) {
      this.store.setStep(5);
    }

    this._onKeyDown = (e) => {
      if (e.key === "Escape") {
        this.pauseHandsFreeMode("Hands-free voice paused. Press Spacebar anytime to resume.");
        return;
      }
      // Spacebar outside text inputs unlocks & starts hands-free blind voice flow
      const tag = document.activeElement?.tagName;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "SELECT" && tag !== "BUTTON") {
        e.preventDefault();
        this.startHandsFreeSession();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    this.render();
    this.announceCurrentStep();
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeyDown);
    this.voice.stopListening();
    this.voice.cancelSpeech();
  }

  t(key, fallback = null) {
    const lang = this.store.state.preferences.language;
    const dict = window.DigitalBridgeI18n[lang] || window.DigitalBridgeI18n.en;
    return dict[key] || window.DigitalBridgeI18n.en[key] || fallback || key;
  }

  escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  setVoiceStatus(msg) {
    this.voiceStatus = msg;
    const el = this.querySelector("#voice-status-text");
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? "block" : "none";
    }
  }

  syncVoicePrefs() {
    const { tts_enabled, language } = this.store.state.preferences;
    this.voice.ttsEnabled = tts_enabled;
    this.voice.setLanguage(language);
    if (!tts_enabled) this.voice.cancelSpeech();
  }

  pauseHandsFreeMode(message = "") {
    this.autoListening = false;
    this.voice.stopListening();
    this.voice.cancelSpeech();
    this.store.updatePreferences({ tts_enabled: false, stt_enabled: false, auto_flow: false });
    this.syncVoicePrefs();
    if (message) this.voiceStatus = message;
    this.render();
  }

  startHandsFreeSession() {
    this.voiceUnlocked = true;
    this.autoRetryCount = 0;
    this.store.updatePreferences({ tts_enabled: true, stt_enabled: true, auto_flow: true });
    this.syncVoicePrefs();
    this.render();
    this.runAutoTurn();
  }

  getAutoTarget() {
    const { step, has_disability, form, preferences } = this.store.state;
    const am = preferences.language === "am";

    if (this.pendingConfirmation) {
      const { label, value, isSecret } = this.pendingConfirmation;
      return {
        type: "confirm",
        prompt: am
          ? (isSecret ? "የይለፍ ቃል ተቀብሏል። ትክክል ከሆነ 'አዎ' ይበሉ፣ ለመቀየር 'አስተካክል' ይበሉ።" : `የሰማሁት ${value} ነው። ትክክል ከሆነ 'አዎ' ይበሉ፣ ለመቀየር 'አስተካክል' ይበሉ።`)
          : (isSecret ? `${label} captured. Say Yes to confirm, or Edit to try again.` : `I heard ${value} for ${label}. Say Yes to confirm, or Edit to try again.`)
      };
    }

    if (step === 0 && has_disability === null) {
      return {
        type: "gate_yes_no",
        prompt: am
          ? "እንኳን ወደ ALX በደህና መጡ። የአካል ጉዳት ወይም የተደራሽነት ድጋፍ ይፈልጋሉ? 'አዎ' ወይም 'አይ' ይበሉ።"
          : "Welcome to ALX. Do you have a disability or need accessibility support? Please say Yes or No."
      };
    }

    if (step === 0 && has_disability === true) {
      return {
        type: "gate_profile",
        prompt: am
          ? "ምን አይነት ድጋፍ ይፈልጋሉ? 'ዓይነ ስውር'፣ 'ዝቅተኛ እይታ'፣ 'የአካል ድጋፍ' ወይም 'መደበኛ' ይበሉ።"
          : "What kind of support do you need? Please say Blind, Low Vision, Physical, or Standard."
      };
    }

    if (step === 1) {
      if (!form.full_name.trim()) {
        return {
          type: "field",
          field: "full_name",
          label: this.t("fullNameLabel"),
          isSecret: false,
          prompt: am ? "ደረጃ 1። እባክዎ ሙሉ ስምዎን ይናገሩ።" : "Step 1. Please say your full name."
        };
      }
      if (!form.password || form.password.length < 4) {
        return {
          type: "field",
          field: "password",
          label: this.t("passwordLabel"),
          isSecret: true,
          prompt: am ? "እባክዎ ቢያንስ 4 ፊደል ያለው የይለፍ ቃል ይናገሩ።" : "Please say your secure password, at least 4 characters."
        };
      }
      return { type: "goto", nextStep: 2 };
    }

    if (step === 2) {
      if (!form.route_confirmed) {
        return {
          type: "identity_route",
          prompt: am
            ? "ደረጃ 2፣ ማረጋገጫ። 'ብሔራዊ መታወቂያ'፣ 'የስደተኞች መታወቂያ'፣ 'ሌላ ሰነድ' ወይም 'አጋር ድርጅት' ይበሉ።"
            : "Step 2, identity verification. Say National ID, Refugee ID, Alternative Document, or Partner Referral."
        };
      }
      if (form.identity_route === "partner_referral" && !form.partner_name.trim()) {
        return {
          type: "field",
          field: "partner_name",
          label: this.t("partnerNameLabel"),
          isSecret: false,
          prompt: am ? "እባክዎ የአጋር ድርጅቱን ስም ይናገሩ።" : "Please say the name of your partner organization."
        };
      }
      if (form.identity_route !== "partner_referral" && !form.document_number.trim()) {
        return {
          type: "field",
          field: "document_number",
          label: this.t("idNumberLabel"),
          isSecret: false,
          prompt: am ? "እባክዎ የመታወቂያ ቁጥርዎን ይናገሩ።" : "Please say your document number."
        };
      }
      if (!form.contact_value.trim()) {
        return {
          type: "field",
          field: "contact_value",
          label: this.t("contactLabel"),
          isSecret: false,
          prompt: am ? "እባክዎ ስልክ ቁጥርዎን ይናገሩ።" : "Please say your phone number."
        };
      }
      if (!form.otp_verified) {
        return {
          type: "otp",
          prompt: am
            ? `የማረጋገጫ ኮድ ተልኳል። ኮዱ ${this.demoOtpHint.split("").join(" ")} ነው። እባክዎ 6ቱን ቁጥሮች ይናገሩ፣ ወይም 'ቀጣይ' ይበሉ።`
            : `Your verification code is ${this.demoOtpHint.split("").join(" ")}. Please say the 6-digit code to verify, or say Next to skip for now.`
        };
      }
      return { type: "goto", nextStep: 3 };
    }

    if (step === 3) {
      return {
        type: "support_needs",
        prompt: am
          ? "ደረጃ 3፣ ተጨማሪ ድጋፍ። 'ስክሪን አንባቢ'፣ 'ተጨማሪ ጊዜ'፣ 'የምልክት ቋንቋ'፣ 'ተደራሽ የስራ ቦታ' ይበሉ፣ ወይም ለመቀጠል 'ቀጣይ' ይበሉ።"
          : "Step 3, support needs. Say Screen Reader, Extra Time, Sign Language, Accessible Workplace, or say Next to continue."
      };
    }

    if (step === 4) {
      return {
        type: "review_submit",
        prompt: am
          ? `ማጠቃለያ። ስም ${form.full_name}። ስልክ ${form.contact_value}። ለመላክ 'አስገባ' ይበሉ፣ ወይም ለማስተካከል 'ተመለስ' ይበሉ።`
          : `Final review. Full name: ${form.full_name}. Phone number: ${form.contact_value}. Verification: ${form.otp_verified ? "verified" : "pending"}. Say Submit to finish registration, or Back to edit.`
      };
    }

    return null;
  }

  async runAutoTurn() {
    if (!this.store.state.preferences.auto_flow || !this.store.state.preferences.stt_enabled) {
      return;
    }

    const target = this.getAutoTarget();
    if (!target) return;

    if (target.type === "goto") {
      this.store.setStep(target.nextStep);
      this.render();
      this.runAutoTurn();
      return;
    }

    if (target.type === "otp" && !this.demoOtpHint) {
      await this.sendOtp(true); // sends code quietly, prompt below speaks it
    }

    const refreshedTarget = this.getAutoTarget();
    if (!refreshedTarget || refreshedTarget.type === "goto") {
      this.runAutoTurn();
      return;
    }

    this.autoListening = true;
    this.setVoiceStatus("🔊 Speaking prompt... microphone will open automatically.");

    this.voice.speak(refreshedTarget.prompt, () => {
      if (!this.store.state.preferences.auto_flow) return;
      this.setVoiceStatus("🎙️ Listening automatically... Speak now (10s window).");

      this.voice.startListening(
        async (transcript) => {
          this.autoRetryCount = 0;
          await this.handleAutoTranscript(refreshedTarget, transcript.trim());
        },
        (errMsg) => {
          this.autoRetryCount += 1;
          if (errMsg.includes("blocked") || this.autoRetryCount >= 3) {
            this.pauseHandsFreeMode(`${errMsg} Hands-free mode paused. Press Spacebar to try again.`);
            return;
          }
          this.setVoiceStatus(`${errMsg} Asking again...`);
          this.runAutoTurn();
        }
      );
    }, true);
  }

  async handleAutoTranscript(target, spoken) {
    const low = spoken.toLowerCase();

    // Global hands-free voice commands
    if (/^(stop voice|stop speaking|mute|quiet|pause|አቁም)$/i.test(low)) {
      this.pauseHandsFreeMode("Voice assistant paused. Press Spacebar to resume.");
      return;
    }
    if (/^(repeat|again|ድገም)$/i.test(low)) {
      this.runAutoTurn();
      return;
    }
    if (/^(amharic|አማርኛ)$/i.test(low)) {
      this.store.updatePreferences({ language: "am" });
      this.syncVoicePrefs();
      this.render();
      this.runAutoTurn();
      return;
    }
    if (/^(english|እንግሊዝኛ)$/i.test(low)) {
      this.store.updatePreferences({ language: "en" });
      this.syncVoicePrefs();
      this.render();
      this.runAutoTurn();
      return;
    }
    if (/^(back|previous|ተመለስ)$/i.test(low)) {
      this.pendingConfirmation = null;
      const cur = this.store.state.step;
      if (cur > 1) this.store.setStep(cur - 1);
      else if (cur === 1) this.store.setStep(0);
      this.render();
      this.runAutoTurn();
      return;
    }

    if (target.type === "confirm") {
      if (/\b(yes|correct|confirm|ok|okay|yeah|yep|next)\b|አዎ|ትክክል|ቀጣይ/i.test(low)) {
        const { field, value } = this.pendingConfirmation;
        this.store.updateForm({ [field]: value });
        this.pendingConfirmation = null;
        this.render();
        this.runAutoTurn();
      } else {
        this.store.updateForm({ [this.pendingConfirmation.field]: "" });
        this.pendingConfirmation = null;
        this.render();
        this.runAutoTurn();
      }
      return;
    }

    if (target.type === "gate_yes_no") {
      if (/\b(no|nope|standard|normal)\b|አይ|መደበኛ/i.test(low)) {
        this.selectDisabilityGate(false);
      } else {
        this.selectDisabilityGate(true);
        this.store.updatePreferences({ auto_flow: true, stt_enabled: true, tts_enabled: true });
        this.runAutoTurn();
      }
      return;
    }

    if (target.type === "gate_profile") {
      if (/low vision|vision|contrast|zoom|ዝቅተኛ/i.test(low)) {
        this.selectProfile("low_vision");
      } else if (/physical|motor|hand|አካል/i.test(low)) {
        this.selectProfile("physical_motor");
      } else if (/standard|normal|መደበኛ/i.test(low)) {
        this.selectProfile("standard");
      } else {
        this.selectProfile("blind");
      }
      this.store.setStep(1);
      this.render();
      this.runAutoTurn();
      return;
    }

    if (target.type === "identity_route") {
      let route = "national_kebele_id";
      if (/refugee|unhcr|rrs|ስደተኞች/i.test(low)) route = "refugee_id";
      else if (/alternative|other|ሌላ/i.test(low)) route = "alt_doc";
      else if (/partner|referral|no id|አጋር/i.test(low)) route = "partner_referral";

      this.store.updateForm({ identity_route: route, route_confirmed: true });
      this.render();
      this.runAutoTurn();
      return;
    }

    if (target.type === "otp") {
      if (/\b(next|skip|continue)\b|ቀጣይ/i.test(low)) {
        this.store.setStep(3);
        this.render();
        this.runAutoTurn();
        return;
      }
      const digits = spoken.replace(/\D/g, "");
      this.store.updateForm({ otp_code: digits || spoken });
      const ok = await this.verifyOtp(true);
      if (ok) {
        this.store.setStep(3);
      }
      this.render();
      this.runAutoTurn();
      return;
    }

    if (target.type === "support_needs") {
      if (/\b(next|done|continue|none|skip)\b|ቀጣይ/i.test(low)) {
        this.store.setStep(4);
        this.render();
        this.runAutoTurn();
        return;
      }
      const needs = new Set(this.store.state.form.support_needs || []);
      if (/screen|reader|ስክሪን/i.test(low)) needs.add("screen_reader");
      if (/extra|time|ጊዜ/i.test(low)) needs.add("extra_time");
      if (/sign|language|ምልክት/i.test(low)) needs.add("sign_language");
      if (/workplace|job|ስራ/i.test(low)) needs.add("accessible_workplace");
      this.store.updateForm({ support_needs: Array.from(needs) });
      this.render();
      this.voice.speak("Support option added. Say another option or say Next.", () => this.runAutoTurn(), true);
      return;
    }

    if (target.type === "review_submit") {
      if (/\b(submit|yes|confirm|finish|send)\b|አስገባ|አዎ/i.test(low)) {
        this.store.updatePreferences({ auto_flow: false });
        await this.submitRegistration();
      } else {
        this.store.setStep(1);
        this.render();
        this.runAutoTurn();
      }
      return;
    }

    if (target.type === "field") {
      this.store.updateForm({ [target.field]: spoken });
      this.pendingConfirmation = {
        field: target.field,
        label: target.label,
        value: spoken,
        isSecret: target.isSecret
      };
      this.render();
      this.runAutoTurn();
    }
  }

  getStepAnnouncementText() {
    const { step, has_disability, preferences } = this.store.state;
    if (step === 0) {
      if (has_disability === null) {
        return preferences.language === "am"
          ? "እንኳን ወደ ALX በደህና መጡ። የአካል ጉዳት ወይም የተደራሽነት ድጋፍ ይፈልጋሉ? አዎ ወይም አይ ይምረጡ።"
          : "Welcome to ALX. Are you a person with a disability or do you need accessibility features? Choose Yes or No.";
      }
      return this.t("gateTitle") + ". " + this.t("gateSubtitle");
    }
    if (step === 0.5) return "Standard ALX platform active.";
    if (step === 1) return this.t("step1Title") + ". " + this.t("fullNameLabel");
    if (step === 2) return this.t("step2Title") + ". " + this.t("contactLabel");
    if (step === 3) return this.t("step3Title") + ". " + this.t("supportLegend");
    if (step === 4) return this.t("step4Title") + ". " + this.t("readSummaryBtn");
    return "";
  }

  announceCurrentStep(force = false) {
    if (this.store.state.preferences.auto_flow) return;
    const text = this.getStepAnnouncementText();
    if (text) this.voice.speak(text, null, force);
  }

  selectDisabilityGate(isDisabled) {
    this.voiceUnlocked = true;
    this.store.setHasDisability(isDisabled);
    if (!isDisabled) {
      this.store.updatePreferences({
        profile_type: "standard",
        contrast_mode: "default",
        zoom_percent: 100,
        tts_enabled: false,
        stt_enabled: false,
        auto_flow: false
      });
      this.store.setStep(0.5);
    } else {
      this.store.updatePreferences({ tts_enabled: true });
      this.store.setStep(0);
    }
    this.syncVoicePrefs();
    this.render();
    if (!this.store.state.preferences.auto_flow) this.announceCurrentStep();
  }

  selectProfile(profileType) {
    if (profileType === "blind" || profileType === "low_literacy") {
      this.store.updatePreferences({
        profile_type: profileType,
        tts_enabled: true,
        stt_enabled: true,
        auto_flow: true
      });
    } else if (profileType === "low_vision") {
      this.store.updatePreferences({
        profile_type: profileType,
        contrast_mode: "dark_yellow",
        zoom_percent: 130,
        tts_enabled: true,
        auto_flow: false
      });
      this.showCustomContrast = true;
    } else if (profileType === "physical_motor") {
      this.store.updatePreferences({
        profile_type: profileType,
        tts_enabled: true,
        stt_enabled: true,
        auto_flow: true
      });
    } else {
      this.store.updatePreferences({ profile_type: "standard", auto_flow: false });
    }
    this.syncVoicePrefs();
    this.render();
  }

  async askAIAssistant(prompt) {
    if (!prompt.trim()) return;
    this.aiReply = "Thinking...";
    this.render();
    try {
      const res = await fetch(`${this.apiBase}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          language: this.store.state.preferences.language,
          step: Math.floor(this.store.state.step)
        })
      });
      if (!res.ok) throw new Error("AI service unavailable");
      const data = await res.json();
      this.aiReply = data.response;
      this.render();
      this.voice.speak(this.aiReply);
    } catch (_) {
      this.aiReply = "Could not reach backend AI. Make sure uvicorn is running on port 8000.";
      this.render();
    }
  }

  async sendOtp(silent = false) {
    const contact = this.store.state.form.contact_value?.trim();
    if (!contact) {
      if (!silent) this.setVoiceStatus("Please enter or speak your phone number first.");
      return;
    }
    try {
      const res = await fetch(`${this.apiBase}/onboarding/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_value: contact,
          language: this.store.state.preferences.language
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not send code");
      this.demoOtpHint = data.demo_code || "";
      this.render();
      if (!silent) {
        this.voice.speak(`Verification code sent. Your code is ${this.demoOtpHint.split("").join(" ")}.`);
      }
    } catch (_) {
      if (!silent) this.setVoiceStatus("Could not send verification code. Check backend connection.");
    }
  }

  async verifyOtp(silent = false) {
    const { contact_value, otp_code } = this.store.state.form;
    if (!contact_value || !otp_code) return false;
    try {
      const res = await fetch(`${this.apiBase}/onboarding/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_value, code: otp_code })
      });
      if (!res.ok) throw new Error("Invalid code");
      this.store.updateForm({ otp_verified: true });
      this.render();
      if (!silent) this.voice.speak("Phone number verified successfully.");
      return true;
    } catch (_) {
      this.store.updateForm({ otp_verified: false });
      this.render();
      if (!silent) this.voice.speak("Invalid or expired verification code. Please try again.");
      return false;
    }
  }

  async submitRegistration() {
    const { preferences, form } = this.store.state;
    if (!form.full_name.trim() || !form.password || form.password.length < 4) {
      this.setVoiceStatus("Please enter your full name and a password of at least 4 characters.");
      this.voice.speak("Please enter your full name and a password of at least 4 characters.");
      this.store.setStep(1);
      this.render();
      return;
    }
    if (!form.contact_value.trim()) {
      this.setVoiceStatus("Please enter your phone number in Step 2.");
      this.voice.speak("Please enter your phone number in Step 2.");
      this.store.setStep(2);
      this.render();
      return;
    }

    try {
      const response = await fetch(`${this.apiBase}/onboarding/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name,
          password: form.password,
          preferred_language: preferences.language,
          preferences,
          identity: {
            route: form.identity_route,
            document_number: form.document_number,
            partner_name: form.partner_name,
            contact_value: form.contact_value,
            otp_verified: form.otp_verified
          },
          support_needs: form.support_needs
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || "Registration failed");
      }

      const data = await response.json();
      if (data.access_token) {
        localStorage.setItem("db_session_token", data.access_token);
      }

      this.store.state.registered = true;
      this.store.setStep(5);
      this.render();
      this.voice.speak(this.t("successTitle") + " " + this.t("successBody"), null, true);
    } catch (err) {
      console.error("Registration submit error:", err);
      this.setVoiceStatus(err.message);
      this.voice.speak("Submission failed. Please check that the backend server is running and try again.");
    }
  }

  readSummaryAloud() {
    const { form, preferences } = this.store.state;
    const summary = preferences.language === "am"
      ? `ማጠቃለያ። ሙሉ ስም ${form.full_name || "አልተሰጠም"}። ስልክ ቁጥር ${form.contact_value || "አልተሰጠም"}። ትክክል ከሆነ ምዝገባውን አስገባ የሚለውን ይጫኑ።`
      : `Summary review. Full name: ${form.full_name || "not provided"}. ` +
        `Verification route: ${form.identity_route}. ` +
        `Phone number: ${form.contact_value || "not provided"}. ` +
        `Verification status: ${form.otp_verified ? "verified" : "not verified yet"}. ` +
        `Profile: ${preferences.profile_type}. ` +
        `Press Submit Registration if everything is correct, or Back to edit.`;
    this.voice.speak(summary, null, true);
  }

  render() {
    const { step, preferences, form } = this.store.state;
    const voiceActive = preferences.tts_enabled;
    const autoActive = preferences.auto_flow;

    this.innerHTML = `
      <style>
        .db-shell { background: var(--db-card-bg); color: var(--db-fg); border: 3px solid var(--db-border); border-radius: 14px; padding: 1.5rem; box-shadow: 0 6px 24px rgba(0,0,0,0.14); }
        .db-toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; padding-bottom: 1.25rem; margin-bottom: 1.5rem; border-bottom: 3px solid var(--db-border); align-items: center; }
        .db-tool-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 56px; min-width: 56px; padding: 0.7rem 1.1rem; font-size: 1rem; font-weight: 800; border-radius: 10px; border: 3px solid var(--db-border); background: var(--db-bg); color: var(--db-fg); cursor: pointer; }
        .db-tool-btn[aria-pressed="true"] { background: var(--db-accent); color: var(--db-accent-fg); }
        .db-icon { font-size: 1.35rem; line-height: 1; }
        .db-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1rem; margin: 1.25rem 0; }
        .db-choice-card { display: flex; flex-direction: column; align-items: flex-start; text-align: start; gap: 0.4rem; padding: 1.25rem; min-height: 82px; border-radius: 12px; border: 3px solid var(--db-border); background: var(--db-bg); color: var(--db-fg); font-size: 1.1rem; font-weight: 800; cursor: pointer; }
        .db-choice-card[aria-checked="true"] { background: var(--db-accent); color: var(--db-accent-fg); }
        .db-field { margin-bottom: 1.4rem; }
        .db-label { display: block; font-weight: 800; margin-bottom: 0.5rem; font-size: 1.1rem; }
        .db-input, .db-select { width: 100%; box-sizing: border-box; min-height: 56px; padding: 0.75rem 1rem; font-size: 1.1rem; border-radius: 8px; border: 3px solid var(--db-border); background: var(--db-bg); color: var(--db-fg); }
        .db-nav-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-top: 2rem; padding-top: 1.25rem; border-top: 3px solid var(--db-border); }
        .db-primary { background: var(--db-accent); color: var(--db-accent-fg); border: 3px solid var(--db-border); min-height: 56px; padding: 0.8rem 1.6rem; font-size: 1.15rem; font-weight: 900; border-radius: 10px; cursor: pointer; }
        .db-panel { border: 2px dashed var(--db-border); border-radius: 10px; padding: 1rem; margin: 1rem 0; }
        .recording-active { background: #c62828 !important; color: #ffffff !important; animation: pulse 1.3s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
      </style>

      <section class="db-shell" aria-label="Accessible Onboarding Module">
        <nav class="db-toolbar" aria-label="Accessibility Controls">
          <button type="button" class="db-tool-btn" id="btn-contrast" aria-expanded="${this.showCustomContrast}">
            <span class="db-icon" aria-hidden="true">&#127912;</span>
            <span>${this.t("toolbarContrast")}</span>
          </button>

          <button type="button" class="db-tool-btn" id="btn-zoom-in" aria-label="${this.t("toolbarZoomIn")}">
            <span class="db-icon" aria-hidden="true">&#128269;+</span>
            <span>${this.t("toolbarZoomIn")} (${preferences.zoom_percent}%)</span>
          </button>

          <button type="button" class="db-tool-btn" id="btn-zoom-out" aria-label="${this.t("toolbarZoomOut")}">
            <span class="db-icon" aria-hidden="true">&#128269;-</span>
            <span>${this.t("toolbarZoomOut")}</span>
          </button>

          <button type="button" class="db-tool-btn" id="btn-voice" aria-pressed="${voiceActive}">
            <span class="db-icon" aria-hidden="true">&#128266;</span>
            <span>${this.t("toolbarVoiceToggle")}: ${voiceActive ? "ON" : "OFF"}</span>
          </button>

          <button type="button" class="db-tool-btn" id="btn-handsfree" aria-pressed="${autoActive}">
            <span class="db-icon" aria-hidden="true">&#127897;</span>
            <span>Hands-Free Blind Mode: ${autoActive ? "ON" : "OFF"}</span>
          </button>

          ${voiceActive || autoActive ? `
            <button type="button" class="db-tool-btn" id="btn-cancel-voice">
              <span class="db-icon" aria-hidden="true">&#9209;</span>
              <span>${this.t("cancelVoiceBtn")}</span>
            </button>
          ` : ""}

          <label class="db-tool-btn" style="padding:0.25rem 0.75rem;">
            <span class="db-icon" aria-hidden="true">&#127760;</span>
            <span>${this.t("toolbarLanguage")}:</span>
            <select id="db-lang-select" class="db-select" style="min-height:44px;width:auto;border:2px solid var(--db-border);">
              <option value="en" ${preferences.language === "en" ? "selected" : ""}>English</option>
              <option value="am" ${preferences.language === "am" ? "selected" : ""}>አማርኛ</option>
            </select>
          </label>

          <button type="button" class="db-tool-btn" id="btn-toolbar-register">
            <span class="db-icon" aria-hidden="true">&#128221;</span>
            <span>${this.t("toolbarRegister")}</span>
          </button>
        </nav>

        ${this.showCustomContrast ? this.renderContrastPanel(preferences) : ""}

        <div aria-live="polite" class="db-panel" id="ai-assistant-bar">
          <strong>&#129302; AI Accessibility Assistant:</strong>
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem;">
            <input id="inp-ai-ask" class="db-input" style="flex:1;min-width:200px;" placeholder="Ask for help or guidance..." />
            <button type="button" class="db-tool-btn" id="btn-mic-ai">&#127897; Speak</button>
            <button type="button" class="db-tool-btn" id="btn-ai-ask">Ask AI</button>
            <button type="button" class="db-tool-btn" id="btn-repeat-audio">&#128226; Repeat Step</button>
          </div>
          <p id="voice-status-text" style="margin:0.5rem 0 0;font-weight:700;display:${this.voiceStatus ? "block" : "none"};">${this.escapeHtml(this.voiceStatus)}</p>
          ${this.aiReply ? `<p style="margin:0.75rem 0 0;"><strong>Assistant:</strong> ${this.escapeHtml(this.aiReply)}</p>` : ""}
        </div>

        ${this.pendingConfirmation ? this.renderConfirmationBanner() : ""}
        ${this.renderContent(step, preferences, form)}
      </section>
    `;
    this.bindEvents();
  }

  renderContrastPanel(preferences) {
    return `
      <div class="db-panel" aria-label="${this.t("contrastPresetsTitle")}">
        <h3 style="margin-top:0;">${this.t("contrastPresetsTitle")}</h3>
        <div style="display:flex;flex-wrap:wrap;gap:0.6rem;margin-bottom:1rem;">
          <button type="button" class="db-tool-btn" data-contrast="default" aria-pressed="${preferences.contrast_mode === "default"}">${this.t("presetDefault")}</button>
          <button type="button" class="db-tool-btn" data-contrast="dark_yellow" aria-pressed="${preferences.contrast_mode === "dark_yellow"}">${this.t("presetDarkYellow")}</button>
          <button type="button" class="db-tool-btn" data-contrast="light_yellow" aria-pressed="${preferences.contrast_mode === "light_yellow"}">${this.t("presetLightYellow")}</button>
          <button type="button" class="db-tool-btn" data-contrast="dark_white" aria-pressed="${preferences.contrast_mode === "dark_white"}">${this.t("presetDarkWhite")}</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
          <label style="font-weight:800;">Custom Background:
            <input type="color" id="inp-custom-bg" value="${this.escapeHtml(preferences.custom_bg)}" style="width:56px;height:44px;vertical-align:middle;" />
          </label>
          <label style="font-weight:800;">Custom Text:
            <input type="color" id="inp-custom-fg" value="${this.escapeHtml(preferences.custom_fg)}" style="width:56px;height:44px;vertical-align:middle;" />
          </label>
          <button type="button" class="db-tool-btn" id="btn-apply-custom-contrast">Apply Custom Colors</button>
        </div>
      </div>
    `;
  }

  renderConfirmationBanner() {
    const { label, value, isSecret } = this.pendingConfirmation;
    return `
      <div class="db-panel" role="alert" style="border-style:solid;border-width:3px;">
        <p style="margin:0 0 0.75rem;font-size:1.15rem;">
          <strong>${this.t("confirmHeardPrefix")}</strong>
          ${isSecret ? "•••••••• (captured)" : this.escapeHtml(value)} <em>(${this.escapeHtml(label)})</em>
        </p>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button type="button" class="db-primary" id="btn-confirm-yes">&#9989; ${this.t("confirmYes")}</button>
          <button type="button" class="db-tool-btn" id="btn-confirm-edit">&#9998; ${this.t("confirmEdit")}</button>
        </div>
      </div>
    `;
  }

  renderContent(step, preferences, form) {
    if (step === 0) {
      if (this.store.state.has_disability === null) {
        return `
          <div>
            <h2>Welcome to ALX — Accessibility Assistant</h2>
            <p style="font-size:1.15rem;">Do you have a disability or need visual, voice, or motor accessibility customization?</p>
            <button type="button" class="db-primary" id="btn-start-handsfree" style="width:100%;margin-bottom:1rem;">
              &#127897; Press Spacebar or Tap Here for Automatic Blind Voice Registration
            </button>
            <div class="db-grid">
              <button type="button" class="db-choice-card" id="btn-gate-yes">
                <span>&#9855; Yes — Customize Accessibility &amp; Register</span>
              </button>
              <button type="button" class="db-choice-card" id="btn-gate-no">
                <span>&#128100; No — Continue to Standard ALX Platform</span>
              </button>
            </div>
          </div>
        `;
      }

      return `
        <div>
          <h2>${this.t("gateTitle")}</h2>
          <p>${this.t("gateSubtitle")}</p>
          <div class="db-grid" role="radiogroup" aria-label="Accessibility Profile">
            <button type="button" class="db-choice-card" data-profile="blind" aria-checked="${preferences.profile_type === "blind"}"><span>&#128266; ${this.t("optBlind")}</span></button>
            <button type="button" class="db-choice-card" data-profile="low_vision" aria-checked="${preferences.profile_type === "low_vision"}"><span>&#128065; ${this.t("optLowVision")}</span></button>
            <button type="button" class="db-choice-card" data-profile="physical_motor" aria-checked="${preferences.profile_type === "physical_motor"}"><span>&#9000; ${this.t("optPhysical")}</span></button>
            <button type="button" class="db-choice-card" data-profile="low_literacy" aria-checked="${preferences.profile_type === "low_literacy"}"><span>&#128214; ${this.t("optLowLiteracy")}</span></button>
            <button type="button" class="db-choice-card" data-profile="standard" aria-checked="${preferences.profile_type === "standard"}"><span>&#128100; ${this.t("optStandard")}</span></button>
          </div>

          <div class="db-nav-row">
            <button type="button" class="db-tool-btn" id="btn-reset-gate">&larr; Back</button>
            <button type="button" class="db-primary" id="btn-start-signup">${this.t("startSignupBtn")} &rarr;</button>
          </div>
        </div>
      `;
    }

    if (step === 0.5) {
      return `
        <div>
          <h2>ALX Standard Learning Platform</h2>
          <p>You are using the standard ALX experience. You can still activate accessibility tools anytime from the top bar.</p>
          <div class="db-nav-row">
            <button type="button" class="db-tool-btn" id="btn-reset-gate">&larr; Accessibility Check</button>
            <button type="button" class="db-primary" id="btn-start-signup">${this.t("startSignupBtn")} &rarr;</button>
          </div>
        </div>
      `;
    }

    if (step === 1) {
      return `
        <div>
          <h2>${this.t("step1Title")}</h2>
          <div class="db-field">
            <label class="db-label" for="inp-full-name">${this.t("fullNameLabel")}</label>
            <div style="display:flex;gap:0.5rem;">
              <input class="db-input" id="inp-full-name" type="text" value="${this.escapeHtml(form.full_name)}" autocomplete="name" />
              <button type="button" class="db-tool-btn" id="btn-mic-name">&#127897; Speak</button>
            </div>
          </div>
          <div class="db-field">
            <label class="db-label" for="inp-password">${this.t("passwordLabel")}</label>
            <div style="display:flex;gap:0.5rem;">
              <input class="db-input" id="inp-password" type="password" value="${this.escapeHtml(form.password)}" placeholder="At least 4 characters" autocomplete="new-password" />
              <button type="button" class="db-tool-btn" id="btn-mic-pass">&#127897; Speak</button>
            </div>
          </div>
          ${this.renderNav(0, 2)}
        </div>
      `;
    }

    if (step === 2) {
      const isPartner = form.identity_route === "partner_referral";
      return `
        <div>
          <h2>${this.t("step2Title")}</h2>

          <div class="db-field">
            <label class="db-label" for="sel-id-route">${this.t("idRouteLabel")}</label>
            <select class="db-select" id="sel-id-route">
              <option value="national_kebele_id" ${form.identity_route === "national_kebele_id" ? "selected" : ""}>${this.t("routeNational")}</option>
              <option value="refugee_id" ${form.identity_route === "refugee_id" ? "selected" : ""}>${this.t("routeRefugee")}</option>
              <option value="alt_doc" ${form.identity_route === "alt_doc" ? "selected" : ""}>${this.t("routeAltDoc")}</option>
              <option value="partner_referral" ${form.identity_route === "partner_referral" ? "selected" : ""}>${this.t("routePartner")}</option>
            </select>
          </div>

          ${isPartner ? `
            <div class="db-field">
              <label class="db-label" for="inp-partner-name">${this.t("partnerNameLabel")}</label>
              <div style="display:flex;gap:0.5rem;">
                <input class="db-input" id="inp-partner-name" type="text" value="${this.escapeHtml(form.partner_name)}" />
                <button type="button" class="db-tool-btn" id="btn-mic-partner">&#127897; Speak</button>
              </div>
            </div>
          ` : `
            <div class="db-field">
              <label class="db-label" for="inp-doc-num">${this.t("idNumberLabel")}</label>
              <div style="display:flex;gap:0.5rem;">
                <input class="db-input" id="inp-doc-num" type="text" value="${this.escapeHtml(form.document_number)}" />
                <button type="button" class="db-tool-btn" id="btn-mic-doc">&#127897; Speak</button>
              </div>
            </div>
          `}

          <div class="db-field">
            <label class="db-label" for="inp-contact">${this.t("contactLabel")}</label>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <input class="db-input" style="flex:1;" id="inp-contact" type="tel" value="${this.escapeHtml(form.contact_value)}" placeholder="+251..." />
              <button type="button" class="db-tool-btn" id="btn-mic-contact">&#127897; Speak</button>
              <button type="button" class="db-tool-btn" id="btn-send-otp">Send Code</button>
            </div>
          </div>

          <div class="db-panel">
            <label class="db-label" for="inp-otp">Accessible OTP Code (SMS / Audio Readout — No Visual CAPTCHA)</label>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <input class="db-input" style="flex:1;" id="inp-otp" type="text" inputmode="numeric" value="${this.escapeHtml(form.otp_code)}" placeholder="6-digit code" />
              <button type="button" class="db-tool-btn" id="btn-mic-otp">&#127897; Speak</button>
              <button type="button" class="db-primary" id="btn-verify-otp">Verify Code</button>
            </div>
            ${this.demoOtpHint ? `<p style="margin:0.5rem 0 0;">Demo OTP sent: <strong>${this.escapeHtml(this.demoOtpHint)}</strong></p>` : ""}
            <p style="margin:0.5rem 0 0;">Status: <strong>${form.otp_verified ? "✅ Verified" : "Pending verification"}</strong></p>
          </div>

          ${this.renderNav(1, 3)}
        </div>
      `;
    }

    if (step === 3) {
      const needs = form.support_needs || [];
      return `
        <div>
          <h2>${this.t("step3Title")}</h2>
          <fieldset style="border:3px solid var(--db-border);border-radius:10px;padding:1rem;">
            <legend style="font-weight:800;">${this.t("supportLegend")}</legend>
            ${[
              ["screen_reader", this.t("suppScreenReader")],
              ["extra_time", this.t("suppExtraTime")],
              ["sign_language", this.t("suppSignLanguage")],
              ["accessible_workplace", this.t("suppWorkplace")]
            ].map(([val, label]) => `
              <label style="display:flex;align-items:center;gap:0.75rem;min-height:52px;font-weight:700;">
                <input type="checkbox" class="chk-support" value="${val}" ${needs.includes(val) ? "checked" : ""} style="width:24px;height:24px;" />
                <span>${label}</span>
              </label>
            `).join("")}
          </fieldset>
          ${this.renderNav(2, 4)}
        </div>
      `;
    }

    if (step === 4) {
      return `
        <div>
          <h2>${this.t("step4Title")}</h2>
          <div class="db-panel">
            <p><strong>${this.t("fullNameLabel")}:</strong> ${this.escapeHtml(form.full_name) || "—"} <button type="button" class="db-tool-btn" data-goto="1" style="min-height:40px;padding:0.25rem 0.75rem;">${this.t("confirmEdit")}</button></p>
            <p><strong>${this.t("idRouteLabel")}:</strong> ${this.escapeHtml(form.identity_route)} <button type="button" class="db-tool-btn" data-goto="2" style="min-height:40px;padding:0.25rem 0.75rem;">${this.t("confirmEdit")}</button></p>
            <p><strong>${this.t("contactLabel")}:</strong> ${this.escapeHtml(form.contact_value) || "—"} (${form.otp_verified ? "✅ Verified" : "Unverified"})</p>
            <p><strong>Support Needs:</strong> ${form.support_needs.length ? this.escapeHtml(form.support_needs.join(", ")) : "None selected"} <button type="button" class="db-tool-btn" data-goto="3" style="min-height:40px;padding:0.25rem 0.75rem;">${this.t("confirmEdit")}</button></p>
          </div>
          <div class="db-nav-row">
            <button type="button" class="db-tool-btn" data-goto="3">&larr; ${this.t("backBtn")}</button>
            <button type="button" class="db-tool-btn" id="btn-read-summary">&#128266; ${this.t("readSummaryBtn")}</button>
            <button type="button" class="db-primary" id="btn-submit">${this.t("submitBtn")}</button>
          </div>
        </div>
      `;
    }

    return `
      <div>
        <h2>&#9989; ${this.t("successTitle")}</h2>
        <p>${this.t("successBody")}</p>
        <button type="button" class="db-tool-btn" id="btn-restart">Reset Session</button>
      </div>
    `;
  }

  renderNav(prev, next) {
    return `<div class="db-nav-row"><button type="button" class="db-tool-btn" data-goto="${prev}">&larr; ${this.t("backBtn")}</button><button type="button" class="db-primary" data-goto="${next}">${this.t("nextBtn")} &rarr;</button></div>`;
  }

  bindEvents() {
    this.querySelector("#btn-contrast")?.addEventListener("click", () => {
      this.showCustomContrast = !this.showCustomContrast;
      this.render();
    });

    this.querySelectorAll("[data-contrast]").forEach(btn => btn.addEventListener("click", () => {
      this.store.updatePreferences({ contrast_mode: btn.getAttribute("data-contrast") });
      this.render();
    }));

    this.querySelector("#btn-apply-custom-contrast")?.addEventListener("click", () => {
      const bg = this.querySelector("#inp-custom-bg")?.value || "#000000";
      const fg = this.querySelector("#inp-custom-fg")?.value || "#FFFF00";
      this.store.updatePreferences({ contrast_mode: "custom", custom_bg: bg, custom_fg: fg });
      this.render();
    });

    this.querySelector("#btn-zoom-in")?.addEventListener("click", () => {
      const next = Math.min(200, this.store.state.preferences.zoom_percent + 15);
      this.store.updatePreferences({ zoom_percent: next });
      this.render();
    });

    this.querySelector("#btn-zoom-out")?.addEventListener("click", () => {
      const next = Math.max(85, this.store.state.preferences.zoom_percent - 15);
      this.store.updatePreferences({ zoom_percent: next });
      this.render();
    });

    this.querySelector("#btn-voice")?.addEventListener("click", () => {
      const active = !this.store.state.preferences.tts_enabled;
      this.store.updatePreferences({ tts_enabled: active });
      this.syncVoicePrefs();
      this.render();
      if (active) this.announceCurrentStep();
    });

    this.querySelector("#btn-handsfree")?.addEventListener("click", () => {
      if (this.store.state.preferences.auto_flow) {
        this.pauseHandsFreeMode("Hands-free blind mode turned OFF.");
      } else {
        this.startHandsFreeSession();
      }
    });

    this.querySelector("#btn-start-handsfree")?.addEventListener("click", () => {
      this.startHandsFreeSession();
    });

    this.querySelector("#btn-cancel-voice")?.addEventListener("click", () => {
      this.pauseHandsFreeMode("Voice assistant paused. Press Spacebar to resume.");
    });

    this.querySelector("#btn-repeat-audio")?.addEventListener("click", () => {
      if (this.store.state.preferences.auto_flow) this.runAutoTurn();
      else this.announceCurrentStep(true);
    });

    const triggerAiAsk = () => {
      const q = this.querySelector("#inp-ai-ask")?.value || "";
      if (q.trim()) this.askAIAssistant(q);
    };

    this.querySelector("#btn-ai-ask")?.addEventListener("click", triggerAiAsk);
    this.querySelector("#inp-ai-ask")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        triggerAiAsk();
      }
    });

    this.querySelector("#btn-mic-ai")?.addEventListener("click", () => {
      const aiBtn = this.querySelector("#btn-mic-ai");
      if (aiBtn.classList.contains("recording-active")) {
        this.voice.stopListening();
        return;
      }
      aiBtn.textContent = "🛑 Stop";
      aiBtn.classList.add("recording-active");
      this.setVoiceStatus("🎙️ Listening for your question (10s window)...");

      this.voice.startListening(
        (transcript) => {
          this.setVoiceStatus("");
          this.askAIAssistant(transcript);
        },
        (errMsg) => {
          aiBtn.innerHTML = "&#127897; Speak";
          aiBtn.classList.remove("recording-active");
          this.setVoiceStatus(errMsg);
        }
      );
    });

    this.querySelector("#db-lang-select")?.addEventListener("change", (e) => {
      this.store.updatePreferences({ language: e.target.value });
      this.syncVoicePrefs();
      this.render();
      if (this.store.state.preferences.auto_flow) this.runAutoTurn();
      else this.announceCurrentStep();
    });

    this.querySelector("#btn-toolbar-register")?.addEventListener("click", () => {
      this.store.setStep(1);
      this.render();
      if (this.store.state.preferences.auto_flow) this.runAutoTurn();
      else this.announceCurrentStep();
    });

    this.querySelector("#btn-gate-yes")?.addEventListener("click", () => this.selectDisabilityGate(true));
    this.querySelector("#btn-gate-no")?.addEventListener("click", () => this.selectDisabilityGate(false));
    this.querySelector("#btn-reset-gate")?.addEventListener("click", () => {
      this.store.setHasDisability(null);
      this.store.setStep(0);
      this.render();
      this.announceCurrentStep();
    });

    this.querySelectorAll("[data-profile]").forEach(btn => btn.addEventListener("click", () => {
      const profile = btn.getAttribute("data-profile");
      this.selectProfile(profile);
      if (profile === "blind" || profile === "low_literacy") {
        this.store.setStep(1);
        this.render();
        this.runAutoTurn();
      }
    }));

    this.querySelector("#btn-start-signup")?.addEventListener("click", () => {
      this.store.setStep(1);
      this.render();
      if (this.store.state.preferences.auto_flow) this.runAutoTurn();
      else this.announceCurrentStep();
    });

    this.querySelector("#btn-confirm-yes")?.addEventListener("click", () => {
      if (!this.pendingConfirmation) return;
      const { field, value } = this.pendingConfirmation;
      this.store.updateForm({ [field]: value });
      this.pendingConfirmation = null;
      this.setVoiceStatus("");
      this.render();
      if (this.store.state.preferences.auto_flow) this.runAutoTurn();
      else this.voice.speak("Saved.");
    });

    this.querySelector("#btn-confirm-edit")?.addEventListener("click", () => {
      if (this.pendingConfirmation) {
        this.store.updateForm({ [this.pendingConfirmation.field]: "" });
      }
      this.pendingConfirmation = null;
      this.setVoiceStatus("Cleared. Please speak or type your answer again.");
      this.render();
      if (this.store.state.preferences.auto_flow) this.runAutoTurn();
      else this.voice.speak("Cleared. Please speak or type your answer again.");
    });

    const setupMicButton = (btnId, fieldName, fieldLabel, isSecret = false) => {
      const btn = this.querySelector(btnId);
      if (!btn) return;
      let recording = false;

      btn.addEventListener("click", () => {
        if (!recording) {
          recording = true;
          btn.textContent = "🛑 Stop & Save";
          btn.classList.add("recording-active");
          this.setVoiceStatus(`🎙️ Listening for ${fieldLabel}... Speak at your own pace.`);

          this.voice.startListening(
            (transcript) => {
              recording = false;
              btn.innerHTML = "&#127897; Speak";
              btn.classList.remove("recording-active");
              const cleaned = transcript.trim();

              if (/^(stop speaking|mute|quiet)$/i.test(cleaned)) {
                this.pauseHandsFreeMode("Voice reader paused.");
                return;
              }

              this.store.updateForm({ [fieldName]: cleaned });
              this.pendingConfirmation = { field: fieldName, label: fieldLabel, value: cleaned, isSecret };
              this.voiceStatus = `Captured ${fieldLabel}.`;
              this.render();
              this.voice.speak(
                isSecret
                  ? "Password saved. Select Yes Correct or Edit."
                  : `${this.t("confirmHeardPrefix")} ${cleaned}.`
              );
            },
            (errMsg) => {
              recording = false;
              btn.innerHTML = "&#127897; Speak";
              btn.classList.remove("recording-active");
              this.setVoiceStatus(errMsg || "Could not capture audio. Please try again.");
              this.voice.speak("Could not capture audio. Please try again.");
            }
          );
        } else {
          this.voice.stopListening();
        }
      });
    };

    setupMicButton("#btn-mic-name", "full_name", this.t("fullNameLabel"));
    setupMicButton("#btn-mic-pass", "password", this.t("passwordLabel"), true);
    setupMicButton("#btn-mic-doc", "document_number", this.t("idNumberLabel"));
    setupMicButton("#btn-mic-partner", "partner_name", this.t("partnerNameLabel"));
    setupMicButton("#btn-mic-contact", "contact_value", this.t("contactLabel"));
    setupMicButton("#btn-mic-otp", "otp_code", "OTP Code");

    this.querySelector("#inp-full-name")?.addEventListener("input", (e) => this.store.updateForm({ full_name: e.target.value }));
    this.querySelector("#inp-password")?.addEventListener("input", (e) => this.store.updateForm({ password: e.target.value }));
    this.querySelector("#sel-id-route")?.addEventListener("change", (e) => {
      this.store.updateForm({ identity_route: e.target.value, route_confirmed: true });
      this.render();
    });
    this.querySelector("#inp-doc-num")?.addEventListener("input", (e) => this.store.updateForm({ document_number: e.target.value }));
    this.querySelector("#inp-partner-name")?.addEventListener("input", (e) => this.store.updateForm({ partner_name: e.target.value }));
    this.querySelector("#inp-contact")?.addEventListener("input", (e) => this.store.updateForm({ contact_value: e.target.value, otp_verified: false }));
    this.querySelector("#inp-otp")?.addEventListener("input", (e) => this.store.updateForm({ otp_code: e.target.value }));

    this.querySelector("#btn-send-otp")?.addEventListener("click", () => this.sendOtp());
    this.querySelector("#btn-verify-otp")?.addEventListener("click", () => this.verifyOtp());

    this.querySelectorAll(".chk-support").forEach(chk => chk.addEventListener("change", () => {
      const selected = Array.from(this.querySelectorAll(".chk-support:checked")).map(el => el.value);
      this.store.updateForm({ support_needs: selected });
    }));

    this.querySelectorAll("[data-goto]").forEach(btn => btn.addEventListener("click", () => {
      this.pendingConfirmation = null;
      this.setVoiceStatus("");
      this.store.setStep(parseInt(btn.getAttribute("data-goto"), 10));
      this.render();
      if (this.store.state.preferences.auto_flow) this.runAutoTurn();
      else this.announceCurrentStep();
    }));

    this.querySelector("#btn-read-summary")?.addEventListener("click", () => this.readSummaryAloud());
    this.querySelector("#btn-submit")?.addEventListener("click", () => this.submitRegistration());
    this.querySelector("#btn-restart")?.addEventListener("click", () => {
      localStorage.removeItem(this.store.storageKey);
      localStorage.removeItem("db_session_token");
      window.location.reload();
    });
  }
}

customElements.define("digital-bridge-onboarding", DigitalBridgeOnboarding);