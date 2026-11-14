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
        if any(w in q for w in ["ስም", "name", "ይለፍ", "password", "ምዝገባ"]):
            return "በደረጃ 1 ሙሉ ስምዎን እና ቢያንስ 4 ፊደል ያለው የይለፍ ቃል ያስገቡ። 'Speak' የሚለውን በመጫን በድምፅ መናገር ይችላሉ።"
        if any(w in q for w in ["ንፅፅር", "contrast", "zoom", "ማጉላት", "ቀለም"]):
            return "ከላይ ባለው 'ንፅፅር' ቁልፍ የቀለም ንፅፅር መቀየር፣ እንዲሁም በ 'አጉላ (+)' ጽሑፉን ማሳደግ ይችላሉ።"
        if any(w in q for w in ["መታወቂያ", "id", "otp", "ስልክ", "ማረጋገጫ"]):
            return "በደረጃ 2 ብሔራዊ/ቀበሌ መታወቂያ፣ የስደተኞች መታወቂያ ወይም ያለ መታወቂያ በአጋር ድርጅት በኩል ማረጋገጥ ይችላሉ።"
        return f"አሁን ያሉት በደረጃ {step} ላይ ነው። ለመጻፍ 'Speak' ቁልፍን ይጫኑ፣ ወይም ድምፅ ለማቆም Escape (Esc) ይጫኑ።"

    if any(w in q for w in ["contrast", "color", "vision", "zoom", "see", "big"]):
        return "Click Contrast in the top bar to pick Yellow-on-Black, White-on-Black, or custom colors, and use Zoom (+) to enlarge text up to 200%."
    if any(w in q for w in ["voice", "speak", "mic", "blind", "stop", "mute"]):
        return "Click the Speak button beside any box to dictate your answer. Press Escape (Esc) or click Pause Voice anytime to silence speech."
    if any(w in q for w in ["id", "verify", "otp", "refugee", "partner", "code"]):
        return "In Step 2, you can verify with a National/Kebele ID, Refugee ID, Alternative Document, or Partner Referral (no ID needed), then confirm via SMS/Audio OTP."
    if any(w in q for w in ["password", "name", "step 1", "register"]):
        return "In Step 1, type or speak your full name and a password of at least 4 characters, then click Next."
    return f"You are on Step {step}. Use the Speak buttons for voice input, Contrast/Zoom in the top bar for visibility, or Next/Back to navigate."


def process_addis_text(prompt: str, language: str = "en", step: int = 0) -> str:
    client = _get_client()
    if client:
        try:
            lang_instruction = (
                "Reply clearly and concisely in Amharic."
                if language == "am"
                else "Reply clearly and concisely in English."
            )
            system_msg = (
                "You are the Digital Bridge Accessibility Assistant for ALX Ethiopia. "
                "Help learners with visual, motor, or hearing disabilities complete registration. "
                f"Current onboarding step: {step}. {lang_instruction}"
            )
            res = client.chat.completions.create(
                language="am",
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