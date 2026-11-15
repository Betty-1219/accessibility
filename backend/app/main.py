import os
from typing import Optional
import edge_tts
import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .addis_ai_service import (
    generate_addis_tts_bytes,
    process_addis_text,
    transcribe_with_addis,
)
from .models import (
    CareerSelectRequest,
    ChatRequest,
    JobApplicationRequest,
    JobPostingCreate,
    LoginRequest,
    OTPSendRequest,
    OTPVerifyRequest,
    OnboardingDraftRequest,
    OnboardingSubmission,
    PartnerReferralRequest,
    PreferencesUpdateRequest,
    StageProgressRequest,
    TTSRequest,
    TokenResponse,
)
from .storage import PersistentStorage, init_db

load_dotenv()
init_db()

app = FastAPI(title="Digital Bridge & AccessPath API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

HF_TOKEN = os.getenv("HUGGINGFACE_API_KEY")
SMS_WEBHOOK_URL = os.getenv("SMS_WEBHOOK_URL")

ACCESSPATH_CAREERS = [
    {
        "id": "software-dev",
        "title": "Software Development",
        "description": "Build accessible websites, APIs, and software tools using HTML, CSS, JavaScript, and Python.",
        "required_skills": [
            "Problem Solving",
            "HTML & CSS",
            "JavaScript",
            "Python",
            "Git",
            "WCAG Accessibility",
        ],
        "learning_requirements": "Basic keyboard literacy and willingness to practice coding step-by-step.",
        "opportunities": [
            "Junior Web Developer",
            "Backend Python Developer",
            "Accessibility QA Engineer",
        ],
        "roadmap": [
            {
                "id": "sd-1",
                "title": "Programming Fundamentals",
                "objectives": "Variables, loops, conditions, and problem solving.",
                "skills": ["Logic", "Python Basics"],
                "resources": "ALX Accessible Python Starter Guide (Text + Audio)",
            },
            {
                "id": "sd-2",
                "title": "HTML and CSS",
                "objectives": "Semantic HTML landmarks, labels, and WCAG contrast.",
                "skills": ["Semantic HTML", "CSS Layout"],
                "resources": "WCAG Semantic HTML Handbook",
            },
            {
                "id": "sd-3",
                "title": "JavaScript",
                "objectives": "DOM interaction, events, and keyboard accessibility.",
                "skills": ["Vanilla JS", "ARIA Live Regions"],
                "resources": "Accessible Vanilla JS Workbook",
            },
            {
                "id": "sd-4",
                "title": "Frontend Development",
                "objectives": "Build screen-reader tested reusable Web Components.",
                "skills": ["Web Components", "State Management"],
                "resources": "Savanna UI Component Labs",
            },
            {
                "id": "sd-5",
                "title": "Backend Development",
                "objectives": "Create REST APIs with FastAPI and validation.",
                "skills": ["FastAPI", "REST APIs"],
                "resources": "Python FastAPI Audio-Friendly Guide",
            },
            {
                "id": "sd-6",
                "title": "Database Fundamentals",
                "objectives": "Store and query user data safely with SQL.",
                "skills": ["SQLite", "Data Modeling"],
                "resources": "SQL Fundamentals Walkthrough",
            },
            {
                "id": "sd-7",
                "title": "Portfolio Development",
                "objectives": "Ship 2 tested, accessible real-world projects.",
                "skills": ["GitHub", "axe-core Testing"],
                "resources": "Portfolio Checklist & NVDA Guide",
            },
            {
                "id": "sd-8",
                "title": "Job Readiness",
                "objectives": "Prepare voice pitches, CV, and accommodation requests.",
                "skills": ["Interviewing", "Self-Advocacy"],
                "resources": "AccessPath Interview Readiness Pack",
            },
        ],
    },
    {
        "id": "ui-ux-design",
        "title": "UI/UX Design",
        "description": "Design inclusive digital products, clear user flows, and accessible interfaces for everyone.",
        "required_skills": [
            "User Research",
            "Information Architecture",
            "Accessible Contrast",
            "Prototyping",
            "Usability Testing",
        ],
        "learning_requirements": "Curiosity about how diverse people use phones and computers.",
        "opportunities": [
            "Accessible UX Researcher",
            "Product Designer",
            "Inclusive Design Specialist",
        ],
        "roadmap": [
            {
                "id": "ux-1",
                "title": "Foundations of Human-Centered Design",
                "objectives": "Learn co-design with users with disabilities.",
                "skills": ["Empathy", "Co-Design"],
                "resources": "Inclusive Design Principles Audio Brief",
            },
            {
                "id": "ux-2",
                "title": "User Research & Interviews",
                "objectives": "Run accessible interviews and synthesize findings.",
                "skills": ["Interviewing", "Personas"],
                "resources": "Research Script Templates",
            },
            {
                "id": "ux-3",
                "title": "Information Architecture & Flows",
                "objectives": "Structure clear, low-cognitive-load journeys.",
                "skills": ["Task Flows", "Plain Language"],
                "resources": "One-Question-Per-Screen Guide",
            },
            {
                "id": "ux-4",
                "title": "Accessible Visual & Audio Systems",
                "objectives": "Apply WCAG 2.2 AA contrast, focus, and audio cues.",
                "skills": ["WCAG 2.2 AA", "Color & Typography"],
                "resources": "Contrast & Reflow Lab",
            },
            {
                "id": "ux-5",
                "title": "Usability Testing with Screen Readers",
                "objectives": "Test flows with NVDA, TalkBack, and keyboard-only.",
                "skills": ["NVDA Testing", "TalkBack Testing"],
                "resources": "Screen Reader Testing Playbook",
            },
            {
                "id": "ux-6",
                "title": "Portfolio & Job Readiness",
                "objectives": "Present accessible case studies to employers.",
                "skills": ["Case Studies", "Storytelling"],
                "resources": "UX Portfolio Guide",
            },
        ],
    },
    {
        "id": "data-analysis",
        "title": "Data Analysis",
        "description": "Analyze data, write SQL queries, and communicate clear insights for Ethiopian businesses.",
        "required_skills": [
            "Spreadsheets",
            "SQL",
            "Python / Pandas",
            "Data Cleaning",
            "Accessible Reporting",
        ],
        "learning_requirements": "Basic numeracy and logical thinking.",
        "opportunities": [
            "Junior Data Analyst",
            "Operations Analyst",
            "Research & M&E Assistant",
        ],
        "roadmap": [
            {
                "id": "da-1",
                "title": "Data Literacy & Spreadsheets",
                "objectives": "Keyboard-driven formulas, sorting, and summaries.",
                "skills": ["Formulas", "Data Cleaning"],
                "resources": "Keyboard Spreadsheet Guide",
            },
            {
                "id": "da-2",
                "title": "SQL Querying",
                "objectives": "Filter, join, and aggregate relational tables.",
                "skills": ["SQL", "Aggregations"],
                "resources": "SQL Exercises (Plain Text)",
            },
            {
                "id": "da-3",
                "title": "Python for Data",
                "objectives": "Automate analysis with CSV and Python scripts.",
                "skills": ["Python", "CSV Processing"],
                "resources": "Python Data Scripts Lab",
            },
            {
                "id": "da-4",
                "title": "Accessible Data Storytelling",
                "objectives": "Write alt-text and structured tables for insights.",
                "skills": ["Alt-Text", "Executive Summaries"],
                "resources": "Accessible Chart Descriptions Guide",
            },
            {
                "id": "da-5",
                "title": "Capstone & Job Readiness",
                "objectives": "Publish a real dataset report and practice interviews.",
                "skills": ["Portfolio", "Presentation"],
                "resources": "Analyst Interview Prep",
            },
        ],
    },
    {
        "id": "cybersecurity",
        "title": "Cybersecurity",
        "description": "Protect systems, networks, and user privacy through security monitoring and ethical testing.",
        "required_skills": [
            "Networking Basics",
            "Linux CLI",
            "Risk Assessment",
            "Threat Detection",
            "Incident Response",
        ],
        "learning_requirements": "Comfort using command-line tools (highly screen-reader friendly).",
        "opportunities": [
            "Junior SOC Analyst",
            "Information Security Assistant",
            "IT Audit Trainee",
        ],
        "roadmap": [
            {
                "id": "cy-1",
                "title": "Networking & Linux CLI",
                "objectives": "Navigate Linux terminals and understand TCP/IP.",
                "skills": ["Linux CLI", "TCP/IP"],
                "resources": "Screen-Reader Linux Terminal Guide",
            },
            {
                "id": "cy-2",
                "title": "Security Foundations & Privacy",
                "objectives": "CIA triad, hashing, authentication, and OTP safety.",
                "skills": ["Cryptography Basics", "Auth"],
                "resources": "Security Core Audio Brief",
            },
            {
                "id": "cy-3",
                "title": "Web & Application Threats",
                "objectives": "Identify OWASP Top 10 and injection risks.",
                "skills": ["OWASP", "Auditing"],
                "resources": "Web Security Labs",
            },
            {
                "id": "cy-4",
                "title": "Monitoring & Incident Response",
                "objectives": "Read logs and triage security alerts.",
                "skills": ["Log Analysis", "Triage"],
                "resources": "SOC Playbooks",
            },
            {
                "id": "cy-5",
                "title": "Certification & Job Readiness",
                "objectives": "Build lab write-ups and apply for security roles.",
                "skills": ["Documentation", "Interviewing"],
                "resources": "Cyber Career Pack",
            },
        ],
    },
    {
        "id": "cloud-computing",
        "title": "Cloud Computing",
        "description": "Deploy, automate, and scale applications in the cloud using CLI, Docker, and Linux.",
        "required_skills": [
            "Linux",
            "Docker",
            "Cloud Infrastructure",
            "Networking",
            "Automation",
        ],
        "learning_requirements": "Basic familiarity with files and command line.",
        "opportunities": [
            "Junior Cloud Support Engineer",
            "DevOps Trainee",
            "Systems Administrator",
        ],
        "roadmap": [
            {
                "id": "cc-1",
                "title": "Linux & Shell Scripting",
                "objectives": "Manage processes, files, and bash scripts.",
                "skills": ["Bash", "Linux"],
                "resources": "CLI Mastery Guide",
            },
            {
                "id": "cc-2",
                "title": "Containers & Docker",
                "objectives": "Package apps with Dockerfiles and Compose.",
                "skills": ["Docker", "Docker Compose"],
                "resources": "Docker Hands-On Text Lab",
            },
            {
                "id": "cc-3",
                "title": "Cloud Services & Storage",
                "objectives": "Manage compute, object storage, and IAM permissions.",
                "skills": ["IAM", "Cloud Storage"],
                "resources": "Cloud Architecture Notes",
            },
            {
                "id": "cc-4",
                "title": "Reliability & Monitoring",
                "objectives": "Configure health checks, logs, and backups.",
                "skills": ["Monitoring", "Backups"],
                "resources": "Ops Reliability Guide",
            },
            {
                "id": "cc-5",
                "title": "Portfolio & Job Readiness",
                "objectives": "Deploy a live full-stack container project.",
                "skills": ["Deployment", "Interviews"],
                "resources": "Cloud Career Prep",
            },
        ],
    },
    {
        "id": "digital-marketing",
        "title": "Digital Marketing",
        "description": "Grow brands and reach audiences through accessible content, SEO, analytics, and campaigns.",
        "required_skills": [
            "Copywriting",
            "SEO",
            "Content Strategy",
            "Analytics",
            "Community Management",
        ],
        "learning_requirements": "Good communication in Amharic, English, or local languages.",
        "opportunities": [
            "Digital Marketing Assistant",
            "Accessible Content Creator",
            "Social Media Coordinator",
        ],
        "roadmap": [
            {
                "id": "dm-1",
                "title": "Marketing & Audience Foundations",
                "objectives": "Define audience segments and clear messaging.",
                "skills": ["Positioning", "Personas"],
                "resources": "Marketing Basics Audio Guide",
            },
            {
                "id": "dm-2",
                "title": "Accessible Content & Copywriting",
                "objectives": "Write plain-language posts with alt text and captions.",
                "skills": ["Copywriting", "Alt-Text"],
                "resources": "Inclusive Content Playbook",
            },
            {
                "id": "dm-3",
                "title": "SEO & Search Visibility",
                "objectives": "Structure headings and keywords for search.",
                "skills": ["SEO", "Keyword Research"],
                "resources": "SEO Text Guide",
            },
            {
                "id": "dm-4",
                "title": "Campaign Analytics",
                "objectives": "Measure reach, conversion, and ROI.",
                "skills": ["Analytics", "Reporting"],
                "resources": "Metrics Workbook",
            },
            {
                "id": "dm-5",
                "title": "Campaign Portfolio & Job Readiness",
                "objectives": "Build a sample campaign and pitch employers.",
                "skills": ["Campaign Plan", "Pitching"],
                "resources": "Marketing Career Pack",
            },
        ],
    },
]

CAREER_MAP = {c["id"]: c for c in ACCESSPATH_CAREERS}


def require_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization token.")
    token = authorization.split(" ", 1)[1].strip()
    user = PersistentStorage.get_user_by_session(token)
    if not user:
        raise HTTPException(status_code=403, detail="Session expired or invalid.")
    return user


@app.get("/api/v1/health")
def health_check():
    return {"status": "healthy", "service": "digital-bridge-accesspath-backend"}


@app.post("/api/v1/onboarding/session")
def save_onboarding_session(req: OnboardingDraftRequest):
    token = PersistentStorage.save_draft(req.token, req.step, req.data)
    return {
        "token": token,
        "resume_url": f"?resume={token}",
        "sms_message": f"Digital Bridge: Resume your registration anytime with code {token}.",
    }


@app.get("/api/v1/onboarding/session/{token}")
def get_onboarding_session(token: str):
    draft = PersistentStorage.get_draft(token)
    if not draft:
        raise HTTPException(status_code=404, detail="Session token not found.")
    return draft


@app.post("/api/v1/referrals/partner", status_code=201)
def create_partner_referral(req: PartnerReferralRequest):
    if not req.consent_confirmed:
        raise HTTPException(status_code=400, detail="Learner consent must be confirmed.")
    ref_id = PersistentStorage.save_partner_referral(
        req.partner_name,
        req.learner_name,
        req.learner_contact,
        req.consent_confirmed,
    )
    return {"success": True, "referral_id": ref_id}


@app.post("/api/v1/onboarding/send-otp")
async def send_otp(req: OTPSendRequest):
    contact = req.contact_value.strip()
    if not contact:
        raise HTTPException(status_code=400, detail="Contact value is required.")
    code = PersistentStorage.create_otp(contact)

    if SMS_WEBHOOK_URL:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    SMS_WEBHOOK_URL,
                    json={"to": contact, "code": code, "language": req.language},
                )
        except Exception as err:
            print(f"SMS webhook dispatch failed: {err}")
    elif os.getenv("ENV", "development") != "production":
        print(f"[DEV OTP DISPATCH] Contact={contact} Code={code}")

    return {
        "success": True,
        "message": "A 6-digit verification code has been sent to your contact.",
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
    public_user["id"] = user_id
    public_user["selected_career_id"] = None
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
def get_current_user(user: dict = Depends(require_current_user)):
    return {"authenticated": True, "user": user}


@app.put("/api/v1/user/preferences")
def update_user_preferences(
    req: PreferencesUpdateRequest,
    user: dict = Depends(require_current_user),
):
    updated = PersistentStorage.update_preferences(user["id"], req.preferences.model_dump())
    return {"success": True, "user": updated}


@app.get("/api/v1/career/paths")
def list_career_paths():
    return {"careers": ACCESSPATH_CAREERS}


@app.get("/api/v1/career/dashboard")
def get_career_dashboard(user: dict = Depends(require_current_user)):
    career_id = user.get("selected_career_id")
    career = CAREER_MAP.get(career_id) if career_id else None
    completed_stages = PersistentStorage.get_career_progress(user["id"], career_id) if career else []
    roadmap = career["roadmap"] if career else []
    total = len(roadmap)
    done_count = len([s for s in roadmap if s["id"] in completed_stages])
    progress_pct = round((done_count / total) * 100) if total > 0 else 0
    next_stage = next((s for s in roadmap if s["id"] not in completed_stages), None)

    acquired_skills = []
    for s in roadmap:
        if s["id"] in completed_stages:
            acquired_skills.extend(s.get("skills", []))

    return {
        "user": user,
        "selected_career": career,
        "completed_stage_ids": completed_stages,
        "progress_percent": progress_pct,
        "completed_count": done_count,
        "total_stages": total,
        "recommended_next_stage": next_stage,
        "acquired_skills": acquired_skills,
        "jobs": PersistentStorage.list_jobs(limit=10),
    }


@app.post("/api/v1/career/select")
def select_career_path(
    req: CareerSelectRequest,
    user: dict = Depends(require_current_user),
):
    if req.career_id not in CAREER_MAP:
        raise HTTPException(status_code=404, detail="Career path not found.")
    updated = PersistentStorage.set_selected_career(user["id"], req.career_id)
    return {
        "success": True,
        "user": updated,
        "selected_career": CAREER_MAP[req.career_id],
    }


@app.post("/api/v1/career/progress")
def update_stage_progress(
    req: StageProgressRequest,
    user: dict = Depends(require_current_user),
):
    if req.career_id not in CAREER_MAP:
        raise HTTPException(status_code=404, detail="Career path not found.")
    completed_ids = PersistentStorage.set_stage_progress(
        user["id"], req.career_id, req.stage_id, req.completed
    )
    roadmap = CAREER_MAP[req.career_id]["roadmap"]
    total = len(roadmap)
    done_count = len([s for s in roadmap if s["id"] in completed_ids])
    return {
        "success": True,
        "completed_stage_ids": completed_ids,
        "progress_percent": round((done_count / total) * 100) if total > 0 else 0,
    }


@app.get("/api/v1/career/jobs")
def list_career_jobs(
    support: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    return {"jobs": PersistentStorage.list_jobs(support, q, limit, offset)}


@app.post("/api/v1/career/jobs", status_code=201)
def create_career_job(req: JobPostingCreate):
    return PersistentStorage.create_job(
        req.title,
        req.employer_name,
        req.location,
        req.description,
        req.accommodations_offered,
    )


@app.post("/api/v1/career/apply", status_code=201)
def apply_career_job(
    req: JobApplicationRequest,
    authorization: str = Header(None),
):
    user_id = None
    if authorization and authorization.startswith("Bearer "):
        u = PersistentStorage.get_user_by_session(authorization.split(" ", 1)[1].strip())
        if u:
            user_id = u["id"]
    app_id = PersistentStorage.save_job_application(
        user_id,
        req.job_id,
        req.applicant_name,
        req.applicant_contact,
        req.voice_pitch_transcript,
        req.interview_accommodations or "",
        req.support_needs,
    )
    return {"success": True, "application_id": app_id}


@app.post("/api/v1/voice/tts")
async def generate_speech(req: TTSRequest):
    addis_audio = generate_addis_tts_bytes(req.text, req.language)
    if addis_audio:
        audio_bytes, media_type = addis_audio
        return Response(content=audio_bytes, media_type=media_type)

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

    if not HF_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="TTS unavailable (Edge TTS failed and no API key configured).",
        )

    model_id = "facebook/mms-tts-amh" if req.language == "am" else "facebook/mms-tts-eng"
    url = f"https://router.huggingface.co/hf-inference/models/{model_id}"
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, headers=headers, json={"inputs": req.text})

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Hugging Face TTS error: {response.text}")

    return Response(
        content=response.content,
        media_type=response.headers.get("content-type", "audio/flac"),
    )


@app.post("/api/v1/voice/stt")
async def speech_to_text(file: UploadFile = File(...), language: str = Form("en")):
    audio_bytes = await file.read()

    try:
        addis_text = transcribe_with_addis(audio_bytes, file.filename or "voice.webm", language)
        if addis_text is not None:
            return {"success": True, "transcript": addis_text}
    except Exception as err:
        print(f"AddisAI STT fallback triggered: {err}")

    if not HF_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Server STT requires ADDIS_API_KEY or HUGGINGFACE_API_KEY in backend/.env.",
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
    return {"success": True, "transcript": (result.get("text") or "").strip()}


@app.post("/api/v1/ai/chat")
def addis_ai_chat(req: ChatRequest):
    try:
        result = process_addis_text(req.prompt, req.language, req.step)
        return {"success": True, "response": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))