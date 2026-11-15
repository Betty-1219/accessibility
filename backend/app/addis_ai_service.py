import os
import tempfile
from typing import Optional

try:
    from addisai import AddisAI
except ImportError:
    AddisAI = None


def _get_client() -> Optional["AddisAI"]:
    api_key = os.getenv("ADDIS_API_KEY")
    if not api_key or AddisAI is None:
        return None
    return AddisAI(api_key=api_key, timeout=60.0)


def _offline_assistant_reply(prompt: str, language: str, step: int) -> str:
    q = prompt.lower()
    if language == "am":
        if any(w in q for w in ["ስም", "name", "ፊደል", "spell", "ይለፍ", "password"]):
            return (
                "በደረጃ 1 ሙሉ ስምዎን ይናገሩ። በትክክል ካልተሰማ 'አይ' በማለት በፊደል ይናገሩ። "
                "ከዚያ ቢያንስ 8 ቁምፊ የይለፍ ቃል ይናገሩ እና ለማረጋገጥ ይድገሙት።"
            )
        if any(w in q for w in ["መታወቂያ", "id", "otp", "ስልክ", "ማረጋገጫ"]):
            return (
                "በደረጃ 2 ብሔራዊ/ቀበሌ መታወቂያ፣ የስደተኞች መታወቂያ፣ ሌላ ሰነድ ወይም ያለ መታወቂያ በአጋር ድርጅት "
                "መምረጥ እና እያንዳንዱን መረጃ ማረጋገጥ ይችላሉ።"
            )
        if any(w in q for w in ["submit", "ላክ", "አስገባ", "ጨርስ", "መዝግብ"]):
            return "በደረጃ 2 መጨረሻ ላይ 'ላክ' ወይም 'አስገባ' ወይም 'Submit' በማለት ምዝገባዎን ይጨርሱ።"
        if any(w in q for w in ["ስራ", "job", "career", "roadmap", "accesspath"]):
            return (
                "ወደ AccessPath ዳሽቦርድ ከገቡ በኋላ የሙያ መንገድ መምረጥ፣ የትምህርት ደረጃዎችን መከታተል "
                "እና ለስራ በድምፅ ወይም በጽሑፍ ማመልከት ይችላሉ።"
            )
        return (
            f"አሁን ያሉት በደረጃ {step} ላይ ነው። ለመድገም 'ድገም'፣ ለመመለስ 'ተመለስ'፣ "
            "ለማቆም Escape ይጫኑ።"
        )

    if any(w in q for w in ["spell", "wrong", "name", "hear", "incorrect"]):
        return (
            "If I misheard your name, say 'No' when asked to confirm. Spell it letter by letter—"
            "like 'A B E B E space B I K I L A'—then say 'Done' or 'Yes' to confirm."
        )
    if any(w in q for w in ["password", "passcode", "pin", "step 1"]):
        return "In Step 1, enter a passcode of at least 8 characters and repeat it once to confirm it matches."
    if any(w in q for w in ["id", "verify", "otp", "refugee", "partner", "step 2"]):
        return (
            "In Step 2, choose an ID route (1-4) and confirm each answer. For security, your 6-digit OTP "
            "is sent to your contact and never displayed on the screen."
        )
    if any(w in q for w in ["career", "accesspath", "roadmap", "job"]):
        return (
            "In AccessPath Career Dashboard, explore 6 careers, pick your roadmap, mark stages complete, "
            "filter jobs by accommodations, and apply using voice or typing."
        )
    return (
        f"You are on Step {step}. Say 'Repeat' to hear the question again, 'Wait' for extra time, "
        "'Back' to go back, or press Escape to pause speech."
    )


def process_addis_text(prompt: str, language: str = "en", step: int = 1) -> str:
    client = _get_client()
    if client:
        try:
            lang_instruction = (
                "Reply clearly and concisely in Amharic."
                if language == "am"
                else "Reply clearly and concisely in English."
            )
            system_msg = (
                "You are the Digital Bridge & AccessPath Accessibility Assistant for ALX Ethiopia. "
                "The user may be blind and navigating without a mouse or screen reading. "
                "Onboarding is 2 steps (Login/Signup choice -> Step 1 Name with spelling fallback & Passcode confirmation -> "
                "Step 2 ID verification, Contact, OTP, and Voice Submit), followed by the AccessPath Career Dashboard. "
                f"Current step: {step}. {lang_instruction}"
            )
            res = client.chat.completions.create(
                language="am" if language == "am" else "en",
                system=system_msg,
                messages=[{"role": "user", "content": prompt}],
            )
            content = res["choices"][0]["message"]["content"]
            if content:
                return content
        except Exception as err:
            print(f"AddisAI chat fallback triggered: {err}")

    return _offline_assistant_reply(prompt, language, step)


def generate_addis_tts_bytes(text: str, language: str = "am") -> Optional[tuple[bytes, str]]:
    client = _get_client()
    if not client or language != "am":
        return None
    try:
        clip = client.voice.generate(voice_id="am-hamen", text=text, language="am")
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            clip.to_file(tmp_path)
            with open(tmp_path, "rb") as f:
                return f.read(), "audio/mpeg"
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
    except Exception as err:
        print(f"AddisAI TTS fallback triggered: {err}")
        return None


def transcribe_with_addis(audio_bytes: bytes, filename: str, language: str = "am") -> Optional[str]:
    client = _get_client()
    if not client:
        return None
    suffix = os.path.splitext(filename or "audio.webm")[1] or ".webm"
    suffix = "." + "".join(ch for ch in suffix.lstrip(".") if ch.isalnum())[:8] if len(suffix) > 1 else ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        with open(tmp_path, "rb") as audio_file:
            res = client.speech.transcribe(audio=audio_file, language=language)
        return (res.get("text") or "").strip()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)