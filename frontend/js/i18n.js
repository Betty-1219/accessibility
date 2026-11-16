(function (global) {
  var STRINGS = {
    en: {
      brandName: "SelamPath",
      brandTagline: "A peaceful path from learning to work.",
      welcomeEntry:
        "Welcome to SelamPath and AccessPath. Would you like to activate Accessibility Voice Reading Mode? Say Yes or press Y to turn on voice mode, or say No or press N for standard mode.",
      askAuthChoice:
        "Would you like to Login or Sign Up? Say Login or press 1, or say Sign Up or press 2.",
      askLanguage:
        "Choose your language. Say English or press 1. ለአማርኛ 'አማርኛ' ይበሉ ወይም 2 ይጫኑ።",
      loginNameAsk: "Login. Please say or type your full name.",
      loginPasswordAsk: "Now please say or type your passcode to login.",
      loginSuccess: function (name) {
        return "Welcome back, " + name + ". Opening your AccessPath Career Dashboard.";
      },
      loginFailed: "Name or passcode did not match. Please try again or choose Sign Up.",
      step1Title: "Sign Up — Step 1 of 2: Name and Passcode",
      askName: "Please say your full name calmly after the tone, or type it and press Enter.",
      confirmName: function (name) {
        return (
          "I heard " +
          name +
          ". Is that correct? Say Yes to confirm, or No to spell your name letter by letter."
        );
      },
      spellIntro:
        "Okay, let us spell your name. Say each letter clearly, say Space between first and last name, Backspace to undo, and Done when finished.",
      spellHeard: function (buffer) {
        return "So far: " + buffer.split("").join(", ") + ". Keep spelling, or say Done.";
      },
      spellConfirm: function (name, spelled) {
        return (
          "You spelled " +
          name +
          " (" +
          spelled +
          "). Is that correct? Say Yes to confirm, or No to spell again."
        );
      },
      askPassword: "Please say or type a passcode of at least 8 characters or digits.",
      passwordTooShort: "Passcode must be at least 8 characters. Please try again.",
      askPasswordConfirm: "Please repeat your passcode to test and confirm it matches.",
      passwordMismatch: "The passcodes did not match. Let us enter your passcode again.",
      passwordConfirmed: "Passcode confirmed.",
      step2Title: "Sign Up — Step 2 of 2: Identity, Verification, and Submit",
      askIdRoute:
        "Choose how to verify. Say 1 for National or Kebele ID, 2 for Refugee ID, 3 for Alternative Document, or 4 for Partner Referral with no ID needed.",
      confirmIdRoute: function (label) {
        return "You selected " + label + ". Is that correct? Say Yes to confirm, or No to choose again.";
      },
      askDocNumber: "Please say or type your document number, or say Skip if you do not have it nearby.",
      askPartnerName: "Please say or type the name of the partner organization referring you.",
      confirmDocOrPartner: function (val) {
        return val
          ? "I recorded " + val + ". Is that correct? Say Yes to confirm, or No to re-enter."
          : "You chose to skip the document number. Say Yes to confirm, or No to enter it.";
      },
      askContact: "Please say or type your phone number or email address to receive a verification code.",
      confirmContact: function (val) {
        return (
          "I heard contact " +
          val +
          ". Is that correct? Say Yes to send the verification code, or No to re-enter."
        );
      },
      otpSent:
        "A 6-digit verification code has been sent to your contact. Check your SMS or email, then say or type the 6 digits.",
      otpInvalid: "That code did not match or expired. Please say or type the 6 digits again.",
      otpVerified: "Verification successful.",
      reviewPrompt: function (name, routeLabel, docVal, contact) {
        return (
          "Final verification before finishing. Name: " +
          name +
          ". Verification route: " +
          routeLabel +
          (docVal ? ". Reference: " + docVal : "") +
          ". Contact: " +
          contact +
          ". Say Submit or Finish in English, or ላክ in Amharic, to finish registration. Say Edit to change anything."
        );
      },
      submitting: "Submitting your registration now. Please wait.",
      completed: function (name) {
        return (
          "Congratulations " +
          name +
          ". Your registration is complete! Opening your AccessPath Career Dashboard."
        );
      },
      noSpeech: "I didn’t catch that. You can speak when ready, or type your answer and press Enter.",
      waitReply: "Take your time. Press Space or speak when you’re ready.",
      listeningStatus: "Listening…",
      speakingStatus: "Speaking…",
      pausedStatus: "Voice guidance is paused. Press Space or Alt+A to resume.",
      btnVoiceToggleOn: "Voice: On (Esc to pause)",
      btnVoiceToggleOff: "Enable voice guidance (Space)",
      btnRepeat: "Repeat",
      btnContrast: "Contrast theme",
      btnZoomOut: "Text size −",
      btnZoomIn: "Text size +",
      btnLang: "አማርኛ / EN",
      btnCustomColors: "Custom colors",
      customBgLabel: "Background color",
      customFgLabel: "Text color",
      btnApplyColors: "Apply colors",
      standardModeNote:
        "Standard mode. Press Space or select “Enable voice guidance” anytime for hands-free assistance.",
      btnBack: "Back",
      btnNext: "Confirm & Continue",
      btnSubmit: "Submit Registration",
      routeLabels: {
        national_kebele_id: "National or Kebele ID",
        refugee_id: "Refugee ID (UNHCR / RRS)",
        alt_doc: "Alternative Document",
        partner_referral: "Partner Referral (No ID needed)",
      },
    },
    am: {
      brandName: "SelamPath",
      brandTagline: "ከትምህርት ወደ ሥራ የሚወስድ ሰላማዊ መንገድ።",
      welcomeEntry:
        "ወደ SelamPath እና AccessPath እንኳን በደህና መጡ። የድምፅ ንባብ ተደራሽነት ሁነታን ማብራት ይፈልጋሉ? ለማብራት 'አዎ' ይበሉ ወይም Y ይጫኑ፤ ካልፈለጉ 'አይ' ይበሉ ወይም N ይጫኑ።",
      askAuthChoice:
        "መግባት (Login) ወይም መመዝገብ (Sign Up) ይፈልጋሉ? ለመግባት 'ግባ' ወይም 1፣ ለመመዝገብ 'ተመዝገብ' ወይም 2 ይበሉ።",
      askLanguage:
        "ቋንቋ ይምረጡ። ለአማርኛ 'አማርኛ' ይበሉ ወይም 2 ይጫኑ። For English say English or press 1.",
      loginNameAsk: "መግቢያ። እባክዎ ሙሉ ስምዎን ይናገሩ ወይም ይጻፉ።",
      loginPasswordAsk: "አሁን የይለፍ ቃልዎን ይናገሩ ወይም ይጻፉ።",
      loginSuccess: function (name) {
        return "እንኳን በደህና ተመለሱ " + name + "። የAccessPath ዳሽቦርድ በመክፈት ላይ ነው።";
      },
      loginFailed: "ስም ወይም የይለፍ ቃል አልተዛመደም። እባክዎ እንደገና ይሞክሩ ወይም ይመዝገቡ።",
      step1Title: "ምዝገባ — ደረጃ 1 ከ 2፡ ስም እና የይለፍ ቃል",
      askName: "እባክዎ ሙሉ ስምዎን በዝግታ ይናገሩ ወይም በኪቦርድ ጽፈው Enter ይጫኑ።",
      confirmName: function (name) {
        return (
          "የሰማሁት " +
          name +
          " ነው። ትክክል ነው? ትክክል ከሆነ 'አዎ' ይበሉ፤ ካልሆነ በፊደል ለመናገር 'አይ' ይበሉ።"
        );
      },
      spellIntro:
        "እሺ፣ ስምዎን በፊደል ይንገሩኝ። ፊደላቱን አንድ በአንድ ይናገሩ፤ በስሞች መካከል 'ክፍተት'፣ ለማጥፋት 'አጥፋ'፣ ሲጨርሱ 'ጨርሻለሁ' ይበሉ።",
      spellHeard: function (buffer) {
        return "እስካሁን: " + buffer.split("").join("፣ ") + "። ይቀጥሉ ወይም 'ጨርሻለሁ' ይበሉ።";
      },
      spellConfirm: function (name, spelled) {
        return (
          "በፊደል የጻፉት " +
          name +
          " (" +
          spelled +
          ") ነው። ትክክል ነው? ለማረጋገጥ 'አዎ' ይበሉ፣ እንደገና ለመጻፍ 'አይ' ይበሉ።"
        );
      },
      askPassword: "ቢያንስ 8 ቁምፊ ያለው የይለፍ ቃል ይናገሩ ወይም ይጻፉ።",
      passwordTooShort: "የይለፍ ቃሉ ቢያንስ 8 ቁምፊ መሆን አለበት። እባክዎ እንደገና ይሞክሩ።",
      askPasswordConfirm: "እባክዎ የይለፍ ቃሉን ለማረጋገጥ እና ለመሞከር እንደገና ይናገሩ ወይም ይጻፉ።",
      passwordMismatch: "የይለፍ ቃሎቹ አልተመሳሰሉም። እባክዎ እንደገና ያስገቡ።",
      passwordConfirmed: "የይለፍ ቃሉ ተረጋግጧል።",
      step2Title: "ምዝገባ — ደረጃ 2 ከ 2፡ ማንነት ማረጋገጫ እና መላክ",
      askIdRoute:
        "የማረጋገጫ መንገድ ይምረጡ። ለብሔራዊ/ቀበሌ መታወቂያ 1፣ ለስደተኞች መታወቂያ 2፣ ለሌላ ሰነድ 3፣ ያለ መታወቂያ በአጋር ድርጅት 4 ይበሉ።",
      confirmIdRoute: function (label) {
        return "የመረጡት " + label + " ነው። ትክክል ነው? 'አዎ' ወይም 'አይ' ይበሉ።";
      },
      askDocNumber: "እባክዎ የመታወቂያ ቁጥርዎን ይናገሩ ወይም 'ዝለል' (skip) ይበሉ።",
      askPartnerName: "እባክዎ የላከዎትን አጋር ድርጅት ስም ይናገሩ።",
      confirmDocOrPartner: function (val) {
        return val
          ? "የተመዘገበው " + val + " ነው። ትክክል ነው? 'አዎ' ወይም 'አይ' ይበሉ።"
          : "ቁጥሩን ዘለዋል። ለማረጋገጥ 'አዎ' ይበሉ ወይም 'አይ' ይበሉ።";
      },
      askContact: "የማረጋገጫ ኮድ የሚላክበትን ስልክ ቁጥር ወይም ኢሜይል ይናገሩ።",
      confirmContact: function (val) {
        return (
          "የሰማሁት " +
          val +
          " ነው። ትክክል ነው? ኮድ ለመላክ 'አዎ' ይበሉ፣ ለመቀየር 'አይ' ይበሉ።"
        );
      },
      otpSent:
        "ባለ 6 አሃዝ የማረጋገጫ ኮድ ወደ ስልክዎ ወይም ኢሜይልዎ ተልኳል። እባክዎ 6ቱን ቁጥሮች ይናገሩ ወይም ይጻፉ።",
      otpInvalid: "ኮዱ ትክክል አይደለም። እባክዎ 6ቱን ቁጥሮች እንደገና ያስገቡ።",
      otpVerified: "ማረጋገጫው ተሳክቷል።",
      reviewPrompt: function (name, routeLabel, docVal, contact) {
        return (
          "የመጨረሻ ማረጋገጫ። ስም: " +
          name +
          "። መንገድ: " +
          routeLabel +
          (docVal ? "። መረጃ: " + docVal : "") +
          "። መገናኛ: " +
          contact +
          "። ምዝገባዎን ለመጨረስ 'ላክ' ወይም 'አስገባ' ወይም 'Submit' ይበሉ። ለመቀየር 'ቀይር' ይበሉ።"
        );
      },
      submitting: "ምዝገባዎን በማስገባት ላይ ነኝ። እባክዎ ይጠብቁ።",
      completed: function (name) {
        return "እንኳን ደስ ያለዎት " + name + "። ምዝገባዎ ተጠናቋል። ወደ AccessPath የሙያ ዳሽቦርድ በመግባት ላይ ነው።";
      },
      noSpeech: "ምንም አይቸኩሉ። ዝግጁ ሲሆኑ ይናገሩ ወይም በኪቦርድ ጽፈው Enter ይጫኑ።",
      waitReply: "እሺ፣ በዝግታ ያስቡ። ዝግጁ ሲሆኑ ይናገሩ ወይም Space ይጫኑ።",
      listeningStatus: "በማዳመጥ ላይ...",
      speakingStatus: "በመናገር ላይ...",
      pausedStatus: "የድምፅ ንባብ ቆሟል። ለመቀጠል Space ወይም Alt+A ይጫኑ።",
      btnVoiceToggleOn: "የድምፅ ንባብ፡ በርቷል (Esc ለማቆም)",
      btnVoiceToggleOff: "የድምፅ ንባብ አብራ (Space)",
      btnRepeat: "ድገም",
      btnContrast: "ንፅፅር",
      btnZoomOut: "አሳንስ (-)",
      btnZoomIn: "አጉላ (+)",
      btnLang: "EN / አማርኛ",
      btnCustomColors: "ብጁ ቀለሞች",
      customBgLabel: "የዳራ ቀለም",
      customFgLabel: "የጽሑፍ ቀለም",
      btnApplyColors: "ብጁ ቀለሞችን ተግብር",
      standardModeNote:
        "መደበኛ / የስክሪን አንባቢ ሁነታ። ያለ እጅ በድምፅ ለመስራት በፈለጉ ጊዜ Space ወይም የድምፅ ቁልፍን ይጫኑ።",
      btnBack: "ተመለስ",
      btnNext: "አረጋግጥና ቀጥል",
      btnSubmit: "ምዝገባ ላክ (Submit)",
      routeLabels: {
        national_kebele_id: "ብሔራዊ / ቀበሌ መታወቂያ",
        refugee_id: "የስደተኞች መታወቂያ",
        alt_doc: "ሌላ ሰነድ",
        partner_referral: "በአጋር ድርጅት (ያለ መታወቂያ)",
      },
    },
  };

  function t(lang, key) {
    var dict = STRINGS[lang] || STRINGS.en;
    var val = dict[key] !== undefined ? dict[key] : STRINGS.en[key];
    if (typeof val === "function") {
      var args = Array.prototype.slice.call(arguments, 2);
      return val.apply(null, args);
    }
    return val;
  }

  global.DigitalBridgeI18n = { STRINGS: STRINGS, t: t };
})(window);