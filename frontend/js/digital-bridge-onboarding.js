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

  // Every value interpolated into innerHTML must pass through this helper.
  var ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function esc(value) {
    return String(value === null || value === undefined ? "" : value).replace(
      /[&<>"']/g,
      function (ch) {
        return ESCAPE_MAP[ch];
      }
    );
  }

  var THEME_MODES = ["default", "dark_yellow", "light_yellow", "dark_white", "custom"];

  class DigitalBridgeOnboarding extends HTMLElement {
    constructor() {
      super();
      var self = this;
      this.I18n = getI18n();
      this.State = getStateApi();
      this.Voice = getVoiceApi();
      this.state = this.State.load();
      this.apiBase =
        this.getAttribute("api-base") ||
        global.SELAMPATH_API_BASE ||
        "http://localhost:8000/api/v1";
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
      this.passport = null;
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
        if (
          attrLang &&
          !this.state.accessToken &&
          this.state.step === 0 &&
          (attrLang === "am" || attrLang === "en")
        ) {
          this.state.data.preferred_language = attrLang;
          this.state.data.preferences.language = attrLang;
        }
        // A passcode is never persisted, so a reload mid-confirmation restarts that step.
        if (this.state.substep === "confirm_password_reenter" && !this.pendingPassword) {
          this.state.substep = "password";
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
          esc(err && err.message ? err.message : err) +
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
      var mode = THEME_MODES.indexOf(prefs.contrast_mode) !== -1 ? prefs.contrast_mode : "default";
      var kept = Array.prototype.slice.call(this.classList).filter(function (name) {
        return name.indexOf("db-theme-") !== 0;
      });
      kept.push("db-theme-" + mode);
      this.className = kept.join(" ");

      var zoom = Math.max(80, Math.min(200, Number(prefs.zoom_percent) || 100)) / 100;
      this.style.setProperty("--db-zoom", String(zoom));

      if (mode === "custom") {
        var bg = /^#[0-9a-fA-F]{6}$/.test(prefs.custom_bg || "") ? prefs.custom_bg : "#000000";
        var fg = /^#[0-9a-fA-F]{6}$/.test(prefs.custom_fg || "") ? prefs.custom_fg : "#FFFFFF";
        this.style.setProperty("--db-bg", bg);
        this.style.setProperty("--db-card-bg", bg);
        this.style.setProperty("--db-fg", fg);
        this.style.setProperty("--db-border", fg);
        this.style.setProperty("--db-accent", fg);
        this.style.setProperty("--db-accent-fg", bg);
      } else {
        ["--db-bg", "--db-card-bg", "--db-fg", "--db-border", "--db-accent", "--db-accent-fg"].forEach(
          function (name) {
            this.style.removeProperty(name);
          }.bind(this)
        );
      }
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
          var passCandidate = digits.length >= 8 ? digits : text.replace(/\s+/g, "");
          if (passCandidate.length < 8) {
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
          var reEntered = reDigits.length >= 8 ? reDigits : text.replace(/\s+/g, "");
          if (reEntered === this.pendingPassword) {
            // Hold the passcode in memory only; it is never written to localStorage.
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
            var otpSent = await this._sendOtp(this.state.data.identity.contact_value);
            if (!otpSent) {
              break;
            }
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
          var errBody = await res.json().catch(function () {
            return {};
          });
          this.lastError =
            res.status === 429 && typeof errBody.detail === "string"
              ? errBody.detail
              : this._t("loginFailed");
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
        var res = await fetch(this.apiBase + "/onboarding/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_value: contactValue, language: this.lang }),
        });
        if (!res.ok) {
          var json = await res.json().catch(function () {
            return {};
          });
          this.lastError =
            typeof json.detail === "string"
              ? json.detail
              : "The verification code could not be sent. Please try again in a minute.";
          return false;
        }
        return true;
      } catch (_err) {
        this.lastError = "Could not reach the verification service. Check your connection and try again.";
        return false;
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
      if (!this.pendingPassword) {
        this.state.substep = "password";
        this.lastError = this._t("askPassword");
        this.State.save(this.state);
        this.render();
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
        var payload = Object.assign({}, this.state.data, { password: this.pendingPassword });
        var res = await fetch(this.apiBase + "/onboarding/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          var errJson = await res.json().catch(function () {
            return {};
          });
          var detail =
            typeof errJson.detail === "string"
              ? errJson.detail
              : "Registration could not be completed. Please review your details and try again.";
          throw new Error(detail);
        }
        var result = await res.json();
        this.state.accessToken = result.access_token;
        this.state.completed = true;
        this.state.step = 100;
        this.state.substep = "career_dashboard";
        this.state.careerTab = "dashboard";
        this.state.resumeToken = null;
        this.pendingPassword = "";
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
          if (dashRes.status === 401 || dashRes.status === 403) {
            this._handleSessionExpired();
            return;
          }
          if (dashRes.ok) {
            this.dashboard = await dashRes.json();
          }

          var passportRes = await fetch(this.apiBase + "/career/passport", { headers: headers });
          if (passportRes.status === 401 || passportRes.status === 403) {
            this._handleSessionExpired();
            return;
          }
          if (passportRes.ok) {
            this.passport = await passportRes.json();
          }
        }

        var jobUrl = this._buildJobsUrl();
        var jobsRes = await fetch(jobUrl);
        if (jobsRes.ok) {
          this.jobs = (await jobsRes.json()).jobs || [];
        }
      } catch (_e) {
        this.lastError = "Some information could not be loaded. Check your connection and try again.";
      }
    }

    _handleSessionExpired() {
      this.voiceLoopActive = false;
      this.voice.stopAll();
      this.state.accessToken = null;
      this.state.completed = false;
      this.state.step = 0;
      this.state.substep = "auth_choice";
      this.state.careerTab = "dashboard";
      this.dashboard = null;
      this.passport = null;
      this.jobs = [];
      this.pendingPassword = "";
      this.lastNotice = "Your session expired. Please log in again to continue.";
      this.State.save(this.state);
      this.render();
      this._announceLive(this.lastNotice);
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
      if (res.status === 401 || res.status === 403) {
        this._handleSessionExpired();
        return;
      }
      if (res.ok) {
        await this._loadAccessPathData();
        this.state.careerTab = "roadmap";
        this.State.save(this.state);
        this.lastNotice = "Career path updated! Your personalized roadmap is ready.";
        this.render();
        if (this.state.voiceReadingEnabled) {
          await this.voice.speak(this.lastNotice, this.lang);
        }
      } else {
        this.lastError = "Your career path could not be updated. Please try again.";
        this.render();
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
      if (res.status === 401 || res.status === 403) {
        this._handleSessionExpired();
        return;
      }
      if (res.ok) {
        await this._loadAccessPathData();
        this.lastNotice = completed ? "Stage marked complete." : "Stage marked incomplete.";
        this.render();
        if (this.state.voiceReadingEnabled) {
          await this.voice.speak(this.lastNotice, this.lang);
        }
      } else {
        this.lastError = "The learning stage could not be updated. Please try again.";
        this.render();
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
          "Say Dashboard, Careers, Roadmap, Passport, or Jobs to navigate."
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
      if (tab === "passport") {
        var passport = this.passport || {};
        var passportCareer = passport.career ? passport.career.title : "no career selected";
        return (
          "Career Passport. " +
          "Path: " +
          passportCareer +
          ". Readiness: " +
          ((passport.readiness && passport.readiness.label) || "exploring pathways") +
          ". Progress: " +
          (passport.progress_percent || 0) +
          " percent. Say Copy Passport or Print Passport."
        );
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
      if (
        (n.indexOf("career") !== -1 || n.indexOf("discover") !== -1) &&
        n.indexOf("passport") === -1
      ) {
        this.state.careerTab = "careers";
        this.render();
        return;
      }
      if (n.indexOf("roadmap") !== -1 || n.indexOf("progress") !== -1) {
        this.state.careerTab = "roadmap";
        this.render();
        return;
      }
      if (n.indexOf("passport") !== -1 && (n.indexOf("copy") !== -1 || n.indexOf("share") !== -1)) {
        if (!this.passport) {
          return;
        }
        try {
          await this._copyToClipboard(this._passportText());
          this.lastNotice = "Career Passport summary copied. Share it only with employers you trust.";
          this.render();
          this._announceLive(this.lastNotice);
        } catch (_err) {
          this.lastError = "Copy is not available in this browser. Use Print / Save as PDF instead.";
          this.render();
        }
        return;
      }
      if (n.indexOf("passport") !== -1 && (n.indexOf("print") !== -1 || n.indexOf("pdf") !== -1)) {
        window.print();
        return;
      }
      if (n.indexOf("passport") !== -1) {
        this.state.careerTab = "passport";
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
        var isDashboard = s === "career_dashboard";
        var tab = this.state.careerTab || "dashboard";

        // Lucide icons (consistent: 24 viewBox, stroke currentColor, stroke-width 2, round caps)
        function icon(name) {
          var paths = {
            mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
            languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
            zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
            zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
            logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
            dashboard: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
            compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
            map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.2-2.1a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
            passport: '<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
            briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>'
          };
          return '<svg class="db-nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths[name] + "</svg>";
        }

        var voiceLabel = this.voiceLoopActive ? "Voice: On" : "Voice guidance";
        var zoomPct = esc(Math.max(80, Math.min(200, Number(d.preferences.zoom_percent) || 100)));
        var toolbar =
          '<div class="db-topnav-actions" role="toolbar" aria-label="Accessibility controls">' +
          '<button type="button" class="db-btn db-btn-voice" id="db-btn-voice-toggle" aria-pressed="' + (this.voiceLoopActive ? "true" : "false") + '" title="' + esc(voiceLabel) + '">' +
          '<span class="db-mic-icon" aria-hidden="true">' + icon("mic") + "</span>" +
          '<span class="db-voice-label">' + esc(voiceLabel) + "</span>" +
          "</button>" +
          '<button type="button" class="db-btn db-icon-btn" id="db-btn-lang" title="' + esc(this._t("btnLang")) + '" aria-label="' + esc(this._t("btnLang")) + '">' + icon("languages") + "</button>" +
          '<button type="button" class="db-btn db-icon-btn" id="db-btn-zoom-out" title="' + esc(this._t("btnZoomOut")) + " (" + zoomPct + '%)" aria-label="' + esc(this._t("btnZoomOut")) + " (" + zoomPct + '%)">' + icon("zoomOut") + "</button>" +
          '<button type="button" class="db-btn db-icon-btn" id="db-btn-zoom-in" title="' + esc(this._t("btnZoomIn")) + " (" + zoomPct + '%)" aria-label="' + esc(this._t("btnZoomIn")) + " (" + zoomPct + '%)">' + icon("zoomIn") + "</button>" +
          (isDashboard
            ? '<span class="db-nav-sep" aria-hidden="true"></span>' +
              '<button type="button" class="db-btn db-icon-btn db-logout-btn" id="db-btn-logout" title="Log out" aria-label="Log out">' + icon("logout") + "</button>"
            : "") +
          "</div>";

        var navCenter = "";
        if (isDashboard) {
          function navTab(id, label, iconName, tooltip) {
            var activeCls = tab === id ? " is-active" : "";
            return (
              '<button type="button" class="db-nav-tab' + activeCls + '" data-tab="' + id + '"' +
              ' aria-current="' + (tab === id ? "page" : "false") + '"' +
              ' title="' + esc(tooltip || label) + '">' +
              icon(iconName) +
              "<span>" + esc(label) + "</span>" +
              "</button>"
            );
          }
          navCenter =
            '<nav class="db-nav-center" aria-label="AccessPath main navigation">' +
            navTab("dashboard", "Dashboard", "dashboard", "Your career workspace") +
            navTab("careers", "Careers", "compass", "Explore careers (" + (this.careers.length || 6) + " pathways)") +
            navTab("roadmap", "Roadmap", "map", "My learning roadmap") +
            navTab("passport", "Passport", "passport", "Career passport") +
            navTab("jobs", "Jobs", "briefcase", "Career opportunities") +
            "</nav>";
        }

        var voiceMsg = this.voiceLoopActive
          ? this._t("listeningStatus")
          : (this.state.voiceReadingEnabled ? this._t("pausedStatus") : this._t("standardModeNote"));
        var status =
          '<div id="db-voice-status" class="db-sr-only" role="status" aria-live="polite">' + esc(voiceMsg) + "</div>" +
          '<div class="db-voice-banner" role="status" aria-live="polite">' +
          '<span class="db-voice-banner-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg></span>' +
          '<p class="db-voice-banner-text">' + esc(voiceMsg) + '</p>' +
          '</div>' +
          (this.lastNotice ? '<div class="db-status-banner" role="status" aria-live="polite">' + esc(this.lastNotice) + "</div>" : "") +
          (this.lastError ? '<div class="db-error-banner" role="alert" aria-live="assertive">' + esc(this.lastError) + "</div>" : "");

        var contentHtml = isDashboard ? this._renderAccessPath() : this._renderAuthOrOnboarding(s, d, promptText);

        var isAuthFlow = (s === "accessibility_ask" || s === "auth_choice");
        var showVisual = !isDashboard && isAuthFlow;

        var sidebar = "";
        if (isDashboard) {
          sidebar = "";
        } else {
          var stepNum = s.indexOf("login_") === 0 ? 1 : this.state.step === 2 ? 2 : 1;
          var stepLabel = s.indexOf("login_") === 0 ? "Sign in" : "Registration";
          var s1 = stepNum >= 1 ? "is-active" : "";
          var s2 = stepNum >= 2 ? "is-active" : "";
          sidebar =
            '<aside class="db-sidebar db-sidebar-compact" aria-label="Registration progress">' +
            '<div class="db-sidebar-card db-progress-card">' +
            '<p class="db-sidebar-kicker">' + esc(stepLabel) + '</p>' +
            '<p class="db-sidebar-step">Step ' + esc(stepNum) + ' of 2</p>' +
            '<ol class="db-sidebar-steps" aria-label="Registration steps">' +
            '<li class="' + s1 + '"><span class="db-step-num">1</span><span>Account &amp; accessibility</span></li>' +
            '<li class="' + s2 + '"><span class="db-step-num">2</span><span>Verification &amp; profile</span></li>' +
            '</ol>' +
            '</div>' +
            '<p class="db-sidebar-help">All features work without voice input. Use keyboard, touch, or screen reader at any time.</p>' +
            "</aside>";
        }

        var topNav =
          '<header class="db-topnav">' +
          '<div class="db-topnav-brand">' +
          '<span class="db-logo-mark" aria-hidden="true">X</span>' +
          '<div class="db-logo-text"><span class="db-logo-name">SelamPath</span><span class="db-logo-sub">Career Gateway</span></div>' +
          '</div>' +
          navCenter +
          toolbar +
          '</header>';

        var mainFooter =
          '<footer class="db-main-footer">' +
          '<div class="db-footer-brand"><span class="db-footer-name">SelamPath</span><span class="db-footer-tagline">Inclusive onboarding and careers</span></div>' +
          '<div class="db-footer-shortcuts" aria-label="Accessibility shortcuts">' +
          '<span><kbd>Alt</kbd>+<kbd>A</kbd> Voice</span>' +
          '<span><kbd>Esc</kbd> Pause</span>' +
          '</div>' +
          '</footer>';

        var contentBlock = contentHtml;
        if (showVisual) {
          contentBlock =
            '<div class="db-auth-layout">' +
            '<div class="db-auth-main">' + contentHtml + '</div>' +
            '<aside class="db-auth-visual" aria-hidden="true">' +
            '<img src="./assets/registration-visual.svg" alt="" class="db-visual-img" />' +
            '<div class="db-visual-caption"><strong>Inclusive by design.</strong><span>Accessible learning and career pathways for everyone.</span></div>' +
            '</aside>' +
            '</div>';
        }

        this.innerHTML =
          '<section class="db-widget-root" role="region" aria-label="SelamPath and AccessPath">' +
          '<div id="db-aria-live" class="db-sr-only" aria-live="assertive" aria-atomic="true"></div>' +
          '<div class="db-app ' + (isDashboard ? "db-app-dashboard" : "db-app-onboarding") + '">' +
          topNav +
          '<div class="db-shell ' + (isDashboard ? "db-shell-dashboard" : "db-shell-onboarding") + '">' +
          sidebar +
          '<main class="db-main" id="db-main-panel">' +
          status +
          '<div class="db-content">' +
          contentBlock +
          "</div>" +
          "</main>" +
          "</div>" +
          mainFooter +
          "</div>" +
          "</section>";

        this._bindEvents();
        var heading = this.querySelector("#db-step-heading");
        if (heading) {
          heading.focus();
        }
      } catch (err) {
        this.innerHTML =
          '<div role="alert" class="db-error-banner">Render error: ' +
          esc(err && err.message ? err.message : err) +
          "</div>";
      }
    }

    _renderAuthOrOnboarding(s, d, promptText) {
      var labels = this._t("routeLabels") || {};

      if (s === "accessibility_ask" || s === "auth_choice") {
        return (
          '<div class="db-auth-card-wrap">' +
          '<section class="db-card db-central-card" aria-labelledby="db-step-heading">' +
          '<p class="db-card-eyebrow">Account access</p>' +
          '<h2 id="db-step-heading" tabindex="-1">' + esc(promptText) + "</h2>" +
          '<p class="db-card-lead">Choose how you would like to continue. Voice, keyboard, and screen reader access are available at every step.</p>' +
          (s === "accessibility_ask"
            ? '<div class="db-voice-prompt" role="group" aria-label="Voice guidance option">' +
              '<button type="button" class="db-voice-cta" id="db-btn-yes">' +
              '<span class="db-voice-cta-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" focusable="false"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></span>' +
              '<span class="db-voice-cta-text"><strong>Enable voice guidance</strong><small>Hands-free support with spoken prompts (Y)</small></span>' +
              '</button>' +
              '<button type="button" class="db-btn db-btn-secondary" id="db-btn-no">Continue without voice (N)</button>' +
              '</div>'
            : "") +
          '<div class="db-action-cards" role="group" aria-label="Account options">' +
          '<button type="button" class="db-action-card" id="db-go-login">' +
            '<span class="db-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" focusable="false"><path fill="currentColor" d="M10 17v-2h4v-2h-4v-2l-4 3 4 3zm9-12H9a2 2 0 0 0-2 2v3h2V7h10v10H9v-3H7v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/></svg></span>' +
            '<span class="db-action-body"><span class="db-action-title">Log in</span><span class="db-action-desc">Access your existing SelamPath and AccessPath account.</span></span>' +
            '<span class="db-action-arrow" aria-hidden="true">→</span>' +
          '</button>' +
          '<button type="button" class="db-action-card" id="db-go-signup">' +
            '<span class="db-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" focusable="false"><path fill="currentColor" d="M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-9 8v-1c0-2.66 5.33-4 8-4 .47 0 1 .03 1.56.09A5.98 5.98 0 0 0 14 19v1H6zm13-5v-2h-2v-2h2V9h2v2h2v2h-2v2h-2z"/></svg></span>' +
            '<span class="db-action-body"><span class="db-action-title">Sign up</span><span class="db-action-desc">Create a new account with accessible, guided registration.</span></span>' +
            '<span class="db-action-arrow" aria-hidden="true">→</span>' +
          '</button>' +
          '</div>' +
          '<div class="db-auth-aux"><button type="button" class="db-link-btn" id="db-first-contrast">Adjust contrast theme</button></div>' +
          "</section>" +
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
      html += '<p style="margin-top:0; font-weight:700;">' + esc(stepLabel) + "</p>";
      html += '<h2 id="db-step-heading" tabindex="-1" style="margin-top:0.25rem;">' + esc(promptText) + "</h2>";

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
          esc(promptText) +
          "</label>" +
          '<input id="db-text-input" class="db-input" type="' +
          (isPass ? "password" : "text") +
          '" autocomplete="off" placeholder="' +
          (s === "spell_name"
            ? "Type or spell letters (e.g. A B E B E done)"
            : "Type or dictate your answer") +
          '" value="' +
          (s === "spell_name" ? esc(this.spellBuffer) : "") +
          '" />' +
          "</div>";
      }

      if (s === "id_route") {
        html +=
          '<fieldset style="border:none; padding:0; margin:1rem 0;">' +
          '<legend class="db-sr-only">Verification Route</legend>' +
          '<button type="button" class="db-option-card db-route-btn" data-route="1">1. ' +
          esc(labels.national_kebele_id) +
          "</button>" +
          '<button type="button" class="db-option-card db-route-btn" data-route="2">2. ' +
          esc(labels.refugee_id) +
          "</button>" +
          '<button type="button" class="db-option-card db-route-btn" data-route="3">3. ' +
          esc(labels.alt_doc) +
          "</button>" +
          '<button type="button" class="db-option-card db-route-btn" data-route="4">4. ' +
          esc(labels.partner_referral) +
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
          esc(d.full_name) +
          "</p>" +
          '<p style="margin:0.25rem 0;"><strong>ID Route:</strong> ' +
          esc(labels[d.identity.route] || d.identity.route) +
          "</p>" +
          (docRef ? '<p style="margin:0.25rem 0;"><strong>Reference:</strong> ' + esc(docRef) + "</p>" : "") +
          '<p style="margin:0.25rem 0;"><strong>Contact:</strong> ' +
          esc(d.identity.contact_value) +
          "</p>" +
          "</div>";
      }

      html += '<div class="db-actions-row">';
      html += '<button type="button" class="db-btn" id="db-btn-back">' + esc(this._t("btnBack")) + "</button>";
      if (s === "review_submit") {
        html += '<button type="submit" class="db-btn db-btn-primary">' + esc(this._t("btnSubmit")) + "</button>";
      } else if (
        ["language", "id_route"].indexOf(s) === -1 &&
        (s.indexOf("confirm_") !== 0 || s === "confirm_password_reenter")
      ) {
        html += '<button type="submit" class="db-btn db-btn-primary">' + esc(this._t("btnNext")) + "</button>";
      }
      html += "</div></form>";
      return html;
    }

    _renderAccessPath() {
      var tab = this.state.careerTab || "dashboard";
      var dash = this.dashboard || {};
      var user = dash.user || this.state.data;
      var career = dash.selected_career;
      var passport = this.passport || {};
      var pct = Math.max(0, Math.min(100, Number(dash.progress_percent) || 0));
      var completedIds = dash.completed_stage_ids || [];

      if (tab === "careers") {
        var cards = this.careers
          .map(function (c, i) {
            var isSelected = career && career.id === c.id;
            return (
              '<article class="db-card">' +
              '<h3 style="margin-top:0;">' +
              esc(i + 1) +
              ". " +
              esc(c.title) +
              (isSelected ? " (Selected)" : "") +
              "</h3>" +
              "<p>" +
              esc(c.description) +
              "</p>" +
              "<p><strong>Required Skills:</strong> " +
              esc((c.required_skills || []).join(", ")) +
              "</p>" +
              "<p><strong>Learning Requirements:</strong> " +
              esc(c.learning_requirements) +
              "</p>" +
              "<p><strong>Opportunities:</strong> " +
              esc((c.opportunities || []).join(", ")) +
              "</p>" +
              "<p><strong>Roadmap Stages:</strong> " +
              esc((c.roadmap || []).length) +
              " stages</p>" +
              '<button type="button" class="db-btn db-btn-primary db-select-career" data-career-id="' +
              esc(c.id) +
              '">' +
              esc(isSelected ? "View Roadmap" : "Select " + c.title) +
              "</button>" +
              "</article>"
            );
          })
          .join("");
        return (
                    '<h2 id="db-step-heading" tabindex="-1">Career Discovery &amp; Selection</h2>' +
          '<p class="db-card-lead">Explore ' + esc(this.careers.length || 6) + ' career pathways designed around your strengths and accessibility needs. Pick one to unlock your personal learning roadmap.</p><div class="db-grid">' +
          cards +
          "</div>"
        );
      }

      if (tab === "passport") {
        return this._renderCareerPassport();
      }

      if (tab === "roadmap") {
        if (!career) {
          return (
                      '<h2 id="db-step-heading" tabindex="-1">Personalized Learning Roadmap</h2>' +
            '<p class="db-card-lead">Choose a career path first and we will build a step-by-step roadmap with clear objectives, skills, and resources for each stage.</p>' +
            '<button type="button" class="db-btn db-btn-primary" data-tab="careers">Explore Careers Now</button>'
          );
        }
        var stagesHtml = (career.roadmap || [])
          .map(function (st, idx) {
            var isDone = completedIds.indexOf(st.id) !== -1;
            return (
              '<article class="db-card">' +
              '<h3 style="margin-top:0;">Stage ' +
              esc(idx + 1) +
              ": " +
              esc(st.title) +
              " — " +
              (isDone ? "Completed" : "In Progress") +
              "</h3>" +
              "<p><strong>Objectives:</strong> " +
              esc(st.objectives) +
              "</p>" +
              "<p><strong>Skills:</strong> " +
              esc((st.skills || []).join(", ")) +
              "</p>" +
              "<p><strong>Resources:</strong> " +
              esc(st.resources) +
              "</p>" +
              '<button type="button" class="db-btn ' +
              (isDone ? "" : "db-btn-primary") +
              ' db-toggle-stage" data-career-id="' +
              esc(career.id) +
              '" data-stage-id="' +
              esc(st.id) +
              '" data-next="' +
              (!isDone) +
              '">' +
              (isDone ? "Mark Incomplete" : "Mark Stage Completed") +
              "</button>" +
              "</article>"
            );
          })
          .join("");
        return (
                    '<h2 id="db-step-heading" tabindex="-1">Roadmap: ' +
          esc(career.title) +
          " (" +
          esc(pct) +
          "% Complete)</h2>" +
          '<div class="db-progress-bar" role="progressbar" aria-valuenow="' +
          esc(pct) +
          '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="db-progress-fill" style="width:' +
          esc(pct) +
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
                var employer =
                  (j.hiringOrganization && j.hiringOrganization.name) || "Employer";
                return (
                  '<article class="db-card">' +
                  '<h3 style="margin-top:0;">' +
                  esc(j.title) +
                  " — " +
                  esc(employer) +
                  "</h3>" +
                  "<p><strong>Location:</strong> " +
                  esc(j.jobLocationType) +
                  "</p>" +
                  "<p>" +
                  esc(j.description) +
                  "</p>" +
                  "<p><strong>Accommodations Offered:</strong> " +
                  esc((j.accommodations_offered || []).join(", ")) +
                  "</p>" +
                  '<button type="button" class="db-btn db-btn-primary db-open-apply" data-job-id="' +
                  esc(j.id) +
                  '">' +
                  (isApplying ? "Close Application Form" : "Apply (Voice or Typing)") +
                  "</button>" +
                  (isApplying
                    ? '<form class="db-apply-form" data-job-id="' +
                      esc(j.id) +
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
                    '<h2 id="db-step-heading" tabindex="-1">Career Opportunities &amp; Accessible Job Gateway</h2>' +
          '<p class="db-card-lead">Browse inclusive employers, filter by the support you need, and apply with voice or typing. Every employer here is committed to accessible interviews.</p>' +
          '<form id="db-job-filter-form" class="db-card">' +
          '<label for="db-job-q"><strong>Search Jobs (Type or Voice):</strong></label>' +
          '<input id="db-job-q" class="db-input" type="text" value="' +
          esc(this.jobSearchQuery) +
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
                  '<h2 id="db-step-heading" tabindex="-1">Welcome to AccessPath, ' +
        esc(this.state.data.full_name) +
        "</h2>" +
        '<p class="db-card-lead">Your career workspace. Track your roadmap progress, build skills, and turn your journey into a Career Passport employers can trust.</p>' +
        '<div class="db-grid">' +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Selected Career &amp; Progress</h3>' +
        "<p><strong>Career Path:</strong> " +
        esc(career ? career.title : "Not selected yet") +
        "</p>" +
        "<p><strong>Progress:</strong> " +
        esc(pct) +
        "% (" +
        esc(dash.completed_count || 0) +
        " of " +
        esc(dash.total_stages || 0) +
        " stages)</p>" +
        '<div class="db-progress-bar" role="progressbar" aria-valuenow="' +
        esc(pct) +
        '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="db-progress-fill" style="width:' +
        esc(pct) +
        '%;"></div></div>' +
        "<p style='margin-top:0.75rem;'><strong>Recommended Next Activity:</strong> " +
        esc(
          dash.recommended_next_stage
            ? dash.recommended_next_stage.title
            : career
            ? "All stages complete! Explore jobs."
            : "Explore the 6 career pathways."
        ) +
        "</p>" +
        '<div class="db-actions-row">' +
        (career
          ? '<button type="button" class="db-btn db-btn-primary" data-tab="roadmap">Resume Roadmap</button>'
          : '<button type="button" class="db-btn db-btn-primary" data-tab="careers">Explore 6 Careers</button>') +
        "</div></section>" +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Profile &amp; Accessibility</h3>' +
        "<p><strong>Name:</strong> " +
        esc(user.full_name || this.state.data.full_name) +
        "</p>" +
        "<p><strong>Language:</strong> " +
        (this.lang === "am" ? "Amharic" : "English") +
        "</p>" +
        "<p><strong>Zoom:</strong> " +
        esc(this.state.data.preferences.zoom_percent) +
        "%</p>" +
        "<p><strong>Acquired Skills:</strong> " +
        esc(
          dash.acquired_skills && dash.acquired_skills.length
            ? dash.acquired_skills.join(", ")
            : "Complete stages to build skills"
        ) +
        "</p>" +
        "</section>" +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Career Passport</h3>' +
        "<p>Turn your roadmap progress into a shareable readiness summary for employers and programs.</p>" +
        "<p><strong>Readiness:</strong> " +
        esc((passport.readiness && passport.readiness.label) || "Exploring pathways") +
        "</p>" +
        '<button type="button" class="db-btn db-btn-primary" data-tab="passport">Open Career Passport</button>' +
        "</section></div>"
      );
    }

    _renderCareerPassport() {
      var p = this.passport;
      if (!p) {
        return (
                    '<h2 id="db-step-heading" tabindex="-1">Career Passport</h2>' +
          '<p class="db-card">Your passport is being prepared. If it does not appear, refresh the page or log in again.</p>'
        );
      }

      var learner = p.learner || {};
      var readiness = p.readiness || {};
      var level = ["job_ready", "building", "exploring"].indexOf(readiness.level) !== -1
        ? readiness.level
        : "exploring";
      var completed = p.completed_stages || [];
      var remaining = p.remaining_stages || [];
      var skills = p.acquired_skills || [];
      var supports = p.support_needs || [];
      var apps = p.applications || {};
      var pct = Math.max(0, Math.min(100, Number(p.progress_percent) || 0));

      var issued = "";
      try {
        issued = new Date(p.generated_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      } catch (_err) {
        issued = p.generated_at || "";
      }
      var latestApplication = "";
      if (apps.latest_at) {
        try {
          latestApplication = new Date(apps.latest_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        } catch (_err) {
          latestApplication = apps.latest_at;
        }
      }

      var completedHtml = completed.length
        ? '<ul class="db-passport-list">' +
          completed
            .map(function (stage) {
              return "<li>" + esc(stage.title) + "</li>";
            })
            .join("") +
          "</ul>"
        : "<p>No roadmap stages completed yet.</p>";

      var skillsHtml = skills.length
        ? '<ul class="db-passport-list">' +
          skills
            .map(function (skill) {
              return "<li>" + esc(skill) + "</li>";
            })
            .join("") +
          "</ul>"
        : "<p>Complete roadmap stages to build verified skills.</p>";

      var supportHtml = supports.length
        ? '<ul class="db-passport-list">' +
          supports
            .map(function (need) {
              return "<li>" + esc(need) + "</li>";
            })
            .join("") +
          "</ul>"
        : "<p>No workplace support preferences recorded.</p>";

      var nextTitles = remaining
        .slice(0, 3)
        .map(function (stage) {
          return stage.title;
        })
        .join(", ");
      var nextHtml = p.career
        ? remaining.length
          ? "<p><strong>Next up:</strong> " + esc(nextTitles) + "</p>"
          : "<p><strong>Next up:</strong> All roadmap stages are complete.</p>"
        : "<p>Choose a career path to start building your roadmap.</p>";

      return (
                  '<article class="db-passport" id="db-career-passport">' +
        '<header class="db-passport-header">' +
        '<div>' +
        '<p class="db-passport-kicker">SelamPath · AccessPath</p>' +
        '<h2 id="db-step-heading" tabindex="-1">Career Passport</h2>' +
        '<p class="db-passport-name">' +
        esc(learner.name || this.state.data.full_name) +
        "</p>" +
        "</div>" +
        '<span class="db-readiness-badge db-readiness-' +
        esc(level) +
        '">' +
        esc(readiness.label || "Exploring pathways") +
        "</span>" +
        "</header>" +
        '<p class="db-passport-meta">Passport <strong>' +
        esc(p.passport_id) +
        "</strong> · Issued " +
        esc(issued) +
        "</p>" +
        '<div class="db-grid">' +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Career Direction</h3>' +
        "<p><strong>Path:</strong> " +
        esc(p.career ? p.career.title : "Not selected yet") +
        "</p>" +
        "<p><strong>Readiness:</strong> " +
        esc(readiness.label || "Exploring pathways") +
        "</p>" +
        "<p><strong>Progress:</strong> " +
        esc(pct) +
        "% (" +
        esc(p.completed_count || 0) +
        " of " +
        esc(p.total_stages || 0) +
        " stages)</p>" +
        '<div class="db-progress-bar" role="progressbar" aria-valuenow="' +
        esc(pct) +
        '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="db-progress-fill" style="width:' +
        esc(pct) +
        '%;"></div></div>' +
        nextHtml +
        "</section>" +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Verified Identity</h3>' +
        "<p><strong>Contact:</strong> " +
        esc(
          learner.contact_verified
            ? learner.contact
            : "Not verified"
        ) +
        "</p>" +
        "<p><strong>Contact status:</strong> " +
        (learner.contact_verified ? "Verified with a single-use code" : "Not verified") +
        "</p>" +
        "<p><strong>Preferred language:</strong> " +
        esc(learner.language === "am" ? "Amharic" : "English") +
        "</p>" +
        "</section>" +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Skills &amp; Learning</h3>' +
        "<p><strong>Completed stages:</strong></p>" +
        completedHtml +
        "<p><strong>Acquired skills:</strong></p>" +
        skillsHtml +
        "</section>" +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">Workplace Support</h3>' +
        "<p><strong>Support preferences:</strong></p>" +
        supportHtml +
        "</section>" +
        '<section class="db-card">' +
        '<h3 style="margin-top:0;">AccessPath Activity</h3>' +
        "<p><strong>Applications submitted:</strong> " +
        esc(apps.count || 0) +
        "</p>" +
        (latestApplication
          ? "<p><strong>Most recent application:</strong> " + esc(latestApplication) + "</p>"
          : "<p>No job applications yet. Explore inclusive employers from the jobs tab.</p>") +
        "</section>" +
        "</div>" +
        '<p class="db-passport-note">' +
        "This passport is generated from your AccessPath progress. It includes your contact and support preferences, so share it only with employers or programs you trust." +
        "</p>" +
        '<div class="db-actions-row">' +
        '<button type="button" class="db-btn db-btn-primary" id="db-copy-passport">Copy Passport Summary</button>' +
        '<button type="button" class="db-btn" id="db-print-passport">Print / Save as PDF</button>' +
        "</div>" +
        "</article>"
      );
    }

    _passportText() {
      var p = this.passport;
      if (!p) {
        return "";
      }
      var learner = p.learner || {};
      var apps = p.applications || {};
      return [
        "SelamPath — AccessPath Career Passport",
        "Passport ID: " + (p.passport_id || ""),
        "Name: " + (learner.name || ""),
        "Career path: " + (p.career ? p.career.title : "Not selected"),
        "Readiness: " + (p.readiness ? p.readiness.label : "Exploring pathways"),
        "Progress: " +
          (p.progress_percent || 0) +
          "% (" +
          (p.completed_count || 0) +
          " of " +
          (p.total_stages || 0) +
          " stages)",
        "Skills: " + ((p.acquired_skills || []).join(", ") || "None recorded"),
        "Support needs: " + ((p.support_needs || []).join(", ") || "None recorded"),
        "Verified contact: " +
          (learner.contact_verified ? learner.contact : "Not verified"),
        "Applications submitted: " + (apps.count || 0),
        "Issued: " + (p.generated_at || ""),
      ].join("\n");
    }

    _copyToClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise(function (resolve, reject) {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        try {
          var ok = document.execCommand("copy");
          document.body.removeChild(area);
          if (ok) {
            resolve();
          } else {
            reject(new Error("Copy command was rejected."));
          }
        } catch (err) {
          document.body.removeChild(area);
          reject(err);
        }
      });
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
      on("#db-btn-lang", function () {
        self._handleLanguageChoice(self.lang === "en" ? "am" : "en");
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
      on("#db-btn-logout", async function () {
        self.voiceLoopActive = false;
        self.voice.stopAll();
        var token = self.state.accessToken;
        self.pendingPassword = "";
        self.state = self.State.resetAll();
        self.dashboard = null;
        self.passport = null;
        self.jobs = [];
        self.careers = [];
        self.applyingJobId = null;
        self.showEmployerForm = false;
        self.lastError = "";
        self.lastNotice = "You have been logged out.";
        if (token) {
          try {
            await fetch(self.apiBase + "/auth/logout", {
              method: "POST",
              headers: { Authorization: "Bearer " + token },
            });
          } catch (_err) {
            // Local session is already cleared; server expiry will catch up.
          }
        }
        self.render();
      });

      on("#db-copy-passport", async function () {
        if (!self.passport) {
          return;
        }
        try {
          await self._copyToClipboard(self._passportText());
          self.lastError = "";
          self.lastNotice = "Career Passport summary copied. Share it only with employers you trust.";
          self.render();
          self._announceLive(self.lastNotice);
        } catch (_err) {
          self.lastError = "Copy is not available in this browser. Use Print / Save as PDF instead.";
          self.render();
        }
      });
      on("#db-print-passport", function () {
        window.print();
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
          var titleEl = self.querySelector("#db-emp-title");
          var nameEl = self.querySelector("#db-emp-name");
          var locEl = self.querySelector("#db-emp-loc");
          var descEl = self.querySelector("#db-emp-desc");
          var accomEl = self.querySelector("#db-emp-accom");
          var title = titleEl ? titleEl.value.trim() : "";
          var employer = nameEl ? nameEl.value.trim() : "";
          var location = locEl ? locEl.value.trim() : "";
          var desc = descEl ? descEl.value.trim() : "";
          var accomRaw = accomEl ? accomEl.value : "";
          var accoms = accomRaw
            .split(",")
            .map(function (s) {
              return s.trim();
            })
            .filter(Boolean);

          if (!title || !employer || !desc) {
            self.lastError = "Job title, employer name and description are required.";
            self.render();
            return;
          }
          if (!self.state.accessToken) {
            self.lastError = "Please log in to post a job.";
            self.render();
            return;
          }

          try {
            var res = await fetch(self.apiBase + "/career/jobs", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + self.state.accessToken,
              },
              body: JSON.stringify({
                title: title,
                employer_name: employer,
                location: location,
                description: desc,
                accommodations_offered: accoms,
              }),
            });
            if (res.status === 401 || res.status === 403) {
              self._handleSessionExpired();
              return;
            }
            if (!res.ok) {
              var errJson = await res.json().catch(function () {
                return {};
              });
              self.lastError =
                typeof errJson.detail === "string"
                  ? errJson.detail
                  : "The job posting could not be published. Please check the details and try again.";
              self.render();
              return;
            }
            self.showEmployerForm = false;
            self.lastError = "";
            self.lastNotice = "Job posting published with accommodations.";
            await self._loadAccessPathData();
            self.render();
          } catch (_err) {
            self.lastError = "Could not reach the server. Check your connection and try again.";
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
          var pitchEl = self.querySelector("#db-app-pitch");
          var accomEl = self.querySelector("#db-app-accom");
          var pitch = pitchEl ? pitchEl.value.trim() : "";
          var accom = accomEl ? accomEl.value.trim() : "";
          if (pitch.length < 3) {
            self.lastError = "Please write or dictate a short application pitch before submitting.";
            self.render();
            return;
          }
          if (!self.state.accessToken) {
            self.lastError = "Please log in to apply for a job.";
            self.render();
            return;
          }
          var profileUser =
            (self.dashboard && self.dashboard.user) || self.state.data || {};
          var profileIdentity = profileUser.identity || {};
          var contact =
            (self.state.data.identity && self.state.data.identity.contact_value) ||
            profileIdentity.contact_value ||
            "";
          if (!contact) {
            self.lastError =
              "Add a verified phone number or email to your profile before applying.";
            self.render();
            return;
          }
          try {
            var res = await fetch(self.apiBase + "/career/apply", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + self.state.accessToken,
              },
              body: JSON.stringify({
                job_id: jobId,
                applicant_name: self.state.data.full_name,
                applicant_contact: contact,
                voice_pitch_transcript: pitch,
                interview_accommodations: accom,
                support_needs: self.state.data.support_needs,
              }),
            });
            if (res.status === 401 || res.status === 403) {
              self._handleSessionExpired();
              return;
            }
            if (!res.ok) {
              var errJson = await res.json().catch(function () {
                return {};
              });
              self.lastError =
                typeof errJson.detail === "string"
                  ? errJson.detail
                  : "Your application could not be submitted. Please try again.";
              self.render();
              return;
            }
            self.applyingJobId = null;
            self.lastError = "";
            self.lastNotice = "Job application submitted successfully.";
            self.render();
            if (self.state.voiceReadingEnabled) {
              await self.voice.speak(self.lastNotice, self.lang);
            }
          } catch (_err) {
            self.lastError = "Could not reach the server. Check your connection and try again.";
            self.render();
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