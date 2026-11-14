import os
import edge_tts
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .addis_ai_service import (
    generate_addis_tts_bytes,
    process_addis_text,
    transcribe_with_addis,
)
from .models import (
    ChatRequest,
    LoginRequest,
    OTPSendRequest,
    OTPVerifyRequest,
    OnboardingSubmission,
    TTSRequest,
    TokenResponse,
)
from .storage import PersistentStorage, init_db

load_dotenv()
init_db()

app = FastAPI(title="Digital Bridge Accessible Onboarding API", version="2.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

HF_TOKEN = os.getenv("HUGGINGFACE_API_KEY")


@app.get("/api/v1/health")
def health_check():
    return {"status": "healthy", "service": "digital-bridge-backend"}


@app.post("/api/v1/onboarding/send-otp")
def send_otp(req: OTPSendRequest):
    if not req.contact_value.strip():
        raise HTTPException(status_code=400, detail="Contact value is required.")
    code = PersistentStorage.create_otp(req.contact_value)
    return {
        "success": True,
        "message": "Verification code sent.",
        "demo_code": code,
    }


@app.post("/api/v1/onboarding/verify-otp")
def verify_otp(req: OTPVerifyRequest):
    verified = PersistentStorage.verify_otp(req.contact_value, req.code)
    if not verified:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code.")
    return {"success": True, "verified": True}


@app.post("/api/v1/onboarding/submit", response_model=TokenResponse)
def submit_onboarding(data: OnboardingSubmission):
    user_dict = data.model_dump()
    user_id = PersistentStorage.save_user(user_dict)
    session_token = PersistentStorage.create_session(user_id)

    public_user = {k: v for k, v in user_dict.items() if k != "password"}
    return {
        "access_token": session_token,
        "token_type": "bearer",
        "user": public_user,
    }


@app.post("/api/v1/auth/login", response_model=TokenResponse)
def login(data: LoginRequest):
    user = PersistentStorage.authenticate_user(data.full_name, data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials or user not found.")

    session_token = PersistentStorage.create_session(user["id"])
    return {
        "access_token": session_token,
        "token_type": "bearer",
        "user": user,
    }


@app.get("/api/v1/auth/me")
def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization token.")

    token = authorization.split(" ", 1)[1]
    user = PersistentStorage.get_user_by_session(token)
    if not user:
        raise HTTPException(status_code=403, detail="Session expired or invalid.")

    return {"authenticated": True, "user": user}


@app.post("/api/v1/voice/tts")
async def generate_speech(req: TTSRequest):
    # 1. Addis AI native Amharic voice (if ADDIS_API_KEY configured)
    addis_audio = generate_addis_tts_bytes(req.text, req.language)
    if addis_audio:
        audio_bytes, media_type = addis_audio
        return Response(content=audio_bytes, media_type=media_type)

    # 2. Free Edge Neural TTS (supports Amharic am-ET-MekdesNeural & English en-US-AriaNeural)
    try:
        voice = "am-ET-MekdesNeural" if req.language == "am" else "en-US-AriaNeural"
        communicate = edge_tts.Communicate(req.text, voice)
        mp3_bytes = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                mp3_bytes += chunk["data"]
        if mp3_bytes:
            return Response(content=mp3_bytes, media_type="audio/mpeg")
    except Exception as err:
        print(f"Edge TTS failed: {err}")

    # 3. Hugging Face Inference fallback
    if not HF_TOKEN:
        raise HTTPException(status_code=503, detail="TTS unavailable (Edge TTS failed and no API key configured).")

    model_id = "facebook/mms-tts-amh" if req.language == "am" else "facebook/mms-tts-eng"
    url = f"https://router.huggingface.co/hf-inference/models/{model_id}"
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, headers=headers, json={"inputs": req.text})

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Hugging Face TTS error: {response.text}")

    return Response(content=response.content, media_type=response.headers.get("content-type", "audio/flac"))


@app.post("/api/v1/voice/stt")
async def speech_to_text(file: UploadFile = File(...), language: str = Form("en")):
    audio_bytes = await file.read()

    # 1. Addis AI Speech-to-Text (when ADDIS_API_KEY configured)
    try:
        addis_text = transcribe_with_addis(audio_bytes, file.filename or "voice.webm", language)
        if addis_text is not None:
            return {"success": True, "transcript": addis_text}
    except Exception as err:
        print(f"AddisAI STT fallback triggered: {err}")

    # 2. Hugging Face Inference fallback (Whisper large-v3)
    if not HF_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Server STT requires ADDIS_API_KEY or HUGGINGFACE_API_KEY in backend/.env (use Chrome/Edge for built-in browser STT).",
        )

    url = "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3"
    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "Content-Type": file.content_type or "audio/webm",
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(url, headers=headers, content=audio_bytes)

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Hugging Face STT error: {response.text}")

    result = response.json()
    return {
        "success": True,
        "transcript": (result.get("text") or "").strip(),
    }


@app.post("/api/v1/ai/chat")
def addis_ai_chat(req: ChatRequest):
    try:
        result = process_addis_text(req.prompt, req.language, req.step)
        return {"success": True, "response": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))