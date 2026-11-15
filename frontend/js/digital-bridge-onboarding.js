(function (global) {
  function getI18n() {
    return global.DigitalBridgeI18n || {
      t: function (_l, k) {
        return String(k);
      },
    };
  }

  function getStateApi() {
    return global.DigitalBridgeState;
  }

  function getVoiceApi() {
    return global.DigitalBridgeVoice;
  }

  class DigitalBridgeOnboarding extends HTMLElement {
    constructor() {
      super();
      var self = this;
      this.I18n = getI18n();
      this.State = getStateApi();
      this.Voice = getVoiceApi();
      this.state = this.State.load();
      this.apiBase = this.getAttribute("api-base") || "http://localhost:8000/api/v1";
      this.voice = new this.Voice.VoiceEngine(this.apiBase, function (vs) {
        self._updateVoiceBadge(vs);
      });
      this.voiceLoopActive = false;
      this.isSubmitting = false;
      this.pendingValue = "";
      this.pendingPassword = "";
      this.spellBuffer = "";
      this.lastError = "";
      this.lastNotice = "";

      this.careers = [];
      this.dashboard = null;
      this.jobs = [];
      this.jobSearchQuery = "";
      this.jobSupportFilter = "";
      this.applyingJobId = null;
      this.showEmployerForm = false;

      this._silenceCount = 0;
      this._globalKeyHandler = this._onGlobalKeyDown.bind(this);
      this._firstGestureHandler = this._onFirstGesture.bind(this);
    }

    connectedCallback() {
      try {
        this.apiBase = this.getAttribute("api-base") || this.apiBase;
        this.voice.apiBase = this.apiBase;

        var attrLang = this.getAttribute("lang");
        if (attrLang && !this.state.data.preferred_language) {
          this.state.data.preferred_language = attrLang === "am" ? "am" : "en";
        }
        this.voice.setLanguage(this.state.data.preferred_language);
        this._applyVisualPrefs();

        var params = new URLSearchParams(global.location.search);
        var resumeToken = params.get("resume");
        if (resumeToken && !this.state.completed) {
          this._resumeFromToken(resumeToken);
        }

        document.addEventListener("keydown", this._globalKeyHandler);
        document.addEventListener("pointerdown", this._firstGestureHandler, { once: true });

        if (this.state.accessToken) {
          this.state.step = 100;
          this.state.substep = "career_dashboard";
          this._loadAccessPathData();
        }

        this.render();
        this._announceLive(this._getCurrentPromptText());
      } catch (err) {
        this.innerHTML =
          '<div role="alert" class="db-error-banner">Load error: ' +
          String(err && err.message ? err.message : err) +
          "</div>";
      }
    }

    disconnectedCallback() {
      this.voiceLoopActive = false;
      this.voice.stopAll();
      document.removeEventListener("keydown", this._globalKeyHandler);
      document.removeEventListener("pointerdown", this._firstGestureHandler);
    }

    get lang() {
      return this.state && this.state.data && this.state.data.preferred_language === "am"
        ? "am"
        : "en";
    }

    _t(key) {
      var args = Array.prototype.slice.call(arguments, 1);
      return this.I18n.t.apply(null, [this.lang, key].concat(args));
    }

    _onFirstGesture() {
      if (!this.state.voiceModeAsked && !this.voiceLoopActive) {
        this.startHandsFreeLoop();
      }
    }

    _onGlobalKeyDown(e) {
      var tag = (e.target && e.target.tagName) || "";
      var inTextInput = ["INPUT", "TEXTAREA", "SELECT"].indexOf(tag) !== -1;

      if (e.key === "Escape") {
        this.voiceLoopActive = false;
        this.voice.stopAll();
        this._announceLive(this._t("pausedStatus"));
        this.render();
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        this.state.voiceReadingEnabled = true;
        this.State.save(this.state);
        this.startHandsFreeLoop();
        return;
      }
      if (inTextInput) {
        return;
      }

      if (e.code === "Space" && tag !== "BUTTON") {
        e.preventDefault();
        this.state.voiceReadingEnabled = true;
        this.State.save(this.state);
        this.startHandsFreeLoop();
        return;
      }

      var sub = this.state.substep || "accessibility_ask";
      if (sub === "accessibility_ask") {
        if (e.key === "y" || e.key === "Y") {
          this._handleTurnInput("yes");
        } else if (e.key === "n" || e.key === "N") {
          this._handleTurnInput("no");
        }
      } else if (sub === "auth_choice") {
        if (e.key === "1") {
          this._handleTurnInput("login");
        } else if (e.key === "2") {
          this._handleTurnInput("signup");
        }
      } else if (sub === "language") {
        if (e.key === "1") {
          this._handleLanguageChoice("en");
        } else if (e.key === "2") {
          this._handleLanguageChoice("am");
        }
      } else if (sub.indexOf("confirm_") === 0) {
        if (e.key === "y" || e.key === "Y") {
          this._handleTurnInput("yes");
        } else if (e.key === "n" || e.key === "N") {
          this._handleTurnInput("no");
        }
      } else if (sub === "id_route" && ["1", "2", "3", "4"].indexOf(e.key) !== -1) {
        this._handleTurnInput(e.key);
      }
    }

    _applyVisualPrefs() {
      var prefs = (this.state && this.state.data && this.state.data.preferences) || {};
      document.body.className = "db-theme-" + (prefs.contrast_mode || "default");
      document.documentElement.style.setProperty(
        "--db-zoom",
        String((prefs.zoom_percent || 100) / 100)
      );
    }

    _announceLive(msg) {
      var el = this.querySelector("#db-aria-live");
      if (el) {
        el.textContent = "";
        setTimeout(function () {
          el.textContent = msg;
        }, 40);
      }
    }

    _updateVoiceBadge(vs) {
      var badge = this.querySelector("#db-voice-status");
      if (!badge) {
        return;
      }
      if (vs.isSpeaking) {
        badge.textContent = this._t("speakingStatus");
      } else if (vs.isListening) {
        badge.textContent = this._t("listeningStatus");
      } else if (!this.voiceLoopActive) {
        badge.textContent = this._t("pausedStatus");
      } else {
        badge.textContent = "";
      }
    }

    async _resumeFromToken(token) {
      try {
        var res = await fetch(this.apiBase + "/onboarding/session/" + encodeURIComponent(token));
        if (!res.ok) {
          return;
        }
        var draft = await res.json();
        this.state.resumeToken = draft.token;
        this.state.step = draft.step || 1;
        this.state.data = Object.assign({}, this.state.data, draft.data || {});
        this.state.substep = this.state.step === 2 ? "id_route" : "name";
        this.State.save(this.state);
        this.render();
      } catch (_e) {}
    }

    async startHandsFreeLoop() {
      if (this.voiceLoopActive) {
        return;
      }
      this.voice.setMuted(false);
      this.voiceLoopActive = true;
      this._silenceCount = 0;

      while (this.voiceLoopActive && !this.isSubmitting) {
        if (this.state.substep === "career_dashboard") {
          var summary = this._getAccessPathVoiceSummary();
          this._announceLive(summary);
          await this.voice.speak(summary, this.lang);
          if (!this.voiceLoopActive) {
            break;
          }
          var cmdRes = await this.voice.listenOnce(this.lang, {
            initialWaitMs: 12000,
            trailingSilenceMs: 2600,
          });
          if (!this.voiceLoopActive) {
            break;
          }
          if (!cmdRes || !cmdRes.transcript) {
            this.voiceLoopActive = false;
            this.render();
            break;
          }
          await this._handleAccessPathVoiceCommand(cmdRes.transcript);
          continue;
        }

        var promptText = this._getCurrentPromptText();
        this._announceLive(promptText);
        await this.voice.speak(promptText, this.lang);
        if (!this.voiceLoopActive || this.isSubmitting) {
          break;
        }

        var res = await this.voice.listenOnce(this.lang, {
          initialWaitMs: 12000,
          trailingSilenceMs: 2600,
        });
        if (!this.voiceLoopActive || this.isSubmitting) {
          break;
        }

        if (!res || !res.transcript) {
          this._silenceCount++;
          var errCode = res ? res.error : "no-speech";
          if (errCode === "not-allowed" || errCode === "unsupported") {
            this.voiceLoopActive = false;
            this.lastError = "Microphone unavailable. You can type and press Enter.";
            this.render();
            await this.voice.speak(this.lastError, this.lang);
            break;
          }
          if (this._silenceCount >= 4) {
            this.voiceLoopActive = false;
            this._announceLive(this._t("pausedStatus"));
            await this.voice.speak(this._t("pausedStatus"), this.lang);
            this.render();
            break;
          }
          await this.voice.speak(this._t("noSpeech"), this.lang);
          continue;
        }

        this._silenceCount = 0;
        await this._handleTurnInput(res.transcript);
      }
    }

    _getCurrentPromptText() {
      var s = this.state.substep || "accessibility_ask";
      var d = this.state.data;
      var labels = this._t("routeLabels") || {};

      if (s === "accessibility_ask") {
        return this._t("welcomeEntry");
      }
      if (s === "auth_choice") {
        return this._t("askAuthChoice");
      }
      if (s === "language") {
        return this._t("askLanguage");
      }
      if (s === "login_name") {
        return this._t("loginNameAsk");
      }
      if (s === "login_password") {
        return this._t("loginPasswordAsk");
      }
      if (s === "name") {
        return this._t("askName");
      }
      if (s === "confirm_name") {
        return this._t("confirmName", this.pendingValue);
      }
      if (s === "spell_name") {
        return this.spellBuffer ? this._t("spellHeard", this.spellBuffer) : this._t("spellIntro");
      }
      if (s === "confirm_spelled_name") {
        return this._t("spellConfirm", this.pendingValue, this.pendingValue.split("").join(", "));
      }
      if (s === "password") {
        return this._t("askPassword");
      }
      if (s === "confirm_password_reenter") {
        return this._t("askPasswordConfirm");
      }
      if (s === "id_route") {
        return this._t("askIdRoute");
      }
      if (s === "confirm_id_route") {
        return this._t("confirmIdRoute", labels[this.pendingValue] || this.pendingValue);
      }
      if (s === "doc_or_partner") {
        return d.identity.route === "partner_referral"
          ? this._t("askPartnerName")
          : this._t("askDocNumber");
      }
      if (s === "confirm_doc_or_partner") {
        return this._t("confirmDocOrPartner", this.pendingValue);
      }
      if (s === "contact") {
        return this._t("askContact");
      }
      if (s === "confirm_contact") {
        return this._t("confirmContact", this.pendingValue);
      }
      if (s === "otp") {
        return this._t("otpSent");
      }
      if (s === "review_submit") {
        var docRef =
          d.identity.route === "partner_referral"
            ? d.identity.partner_name
            : d.identity.document_number;
        return this._t(
          "reviewPrompt",
          d.full_name,
          labels[d.identity.route] || d.identity.route,
          docRef,
          d.identity.contact_value
        );
      }
      if (s === "career_dashboard") {
        return this._getAccessPathVoiceSummary();
      }
      return this._t("welcomeEntry");
    }

    async _handleTurnInput(rawInput) {
      var text = (rawInput || "").trim();
      var n = this.Voice.norm(text);
      var sub = this.state.substep || "accessibility_ask";
      this.lastError = "";
      this.lastNotice = "";

      if (["repeat", "again", "ድገም", "ድገሚ"].indexOf(n) !== -1) {
        return;
      }
      if (["wait", "hold on", "ጠብቅ"].indexOf(n) !== -1) {
        await this.voice.speak(this._t("waitReply"), this.lang);
        await new Promise(function (r) {
          setTimeout(r, 8000);
        });
        return;
      }
      if (["stop", "pause", "mute", "አቁም"].indexOf(n) !== -1) {
        this.voiceLoopActive = false;
        this.voice.stopAll();
        this.render();
        return;
      }
      if (["zoom in", "bigger", "አጉላ"].indexOf(n) !== -1) {
        this._zoomBy(25);
        return;
      }
      if (["zoom out", "smaller", "አሳንስ"].indexOf(n) !== -1) {
        this._zoomBy(-25);
        return;
      }
      if (["contrast", "ንፅፅር"].indexOf(n) !== -1) {
        this._cycleContrast();
        return;
      }
      if (["help", "እርዳታ"].indexOf(n) !== -1) {
        var helpMsg = await this._fetchHelp(text);
        await this.voice.speak(helpMsg, this.lang);
        return;
      }
      if (["back", "previous", "ተመለስ"].indexOf(n) !== -1 && sub !== "accessibility_ask") {
        this._goBack();
        return;
      }

      if (sub === "review_submit" && this.Voice.isSubmitCommand(text)) {
        await this._submitRegistration();
        return;
      }

      switch (sub) {
        case "accessibility_ask":
          this.state.voiceModeAsked = true;
          if (this.Voice.isNo(text)) {
            this.state.voiceReadingEnabled = false;
            this.state.data.preferences.tts_enabled = false;
            this.state.data.preferences.stt_enabled = false;
            this.state.data.preferences.profile_type = "standard";
            this.voiceLoopActive = false;
            this.voice.stopAll();
            this.state.substep = "auth_choice";
          } else {
            this.state.voiceReadingEnabled = true;
            this.state.data.preferences.tts_enabled = true;
            this.state.data.preferences.stt_enabled = true;
            this.state.data.preferences.profile_type = "blind";
            this.state.substep = "auth_choice";
          }
          break;

        case "auth_choice":
          if (
            n.indexOf("1") !== -1 ||
            n.indexOf("login") !== -1 ||
            n.indexOf("log in") !== -1 ||
            n.indexOf("sign in") !== -1 ||
            n.indexOf("ግባ") !== -1
          ) {
            this.state.substep = "login_name";
          } else {
            this.state.substep = "language";
          }
          break;

        case "login_name":
          if (text.length < 2) {
            this.lastError = "Please provide your full name.";
            break;
          }
          this.pendingValue = text;
          this.state.substep = "login_password";
          break;

        case "login_password":
          await this._performLogin(this.pendingValue, text);
          return;

        case "language":
          if (n.indexOf("2") !== -1 || n.indexOf("amhar") !== -1 || n.indexOf("አማርኛ") !== -1) {
            this._handleLanguageChoice("am");
          } else {
            this._handleLanguageChoice("en");
          }
          return;

        case "name":
          if (text.length < 2) {
            this.lastError = "Please say or type at least 2 characters.";
            break;
          }
          this.pendingValue = this.Voice.formatTitleCase(text);
          this.state.substep = "confirm_name";
          break;

        case "confirm_name":
          if (this.Voice.isYes(text)) {
            this.state.data.full_name = this.pendingValue;
            this.pendingValue = "";
            this.state.substep = "password";
          } else if (this.Voice.isNo(text)) {
            this.spellBuffer = "";
            this.pendingValue = "";
            this.state.substep = "spell_name";
          }
          break;

        case "spell_name": {
          var parsed = this.Voice.parseSpelledSegment(text, this.spellBuffer);
          this.spellBuffer = parsed.buffer;
          if (parsed.finished) {
            var cand = this.Voice.formatTitleCase(this.spellBuffer);
            if (cand.length < 2) {
              this.lastError = "Please spell at least 2 letters.";
              this.spellBuffer = "";
            } else {
              this.pendingValue = cand;
              this.state.substep = "confirm_spelled_name";
            }
          }
          break;
        }

        case "confirm_spelled_name":
          if (this.Voice.isYes(text)) {
            this.state.data.full_name = this.pendingValue;
            this.pendingValue = "";
            this.spellBuffer = "";
            this.state.substep = "password";
          } else if (this.Voice.isNo(text)) {
            this.spellBuffer = "";
            this.pendingValue = "";
            this.state.substep = "spell_name";
          } else {
            var extra = this.Voice.parseSpelledSegment(
              text.replace(/^add\s+/i, ""),
              this.spellBuffer + " "
            );
            if (extra.buffer.length > this.spellBuffer.length) {
              this.spellBuffer = extra.buffer;
              this.pendingValue = this.Voice.formatTitleCase(this.spellBuffer);
            }
          }
          break;

        case "password": {
          var digits = this.Voice.parseDigits(text);
          var passCandidate = digits.length >= 4 ? digits : text.replace(/\s+/g, "");
          if (passCandidate.length < 4) {
            this.lastError = this._t("passwordTooShort");
            if (this.state.voiceReadingEnabled) {
              await this.voice.speak(this.lastError, this.lang);
            }
          } else {
            this.pendingPassword = passCandidate;
            this.state.substep = "confirm_password_reenter";
          }
          break;
        }

        case "confirm_password_reenter": {
          var reDigits = this.Voice.parseDigits(text);
          var reEntered = reDigits.length >= 4 ? reDigits : text.replace(/\s+/g, "");
          if (reEntered === this.pendingPassword) {
            this.state.data.password = this.pendingPassword;
            this.pendingPassword = "";
            this.state.step = 2;
            this.state.substep = "id_route";
            if (this.state.voiceReadingEnabled) {
              await this.voice.speak(this._t("passwordConfirmed"), this.lang);
            }
            this.State.syncDraftToServer(this.apiBase, this.state);
          } else {
            this.pendingPassword = "";
            this.lastError = this._t("passwordMismatch");
            this.state.substep = "password";
            if (this.state.voiceReadingEnabled) {
              await this.voice.speak(this.lastError, this.lang);
            }
          }
          break;
        }

        case "id_route":
          if (
            n.indexOf("2") !== -1 ||
            n.indexOf("refugee") !== -1 ||
            n.indexOf("ስደተኛ") !== -1 ||
            n.indexOf("ሁለት") !== -1
          ) {
            this.pendingValue = "refugee_id";
          } else if (
            n.indexOf("3") !== -1 ||
            n.indexOf("alt") !== -1 ||
            n.indexOf("other") !== -1 ||
            n.indexOf("ሌላ") !== -1 ||
            n.indexOf("ሶስት") !== -1
          ) {
            this.pendingValue = "alt_doc";
          } else if (
            n.indexOf("4") !== -1 ||
            n.indexOf("partner") !== -1 ||
            n.indexOf("refer") !== -1 ||
            n.indexOf("አጋር") !== -1 ||
            n.indexOf("አራት") !== -1
          ) {
            this.pendingValue = "partner_referral";
          } else {
            this.pendingValue = "national_kebele_id";
          }
          this.state.substep = "confirm_id_route";
          break;

        case "confirm_id_route":
          if (this.Voice.isYes(text)) {
            this.state.data.identity.route = this.pendingValue;
            this.pendingValue = "";
            this.state.substep = "doc_or_partner";
          } else if (this.Voice.isNo(text)) {
            this.pendingValue = "";
            this.state.substep = "id_route";
          }
          break;

        case "doc_or_partner": {
          var skipWords = ["skip", "none", "no", "ዝለል", "የለኝም"];
          if (skipWords.indexOf(n) !== -1) {
            this.pendingValue =
              this.state.data.identity.route === "partner_referral" ? "Community Partner" : "";
          } else if (this.state.data.identity.route === "partner_referral") {
            this.pendingValue = text;
          } else {
            var docD = this.Voice.parseDigits(text);
            this.pendingValue = docD.length >= 3 ? docD : text;
          }
          this.state.substep = "confirm_doc_or_partner";
          break;
        }

        case "confirm_doc_or_partner":
          if (this.Voice.isYes(text)) {
            if (this.state.data.identity.route === "partner_referral") {
              this.state.data.identity.partner_name = this.pendingValue;
            } else {
              this.state.data.identity.document_number = this.pendingValue;
            }
            this.pendingValue = "";
            this.state.substep = "contact";
          } else if (this.Voice.isNo(text)) {
            this.pendingValue = "";
            this.state.substep = "doc_or_partner";
          }
          break;

        case "contact": {
          var contact = this.Voice.normalizeContact(text);
          if (contact.length < 4) {
            this.lastError = "Please provide a valid phone number or email address.";
            break;
          }
          this.pendingValue = contact;
          this.state.substep = "confirm_contact";
          break;
        }

        case "confirm_contact":
          if (this.Voice.isYes(text)) {
            this.state.data.identity.contact_value = this.pendingValue;
            this.pendingValue = "";
            await this._sendOtp(this.state.data.identity.contact_value);
            this.state.substep = "otp";
          } else if (this.Voice.isNo(text)) {
            this.pendingValue = "";
            this.state.substep = "contact";
          }
          break;

        case "otp": {
          var code = this.Voice.parseDigits(text) || text.replace(/\D/g, "");
          if (code.length < 6) {
            this.lastError = this._t("otpInvalid");
            if (this.state.voiceReadingEnabled) {
              await this.voice.speak(this.lastError, this.lang);
            }
            break;
          }
          var ok = await this._verifyOtp(this.state.data.identity.contact_value, code);
          if (ok) {
            this.state.data.identity.otp_verified = true;
            if (this.state.voiceReadingEnabled) {
              await this.voice.speak(this._t("otpVerified"), this.lang);
            }
            this.state.substep = "review_submit";
            this.State.syncDraftToServer(this.apiBase, this.state);
          } else {
            this.lastError = this._t("otpInvalid");
            if (this.state.voiceReadingEnabled) {
              await this.voice.speak(this.lastError, this.lang);
            }
          }
          break;
        }

        case "review_submit":
          if (
            ["edit", "change", "ቀይር", "አስተካክል"].some(function (k) {
              return n.indexOf(k) !== -1;
            })
          ) {
            this.state.step = 1;
            this.state.substep = "name";
          } else if (this.Voice.isYes(text) || this.Voice.isSubmitCommand(text)) {
            await this._submitRegistration();
          }
          break;
      }

      this.State.save(this.state);
      this.render();
    }

    _handleLanguageChoice(lang) {
      this.state.data.preferred_language = lang;
      this.state.data.preferences.language = lang;
      this.voice.setLanguage(lang);
      if (this.state.substep === "language") {
        this.state.step = 1;
        this.state.substep = "name";
      }
      this.State.save(this.state);
      this.render();
    }

    _goBack() {
      var order = [
        "accessibility_ask",
        "auth_choice",
        "language",
        "name",
        "password",
        "id_route",
        "doc_or_partner",
        "contact",
        "otp",
        "review_submit",
      ];
      var sub = this.state.substep || "accessibility_ask";
      if (sub === "login_name" || sub === "login_password") {
        this.state.substep = sub === "login_password" ? "login_name" : "auth_choice";
        this.State.save(this.state);
        this.render();
        return;
      }
      var baseSub = sub
        .replace(/^confirm_spelled_/, "")
        .replace(/^confirm_password_reenter$/, "password")
        .replace(/^confirm_/, "")
        .replace(/^spell_/, "");
      var idx = order.indexOf(baseSub);
      if (idx > 0) {
        var prev = order[idx - 1];
        this.state.substep = prev;
        if (["accessibility_ask", "auth_choice", "language"].indexOf(prev) !== -1) {
          this.state.step = 0;
        } else if (["name", "password"].indexOf(prev) !== -1) {
          this.state.step = 1;
        } else {
          this.state.step = 2;
        }
      }
      this.State.save(this.state);
      this.render();
    }

    async _performLogin(fullName, password) {
      try {
        var res = await fetch(this.apiBase + "/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_name: fullName, password: password }),
        });
        if (!res.ok) {
          this.lastError = this._t("loginFailed");
          this.state.substep = "login_name";
          this.render();
          if (this.state.voiceReadingEnabled) {
            await this.voice.speak(this.lastError, this.lang);
          }
          return;
        }
        var json = await res.json();
        this.state.accessToken = json.access_token;
        this.state.data.full_name = json.user.full_name;
        this.state.data.preferred_language = json.user.preferred_language || this.lang;
        this.state.data.identity = Object.assign({}, this.state.data.identity, json.user.identity || {});
        this.state.completed = true;
        this.state.step = 100;
        this.state.substep = "career_dashboard";
        this.state.careerTab = "dashboard";
        this.State.save(this.state);
        await this._loadAccessPathData();
        this.render();
        if (this.state.voiceReadingEnabled) {
          await this.voice.speak(this._t("loginSuccess", json.user.full_name), this.lang);
        }
      } catch (_err) {
        this.lastError = "Unable to connect to login service.";
        this.render();
      }
    }

    async _sendOtp(contactValue) {
      try {
        await fetch(this.apiBase + "/onboarding/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_value: contactValue, language: this.lang }),
        });
      } catch (_err) {
        this.lastError = "Could not reach OTP service.";
      }
    }

    async _verifyOtp(contactValue, code) {
      try {
        var res = await fetch(this.apiBase + "/onboarding/verify-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_value: contactValue, code: code }),
        });
        return res.ok;
      } catch (_err) {
        return false;
      }
    }

    async _submitRegistration() {
      if (this.isSubmitting || this.state.completed) {
        return;
      }
      this.isSubmitting = true;
      this.voiceLoopActive = false;
      this.voice.stopListening();
      this.render();

      if (this.state.voiceReadingEnabled) {
        await this.voice.speak(this._t("submitting"), this.lang);
      }

      try {
        var res = await fetch(this.apiBase + "/onboarding/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.state.data),
        });
        if (!res.ok) {
          var errJson = await res.json().catch(function () {
            return {};
          });
          throw new Error(errJson.detail || "Submission failed");
        }
        var result = await res.json();
        this.state.accessToken = result.access_token;
        this.state.completed = true;
        this.state.step = 100;
        this.state.substep = "career_dashboard";
        this.state.careerTab = "dashboard";
        this.state.resumeToken = null;
        this.State.save(this.state);
        this.isSubmitting = false;

        await this._loadAccessPathData();
        this.render();

        var doneMsg = this._t("completed", this.state.data.full_name);
        this._announceLive(doneMsg);
        if (this.state.voiceReadingEnabled) {
          await this.voice.speak(doneMsg, this.lang);
        }
      } catch (err) {
        this.isSubmitting = false;
        this.lastError = (err && err.message) || "Registration error";
        this.render();
        if (this.state.voiceReadingEnabled) {
          await this.voice.speak(this.lastError, this.lang);
        }
      }
    }

    async _loadAccessPathData() {
      var headers = this.state.accessToken
        ? { Authorization: "Bearer " + this.state.accessToken }
        : {};
      try {
        var pathsRes = await fetch(this.apiBase + "/career/paths");
        if (pathsRes.ok) {
          this.careers = (await pathsRes.json()).careers || [];
        }

        if (this.state.accessToken) {
          var dashRes = await fetch(this.apiBase + "/career/dashboard", { headers: headers });
          if (dashRes.ok) {
            this.dashboard = await dashRes.json();
          }
        }

        var jobUrl = this._buildJobsUrl();
        var jobsRes = await fetch(jobUrl);
        if (jobsRes.ok) {
          this.jobs = (await jobsRes.json()).jobs || [];
        }
      } catch (_e) {}
    }

    _buildJobsUrl() {
      var qs = [];
      if (this.jobSupportFilter) {
        qs.push("support=" + encodeURIComponent(this.jobSupportFilter));
      }
      if (this.jobSearchQuery) {
        qs.push("q=" + encodeURIComponent(this.jobSearchQuery));
      }
      return this.apiBase + "/career/jobs" + (qs.length ? "?" + qs.join("&") : "");
    }

    async _selectCareer(careerId) {
      if (!this.state.accessToken) {
        return;
      }
      var res = await fetch(this.apiBase + "/career/select", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.state.accessToken,
        },
        body: JSON.stringify({ career_id: careerId }),
      });
      if (res.ok) {
        await this._loadAccessPathData();
        this.state.careerTab = "roadmap";
        this.State.save(this.state);
        this.lastNotice = "Career path updated! Your personalized roadmap is ready.";
        this.render();
        if (this.state.voiceReadingEnabled) {
          await this.voice.speak(this.lastNotice, this.lang);
        }
      }
    }

    async _toggleStage(careerId, stageId, completed) {
      if (!this.state.accessToken) {
        return;
      }
      var res = await fetch(this.apiBase + "/career/progress", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.state.accessToken,
        },
        body: JSON.stringify({ career_id: careerId, stage_id: stageId, completed: completed }),
      });
      if (res.ok) {
        await this._loadAccessPathData();
        this.lastNotice = completed ? "Stage marked complete." : "Stage marked incomplete.";
        this.render();
        if (this.state.voiceReadingEnabled) {
          await this.voice.speak(this.lastNotice, this.lang);
        }
      }
    }

    _getAccessPathVoiceSummary() {
      var tab = this.state.careerTab || "dashboard";
      var dash = this.dashboard || {};
      var career = dash.selected_career;
      if (tab === "dashboard") {
        return (
          "AccessPath Career Dashboard. Welcome " +
          this.state.data.full_name +
          ". " +
          (career
            ? "Selected career: " +
              career.title +
              ". Progress: " +
              (dash.progress_percent || 0) +
              " percent. " +
              (dash.recommended_next_stage
                ? "Next activity: " + dash.recommended_next_stage.title + ". "
                : "")
            : "No career selected yet. ") +
          "Say Dashboard, Careers, Roadmap, or Jobs to navigate."
        );
      }
      if (tab === "careers") {
        var names = this.careers
          .map(function (c, i) {
            return i + 1 + ": " + c.title;
          })
          .join(". ");
        return "Career Discovery. Say Select followed by a career name or number. " + names;
      }
      if (tab === "roadmap") {
        if (!career) {
          return "No career selected yet. Say Careers to pick one.";
        }
        return (
          "Learning Roadmap for " +
          career.title +
          ". Progress: " +
          (dash.progress_percent || 0) +
          " percent."
        );
      }
      return (
        "Career Opportunities. " +
        this.jobs.length +
        " accessible jobs available. Use search, filters, or apply by voice or typing."
      );
    }

    async _handleAccessPathVoiceCommand(transcript) {
      var n = this.Voice.norm(transcript);
      if (n.indexOf("dashboard") !== -1) {
        this.state.careerTab = "dashboard";
        this.render();
        return;
      }
      if (n.indexOf("career") !== -1 || n.indexOf("discover") !== -1) {
        this.state.careerTab = "careers";
        this.render();
        return;
      }
      if (n.indexOf("roadmap") !== -1 || n.indexOf("progress") !== -1) {
        this.state.careerTab = "roadmap";
        this.render();
        return;
      }
      if (n.indexOf("job") !== -1 || n.indexOf("opportunit") !== -1 || n.indexOf("ስራ") !== -1) {
        this.state.careerTab = "jobs";
        this.render();
        return;
      }
      if (this.state.careerTab === "careers") {
        for (var i = 0; i < this.careers.length; i++) {
          var c = this.careers[i];
          if (n.indexOf(c.title.toLowerCase()) !== -1 || n === String(i + 1)) {
            await this._selectCareer(c.id);
            return;
          }
        }
      }
    }

    async _fetchHelp(prompt) {
      try {
        var res = await fetch(this.apiBase + "/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt, language: this.lang, step: this.state.step || 1 }),
        });
        if (res.ok) {
          return (await res.json()).response;
        }
      } catch (_e) {}
      return "Speak your answer clearly, or type and press Enter.";
    }

    _cycleContrast() {
      var order = ["default", "dark_yellow", "dark_white", "light_yellow"];
      var cur = this.state.data.preferences.contrast_mode || "default";
      this.state.data.preferences.contrast_mode = order[(order.indexOf(cur) + 1) % order.length];
      this.State.save(this.state);
      this._applyVisualPrefs();
      this._announceLive("Contrast set to " + this.state.data.preferences.contrast_mode);
    }

    _zoomBy(delta) {
      var cur = this.state.data.preferences.zoom_percent || 100;
      var next = Math.max(80, Math.min(200, cur + delta));
      this.state.data.preferences.zoom_percent = next;
      this.State.save(this.state);
      this._applyVisualPrefs();
      this.render();
      this._announceLive("Zoom set to " + next + " percent");
    }

    render() {
      try {
        var s = this.state.substep || "accessibility_ask";
        var d = this.state.data;
        var promptText = this._getCurrentPromptText();

        this.innerHTML =
          '<section class="db-widget-root" role="region" aria-label="Digital Bridge and AccessPath">' +
          '<div id="db-aria-live" class="db-sr-only" aria-live="assertive" aria-atomic="true"></div>' +
          '<div class="db-toolbar" role="toolbar" aria-label="Accessibility Controls">' +
          '<button type="button" class="db-btn db-btn-primary" id="db-btn-voice-toggle">' +
          (this.voiceLoopActive ? this._t("btnVoiceToggleOn") : this._t("btnVoiceToggleOff")) +
          "</button>" +
          '<button type="button" class="db-btn" id="db-btn-repeat">' +
          this._t("btnRepeat") +
          "</button>" +
          '<button type="button" class="db-btn" id="db-btn-lang">' +
          this._t("btnLang") +
          "</button>" +
          '<button type="button" class="db-btn" id="db-btn-contrast">' +
          this._t("btnContrast") +
          "</button>" +
          '<button type="button" class="db-btn" id="db-btn-zoom-out">' +
          this._t("btnZoomOut") +
          "</button>" +
          '<button type="button" class="db-btn" id="db-btn-zoom-in">' +
          this._t("btnZoomIn") +
          " (" +
          d.preferences.zoom_percent +
          "%)</button>" +
          "</div>" +
          '<div class="db-status-banner" id="db-voice-status" role="status" aria-live="polite">' +
          (this.voiceLoopActive
            ? this._t("listeningStatus")
            : this.state.voiceReadingEnabled
            ? this._t("pausedStatus")
            : "Standard / Screen-Reader Mode. Press Space or Voice button anytime for hands-free voice.") +
          "</div>" +
          (this.lastNotice
            ? '<div class="db-status-banner" role="status" aria-live="polite">' + this.lastNotice + "</div>"
            : "") +
          (this.lastError
            ? '<div class="db-error-banner" role="alert" aria-live="assertive">' + this.lastError + "</div>"
            : "") +
          (s === "career_dashboard"
            ? this._renderAccessPath()
            : this._renderAuthOrOnboarding(s, d, promptText)) +
          "</section>";

        this._bindEvents();
        var heading = this.querySelector("#db-step-heading");
        if (heading) {
          heading.focus();
        }
      } catch (err) {
        this.innerHTML =
          '<div role="alert" class="db-error-banner">Render error: ' +
          String(err && err.message ? err.message : err) +
          "</div>";
      }
    }

    _renderAuthOrOnboarding(s, d, promptText) {
      var labels = this._t("routeLabels") || {};

      if (s === "accessibility_ask" || s === "auth_choice") {
        return (
          "<div>" +
          '<h2 id="db-step-heading" tabindex="-1">' +
          promptText +
          "</h2>" +
          (s === "accessibility_ask"
            ? '<div class="db-actions-row">' +
              '<button type="button" class="db-btn db-btn-primary" id="db-btn-yes">Yes — Turn On Voice Reading (Y)</button>' +
              '<button type="button" class="db-btn" id="db-btn-no">No — Use Keyboard / Screen Reader (N)</button>' +
              "</div>"
            : "") +
          '<div class="db-card" style="margin-top:1rem;">' +
          '<h3 style="margin-top:0;">Choose Account Action</h3>' +
          '<div class="db-actions-row">' +
          '<button type="button" class="db-btn db-btn-primary" id="db-go-login">1. Login to AccessPath</button>' +
          '<button type="button" class="db-btn db-btn-primary" id="db-go-signup">2. Sign Up (Accessible Registration)</button>' +
          '<button type="button" class="db-btn" id="db-first-contrast">Switch Contrast Theme</button>' +
          "</div>" +
          "</div>" +
          "</div>"
        );
      }

      var stepLabel =
        s.indexOf("login_") === 0
          ? "Login to AccessPath"
          : this.state.step === 2
          ? this._t("step2Title")
          : this._t("step1Title");

      var html = '<form id="db-wizard-form" novalidate>';
      html += '<p style="margin-top:0; font-weight:700;">' + stepLabel + "</p>";
      html += '<h2 id="db-step-heading" tabindex="-1" style="margin-top:0.25rem;">' + promptText + "</h2>";

      if (s === "language") {
        html +=
          '<div class="db-actions-row">' +
          '<button type="button" class="db-btn db-btn-primary" id="db-pick-en">1. English</button>' +
          '<button type="button" class="db-btn db-btn-primary" id="db-pick-am">2. አማርኛ (Amharic)</button>' +
          "</div>";
      }

      var textInputSteps = [
        "login_name",
        "login_password",
        "name",
        "spell_name",
        "password",
        "confirm_password_reenter",
        "doc_or_partner",
        "contact",
        "otp",
      ];
      if (textInputSteps.indexOf(s) !== -1) {
        var isPass = s === "password" || s === "confirm_password_reenter" || s === "login_password";
        html +=
          '<div style="margin-top:1rem;">' +
          '<label for="db-text-input" class="db-sr-only">' +
          promptText +
          "</label>" +
          '<input id="db-text-input" class="db-input" type="' +
          (isPass ? "password" : "text") +
          '" autocomplete="off" placeholder="' +
          (s === "spell_name"
            ? "Type or spell letters (e.g. A B E B E done)"
            : "Type or dictate your answer") +
          '" value="' +
          (s === "spell_name" ? this.spellBuffer : "") +
          '" />' +
          "</div>";
      }

      if (s === "id_route") {
        html +=
          '<fieldset style="border:none; padding:0; margin:1rem 0;">' +
          '<legend class="db-sr-only">Verification Route</legend>' +
          '<button type="button" class="db-option-card db-route-btn" data-route="1">1. ' +
          labels.national_kebele_id +
          "</button>" +
          '<button type="button" class="db-option-card db-route-btn" data-route="2">2. ' +
          labels.refugee_id +
          "</button>" +
          '<button type="button" class="db-option-card db-route-btn" data-route="3">3. ' +
          labels.alt_doc +
          "</button>" +
          '<button type="button" class="db-option-card db-route-btn" data-route="4">4. ' +
          labels.partner_referral +
          "</button>" +
          "</fieldset>";
      }

      if (s.indexOf("confirm_") === 0 && s !== "confirm_password_reenter") {
        html +=
          '<div class="db-actions-row">' +
          '<button type="button" class="db-btn db-btn-primary" id="db-btn-yes">Yes / አዎ (Y)</button>' +
          '<button type="button" class="db-btn" id="db-btn-no">No — Spell / Retry (N)</button>' +
          "</div>";
      }

      if (s === "review_submit") {
        var docRef =
          d.identity.route === "partner_referral"
            ? d.identity.partner_name
            : d.identity.document_number;
        html +=
          '<div class="db-status-banner">' +
          '<p style="margin:0.25rem 0;"><strong>Name:</strong> ' +
          d.full_name +
          "</p>" +
          '<p style="margin:0.25rem 0;"><strong>ID Route:</strong> ' +
          (labels[d.identity.route] || d.identity.route) +
          "</p>" +
          (docRef ? '<p style="margin:0.25rem 0;"><strong>Reference:</strong> ' + docRef + "</p>" : "") +
          '<p style="margin:0.25rem 0;"><strong>Contact:</strong> ' +
          d.identity.contact_value +
          "</p>" +
          "</div>";
      }

      html += '<div class="db-actions-row">';
      html += '<button type="button" class="db-btn" id="db-btn-back">' + this._t("btnBack") + "</button>";
      if (s === "review_submit") {
        html += '<button type="submit" class="db-btn db-btn-primary">' + this._t("btnSubmit") + "</button>";
      } else if (
        ["language", "id_route"].indexOf(s) === -1 &&
        (s.indexOf("confirm_") !== 0 || s === "confirm_password_reenter")
      ) {
        html += '<button type="submit" class="db-btn db-btn-primary">' + this._t("btnNext") + "</button>";
      }
      html += "</div></form>";
      return html;
    }

    _renderAccessPath() {
      var tab = this.state.careerTab || "dashboard";
      var dash = this.dashboard || {};
      var user = dash.user || this.state.data;
      var career = dash.selected_career;
      var pct = dash.progress_percent || 0;
      var completedIds = dash.completed_stage_ids || [];

      var nav =
        '<nav aria-label="AccessPath Navigation" class="db-actions-row" style="margin-bottom:1.25rem;">' +
        '<button type="button" class="db-btn ' +
        (tab === "dashboard" ? "db-btn-primary" : "") +
        '" data-tab="dashboard">Dashboard</button>' +
        '<button type="button" class="db-btn ' +
        (tab === "careers" ? "db-btn-primary" : "") +
        '" data-tab="careers">Explore Careers (6)</button>' +
        '<button type="button" class="db-btn ' +
        (tab === "roadmap" ? "db-btn-primary" : "") +
        '" data-tab="roadmap">My Learning Roadmap</button>' +
        '<button type="button" class="db-btn ' +
        (tab === "jobs" ? "db-btn-primary" : "") +
        '" data-tab="jobs">Career Opportunities</button>' +
        '<button type="button" class="db-btn" id="db-btn-logout">Logout</button>' +
        "</nav>";

      if (tab === "careers") {
        var cards = this.careers
          .map(function (c, i) {
            var isSelected = career && career.id === c.id;
            return (
              '<article class="db-card">' +
              '<h3 style="margin-top:0;">' +
              (i + 1) +
              ". " +
              c.title +
              (isSelected ? " (Selected)" : "") +
              "</h3>" +
              "<p>" +
              c.description +
              "</p>" +
              "<p><strong>Required Skills:</strong> " +
              c.required_skills.join(", ") +
              "</p>" +
              "<p><strong>Learning Requirements:</strong> " +
              c.learning_requirements +
              "</p>" +
              "<p><strong>Opportunities:</strong> " +
              c.opportunities.join(", ") +
              "</p>" +
              "<p><strong>Roadmap Stages:</strong> " +
              c.roadmap.length +
              " stages</p>" +
              '<button type="button" class="db-btn db-btn-primary db-select-career" data-career-id="' +
              c.id +
              '">' +
              (isSelected ? "View Roadmap" : "Select " + c.title) +
              "</button>" +
              "</article>"
            );
          })
          .join("");
        return (
          nav +
          '<h2 id="db-step-heading" tabindex="-1">Career Discovery &amp; Selection</h2><div class="db-grid">' +
          cards +
          "</div>"
        );
      }

      if (tab === "roadmap") {
        if (!career) {
          return (
            nav +
            '<h2 id="db-step-heading" tabindex="-1">Personalized Learning Roadmap</h2>' +
            "<p>You have not selected a career path yet.</p>" +
            '<button type="button" class="db-btn db-btn-primary" data-tab="careers">Explore Careers Now</button>'
          );
        }
        var stagesHtml = career.roadmap
          .map(function (st, idx) {
            var isDone = completedIds.indexOf(st.id) !== -1;
            return (
              '<article class="db-card">' +
              '<h3 style="margin-top:0;">Stage ' +
              (idx + 1) +
              ": " +
              st.title +
              " — " +
              (isDone ? "Completed" : "In Progress") +
              "</h3>" +
              "<p><strong>Objectives:</strong> " +
              st.objectives +
              "</p>" +
              "<p><strong>Skills:</strong> " +
              st.skills.join(", ") +
              "</p>" +
              "<p><strong>Resources:</strong> " +
              st.resources +
              "</p>" +
              '<button type="button" class="db-btn ' +
              (isDone ? "" : "db-btn-primary") +
              ' db-toggle-stage" data-career-id="' +
              career.id +
              '" data-stage-id="' +
              st.id +
              '" data-next="' +
              !isDone +
              '">' +
              (isDone ? "Mark Incomplete" : "Mark Stage Completed") +
              "</button>" +
              "</article>"
            );
          })
          .join("");
        return (
          nav +
          '<h2 id="db-step-heading" tabindex="-1">Roadmap: ' +
          career.title +
          " (" +
          pct +
          "% Complete)</h2>" +
          '<div class="db-progress-bar" role="progressbar" aria-valuenow="' +
          pct +
          '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="db-progress-fill" style="width:' +
          pct +
          '%;"></div></div>' +
          '<div style="margin-top:1rem;">' +
          stagesHtml +
          "</div>"
        );
      }

      if (tab === "jobs") {
        var self = this;
        var jobsHtml = this.jobs.length
          ? this.jobs
              .map(function (j) {
                var isApplying = self.applyingJobId === j.id;
                return (
                  '<article class="db-card">' +
                  '<h3 style="margin-top:0;">' +
                  j.title +
                  " — " +
                  j.hiringOrganization.name +
                  "</h3>" +
                  "<p><strong>Location:</strong> " +
                  j.jobLocationType +
                  "</p>" +
                  "<p>" +
                  j.description +
                  "</p>" +
                  "<p><strong>Accommodations Offered:</strong> " +
                  (j.accommodations_offered || []).join(", ") +
                  "</p>" +
                  '<button type="button" class="db-btn db-btn-primary db-open-apply" data-job-id="' +
                  j.id +
                  '">' +
                  (isApplying ? "Close Application Form" : "Apply (Voice or Typing)") +
                  "</button>" +
                  (isApplying
                    ? '<form class="db-apply-form" data-job-id="' +
                      j.id +
                      '" style="margin-top:1rem;">' +
                      '<label for="db-app-pitch"><strong>Your Application Pitch (Type or Dictate):</strong></label>' +
                      '<textarea id="db-app-pitch" class="db-textarea" required placeholder="Explain why you are a good fit..."></textarea>' +
                      '<div class="db-actions-row"><button type="button" class="db-btn" id="db-dictate-pitch">Dictate Pitch by Voice</button></div>' +
                      '<label for="db-app-accom" style="display:block;margin-top:0.75rem;"><strong>Interview Accommodation Request (Optional, No Medical Proof):</strong></label>' +
                      '<input id="db-app-accom" class="db-input" type="text" placeholder="e.g., Screen-reader test, extra time, Amharic interpreter" />' +
                      '<div class="db-actions-row">' +
                      '<button type="button" class="db-btn" id="db-dictate-accom">Dictate Accommodation</button>' +
                      '<button type="submit" class="db-btn db-btn-primary">Submit Job Application</button>' +
                      "</div></form>"
                    : "") +
                  "</article>"
                );
              })
              .join("")
          : '<p class="db-card">No matching jobs found. Try clearing filters or posting an employer opportunity.</p>';

        return (
          nav +
          '<h2 id="db-step-heading" tabindex="-1">Career Opportunities &amp; Accessible Job Gateway</h2>' +
          '<form id="db-job-filter-form" class="db-card">' +
          '<label for="db-job-q"><strong>Search Jobs (Type or Voice):</strong></label>' +
          '<input id="db-job-q" class="db-input" type="text" value="' +
          this.jobSearchQuery +
          '" placeholder="e.g., developer, support, analyst" />' +
          '<label for="db-job-support" style="display:block;margin-top:0.75rem;"><strong>Private "Support I Need" Filter:</strong></label>' +
          '<select id="db-job-support" class="db-select">' +
          '<option value="">All inclusive jobs</option>' +
          '<option value="screen_reader_compatible" ' +
          (this.jobSupportFilter === "screen_reader_compatible" ? "selected" : "") +
          ">Screen-reader compatible (NVDA / TalkBack)</option>" +
          '<option value="flexible_hours" ' +
          (this.jobSupportFilter === "flexible_hours" ? "selected" : "") +
          ">Flexible hours</option>" +
          '<option value="voice_first_tools" ' +
          (this.jobSupportFilter === "voice_first_tools" ? "selected" : "") +
          ">Voice-first tools</option>" +
          '<option value="jaws_nvda_provided" ' +
          (this.jobSupportFilter === "jaws_nvda_provided" ? "selected" : "") +
          ">JAWS / NVDA provided</option>" +
          '<option value="audio_training" ' +
          (this.jobSupportFilter === "audio_training" ? "selected" : "") +
          ">Audio training</option>" +
          "</select>" +
          '<div class="db-actions-row">' +
          '<button type="submit" class="db-btn db-btn-primary">Search / Apply Filter</button>' +
          '<button type="button" class="db-btn" id="db-dictate-job-search">Dictate Search</button>' +
          '<button type="button" class="db-btn" id="db-toggle-employer">' +
          (this.showEmployerForm ? "Hide Employer Form" : "Employer: Post Inclusive Job") +
          "</button>" +
          "</div></form>" +
          (this.showEmployerForm
            ? '<form id="db-employer-form" class="db-card">' +
              '<h3 style="margin-top:0;">Employer Form — Post Job &amp; Accommodations</h3>' +
              '<label for="db-emp-title">Job Title</label>' +
              '<input id="db-emp-title" class="db-input" required />' +
              '<label for="db-emp-name" style="display:block;margin-top:0.5rem;">Employer Name</label>' +
              '<input id="db-emp-name" class="db-input" required />' +
              '<label for="db-emp-loc" style="display:block;margin-top:0.5rem;">Location</label>' +
              '<input id="db-emp-loc" class="db-input" value="Addis Ababa / Remote" required />' +
              '<label for="db-emp-desc" style="display:block;margin-top:0.5rem;">Description</label>' +
              '<textarea id="db-emp-desc" class="db-textarea" required></textarea>' +
              '<label for="db-emp-accom" style="display:block;margin-top:0.5rem;">Accommodations Offered (comma-separated)</label>' +
              '<input id="db-emp-accom" class="db-input" value="screen_reader_compatible, flexible_hours" />' +
              '<div class="db-actions-row"><button type="submit" class="db-btn db-btn-primary">Publish Accessible Job</button></div>' +
              "</form>"
            : "") +
          jobsHtml
        );
      }

      return (
        nav +
        '<h2 id="db-step-heading" tabindex="-1">Welcome to AccessPath, ' +
        this.state.data.full_name +
        "</h2>" +
        '<div class="db-grid">' +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Selected Career &amp; Progress</h3>' +
        "<p><strong>Career Path:</strong> " +
        (career ? career.title : "Not selected yet") +
        "</p>" +
        "<p><strong>Progress:</strong> " +
        pct +
        "% (" +
        (dash.completed_count || 0) +
        " of " +
        (dash.total_stages || 0) +
        " stages)</p>" +
        '<div class="db-progress-bar" role="progressbar" aria-valuenow="' +
        pct +
        '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="db-progress-fill" style="width:' +
        pct +
        '%;"></div></div>' +
        "<p style='margin-top:0.75rem;'><strong>Recommended Next Activity:</strong> " +
        (dash.recommended_next_stage
          ? dash.recommended_next_stage.title
          : career
          ? "All stages complete! Explore jobs."
          : "Explore the 6 career pathways.") +
        "</p>" +
        '<div class="db-actions-row">' +
        (career
          ? '<button type="button" class="db-btn db-btn-primary" data-tab="roadmap">Resume Roadmap</button>'
          : '<button type="button" class="db-btn db-btn-primary" data-tab="careers">Explore 6 Careers</button>') +
        "</div></section>" +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Profile &amp; Accessibility</h3>' +
        "<p><strong>Name:</strong> " +
        (user.full_name || this.state.data.full_name) +
        "</p>" +
        "<p><strong>Language:</strong> " +
        (this.lang === "am" ? "Amharic" : "English") +
        "</p>" +
        "<p><strong>Contrast:</strong> " +
        this.state.data.preferences.contrast_mode +
        "</p>" +
        "<p><strong>Zoom:</strong> " +
        this.state.data.preferences.zoom_percent +
        "%</p>" +
        "<p><strong>Acquired Skills:</strong> " +
        (dash.acquired_skills && dash.acquired_skills.length
          ? dash.acquired_skills.join(", ")
          : "Complete stages to build skills") +
        "</p>" +
        "</section></div>"
      );
    }

    _bindEvents() {
      var self = this;
      var on = function (sel, fn) {
        var el = self.querySelector(sel);
        if (el) {
          el.addEventListener("click", fn);
        }
      };

      on("#db-btn-voice-toggle", function () {
        if (self.voiceLoopActive) {
          self.voiceLoopActive = false;
          self.voice.stopAll();
          self.render();
        } else {
          self.state.voiceReadingEnabled = true;
          self.State.save(self.state);
          self.startHandsFreeLoop();
        }
      });
      on("#db-btn-repeat", function () {
        self.voice.speak(self._getCurrentPromptText(), self.lang);
      });
      on("#db-btn-lang", function () {
        self._handleLanguageChoice(self.lang === "en" ? "am" : "en");
      });
      on("#db-btn-contrast", function () {
        self._cycleContrast();
      });
      on("#db-first-contrast", function () {
        self._cycleContrast();
      });
      on("#db-btn-zoom-out", function () {
        self._zoomBy(-25);
      });
      on("#db-btn-zoom-in", function () {
        self._zoomBy(25);
      });
      on("#db-btn-back", function () {
        self._goBack();
      });
      on("#db-go-login", function () {
        self.state.substep = "login_name";
        self.State.save(self.state);
        self.render();
      });
      on("#db-go-signup", function () {
        self.state.substep = "language";
        self.State.save(self.state);
        self.render();
      });
      on("#db-pick-en", function () {
        self._handleLanguageChoice("en");
      });
      on("#db-pick-am", function () {
        self._handleLanguageChoice("am");
      });
      on("#db-btn-yes", function () {
        self._handleTurnInput("yes");
      });
      on("#db-btn-no", function () {
        self._handleTurnInput("no");
      });
      on("#db-btn-logout", function () {
        self.voiceLoopActive = false;
        self.voice.stopAll();
        self.state = self.State.resetAll();
        self.dashboard = null;
        self.render();
      });

      this.querySelectorAll(".db-route-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          self._handleTurnInput(btn.getAttribute("data-route"));
        });
      });

      this.querySelectorAll("[data-tab]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          self.state.careerTab = btn.getAttribute("data-tab");
          self.State.save(self.state);
          await self._loadAccessPathData();
          self.render();
        });
      });

      this.querySelectorAll(".db-select-career").forEach(function (btn) {
        btn.addEventListener("click", function () {
          self._selectCareer(btn.getAttribute("data-career-id"));
        });
      });

      this.querySelectorAll(".db-toggle-stage").forEach(function (btn) {
        btn.addEventListener("click", function () {
          self._toggleStage(
            btn.getAttribute("data-career-id"),
            btn.getAttribute("data-stage-id"),
            btn.getAttribute("data-next") === "true"
          );
        });
      });

      var jobFilterForm = this.querySelector("#db-job-filter-form");
      if (jobFilterForm) {
        jobFilterForm.addEventListener("submit", async function (e) {
          e.preventDefault();
          var qEl = self.querySelector("#db-job-q");
          var supEl = self.querySelector("#db-job-support");
          self.jobSearchQuery = qEl ? qEl.value.trim() : "";
          self.jobSupportFilter = supEl ? supEl.value : "";
          await self._loadAccessPathData();
          self.render();
        });
      }

      on("#db-dictate-job-search", async function () {
        await self.voice.speak("Say a job title or skill to search.", self.lang);
        var r = await self.voice.listenOnce(self.lang);
        if (r && r.transcript) {
          self.jobSearchQuery = r.transcript;
          await self._loadAccessPathData();
          self.render();
        }
      });

      on("#db-toggle-employer", function () {
        self.showEmployerForm = !self.showEmployerForm;
        self.render();
      });

      var empForm = this.querySelector("#db-employer-form");
      if (empForm) {
        empForm.addEventListener("submit", async function (e) {
          e.preventDefault();
          var title = self.querySelector("#db-emp-title").value.trim();
          var employer = self.querySelector("#db-emp-name").value.trim();
          var location = self.querySelector("#db-emp-loc").value.trim();
          var desc = self.querySelector("#db-emp-desc").value.trim();
          var accomRaw = self.querySelector("#db-emp-accom").value;
          var accoms = accomRaw
            .split(",")
            .map(function (s) {
              return s.trim();
            })
            .filter(Boolean);

          var res = await fetch(self.apiBase + "/career/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: title,
              employer_name: employer,
              location: location,
              description: desc,
              accommodations_offered: accoms,
            }),
          });
          if (res.ok) {
            self.showEmployerForm = false;
            self.lastNotice = "Job posting published with accommodations.";
            await self._loadAccessPathData();
            self.render();
          }
        });
      }

      this.querySelectorAll(".db-open-apply").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-job-id");
          self.applyingJobId = self.applyingJobId === id ? null : id;
          self.render();
        });
      });

      on("#db-dictate-pitch", async function () {
        await self.voice.speak("Speak your application pitch after the tone.", self.lang);
        var r = await self.voice.listenOnce(self.lang, {
          initialWaitMs: 12000,
          trailingSilenceMs: 2800,
        });
        var pitchEl = self.querySelector("#db-app-pitch");
        if (pitchEl && r && r.transcript) {
          pitchEl.value = (pitchEl.value ? pitchEl.value + " " : "") + r.transcript;
        }
      });

      on("#db-dictate-accom", async function () {
        await self.voice.speak("Speak any interview accommodations you need.", self.lang);
        var r = await self.voice.listenOnce(self.lang, {
          initialWaitMs: 12000,
          trailingSilenceMs: 2800,
        });
        var acEl = self.querySelector("#db-app-accom");
        if (acEl && r && r.transcript) {
          acEl.value = r.transcript;
        }
      });

      this.querySelectorAll(".db-apply-form").forEach(function (form) {
        form.addEventListener("submit", async function (e) {
          e.preventDefault();
          var jobId = form.getAttribute("data-job-id");
          var pitch = self.querySelector("#db-app-pitch").value.trim();
          var accom = self.querySelector("#db-app-accom").value.trim();
          var headers = { "Content-Type": "application/json" };
          if (self.state.accessToken) {
            headers.Authorization = "Bearer " + self.state.accessToken;
          }
          var res = await fetch(self.apiBase + "/career/apply", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
              job_id: jobId,
              applicant_name: self.state.data.full_name,
              applicant_contact: self.state.data.identity.contact_value || "registered-user",
              voice_pitch_transcript: pitch,
              interview_accommodations: accom,
              support_needs: self.state.data.support_needs,
            }),
          });
          if (res.ok) {
            self.applyingJobId = null;
            self.lastNotice = "Job application submitted successfully.";
            self.render();
            if (self.state.voiceReadingEnabled) {
              await self.voice.speak(self.lastNotice, self.lang);
            }
          }
        });
      });

      var wizForm = this.querySelector("#db-wizard-form");
      if (wizForm) {
        wizForm.addEventListener("submit", async function (e) {
          e.preventDefault();
          if (self.state.substep === "review_submit") {
            await self._submitRegistration();
            return;
          }
          var input = self.querySelector("#db-text-input");
          if (input) {
            var val = input.value.trim();
            if (self.state.substep === "spell_name") {
              await self._handleTurnInput(/done$/i.test(val) ? val : val + " done");
            } else {
              await self._handleTurnInput(val);
            }
          }
        });
      }
    }
  }

  if (!global.customElements.get("digital-bridge-onboarding")) {
    global.customElements.define("digital-bridge-onboarding", DigitalBridgeOnboarding);
  }
})(window);