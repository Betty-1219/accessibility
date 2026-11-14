class DigitalBridgeStateManager {
  constructor() {
    this.storageKey = "db_onboarding_state_v3";
    this.state = this.loadState();
  }

  getDefaultState() {
    return {
      step: 0,
      registered: false,
      has_disability: null,
      preferences: {
        profile_type: "standard",
        contrast_mode: "default",
        custom_bg: "#000000",
        custom_fg: "#FFFF00",
        zoom_percent: 100,
        tts_enabled: false,
        stt_enabled: false,
        auto_flow: false,
        language: "en"
      },
      form: {
        full_name: "",
        password: "",
        identity_route: "national_kebele_id",
        route_confirmed: false,
        document_number: "",
        partner_name: "",
        contact_value: "",
        otp_code: "",
        otp_verified: false,
        support_needs: []
      }
    };
  }

  loadState() {
    const defaults = this.getDefaultState();
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...defaults,
          ...parsed,
          preferences: { ...defaults.preferences, ...(parsed.preferences || {}) },
          form: { ...defaults.form, ...(parsed.form || {}) }
        };
      } catch (_) {}
    }
    return defaults;
  }

  saveState() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.state));
  }

  setStep(step) {
    this.state.step = step;
    this.saveState();
  }

  setHasDisability(val) {
    this.state.has_disability = val;
    this.saveState();
  }

  updatePreferences(prefs) {
    this.state.preferences = { ...this.state.preferences, ...prefs };
    this.saveState();
    this.applyVisualPreferences();
  }

  updateForm(fields) {
    this.state.form = { ...this.state.form, ...fields };
    this.saveState();
  }

  applyVisualPreferences() {
    const { contrast_mode, zoom_percent, custom_bg, custom_fg } = this.state.preferences;
    document.documentElement.style.fontSize = `${zoom_percent}%`;

    document.body.className = `db-theme-${contrast_mode}`;
    if (contrast_mode === "custom") {
      document.body.style.setProperty("--db-bg", custom_bg);
      document.body.style.setProperty("--db-card-bg", custom_bg);
      document.body.style.setProperty("--db-fg", custom_fg);
      document.body.style.setProperty("--db-border", custom_fg);
      document.body.style.setProperty("--db-accent", custom_fg);
      document.body.style.setProperty("--db-accent-fg", custom_bg);
    } else {
      ["--db-bg", "--db-card-bg", "--db-fg", "--db-border", "--db-accent", "--db-accent-fg"]
        .forEach(prop => document.body.style.removeProperty(prop));
    }
  }
}

window.DigitalBridgeStateManager = DigitalBridgeStateManager;