(function (global) {
  var STORAGE_KEY = "digital_bridge_accesspath_v5";

  var VALID_SUBSTEPS = [
    "accessibility_ask",
    "auth_choice",
    "login_name",
    "login_password",
    "language",
    "name",
    "confirm_name",
    "spell_name",
    "confirm_spelled_name",
    "password",
    "confirm_password_reenter",
    "id_route",
    "confirm_id_route",
    "doc_or_partner",
    "confirm_doc_or_partner",
    "contact",
    "confirm_contact",
    "otp",
    "review_submit",
    "done",
    "career_dashboard",
  ];

  var DEFAULT_STATE = {
    step: 0,
    substep: "accessibility_ask",
    voiceModeAsked: false,
    voiceReadingEnabled: false,
    completed: false,
    resumeToken: null,
    accessToken: null,
    careerTab: "dashboard",
    selectedCareerPreview: null,
    data: {
      full_name: "",
      password: "",
      preferred_language: "en",
      preferences: {
        profile_type: "standard",
        contrast_mode: "default",
        custom_bg: "#000000",
        custom_fg: "#FFFF00",
        zoom_percent: 100,
        tts_enabled: false,
        stt_enabled: false,
        language: "en",
      },
      identity: {
        route: "national_kebele_id",
        document_number: "",
        partner_name: "",
        contact_value: "",
        otp_verified: false,
      },
      support_needs: [],
    },
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return clone(DEFAULT_STATE);
      }
      var parsed = JSON.parse(raw);
      var base = clone(DEFAULT_STATE);
      var merged = Object.assign({}, base, parsed || {});
      merged.data = Object.assign({}, base.data, (parsed && parsed.data) || {});
      merged.data.preferences = Object.assign(
        {},
        base.data.preferences,
        (parsed && parsed.data && parsed.data.preferences) || {}
      );
      merged.data.identity = Object.assign(
        {},
        base.data.identity,
        (parsed && parsed.data && parsed.data.identity) || {}
      );
      if (VALID_SUBSTEPS.indexOf(merged.substep) === -1) {
        merged.substep = merged.accessToken ? "career_dashboard" : "accessibility_ask";
      }
      return merged;
    } catch (_err) {
      return clone(DEFAULT_STATE);
    }
  }

  function save(state) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_err) {
      // Ignore storage quota errors
    }
  }

  function resetAll() {
    var fresh = clone(DEFAULT_STATE);
    save(fresh);
    return fresh;
  }

  async function syncDraftToServer(apiBase, state) {
    if (!apiBase || state.completed) {
      return state.resumeToken;
    }
    try {
      var safeData = clone(state.data);
      delete safeData.password;
      var res = await fetch(apiBase + "/onboarding/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: state.resumeToken,
          step: typeof state.step === "number" ? state.step : 1,
          data: safeData,
        }),
      });
      if (res.ok) {
        var json = await res.json();
        state.resumeToken = json.token;
        save(state);
        return json.token;
      }
    } catch (_err) {
      // LocalStorage remains source of truth offline
    }
    return state.resumeToken;
  }

  global.DigitalBridgeState = {
    DEFAULT_STATE: DEFAULT_STATE,
    load: load,
    save: save,
    resetAll: resetAll,
    syncDraftToServer: syncDraftToServer,
  };
})(window);