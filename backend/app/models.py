from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class AccessibilityPreferences(BaseModel):
    profile_type: Literal[
        "standard",
        "blind",
        "low_vision",
        "physical_motor",
        "low_literacy",
        "deaf_hard_of_hearing",
    ] = "standard"
    contrast_mode: Literal[
        "default",
        "dark_yellow",
        "light_yellow",
        "dark_white",
        "custom",
    ] = "default"
    custom_bg: str = "#000000"
    custom_fg: str = "#FFFF00"
    zoom_percent: int = Field(default=100, ge=80, le=200)
    tts_enabled: bool = False
    stt_enabled: bool = False
    language: Literal["en", "am"] = "en"


class IdentityVerification(BaseModel):
    route: Literal[
        "national_kebele_id",
        "refugee_id",
        "alt_doc",
        "partner_referral",
    ] = "national_kebele_id"
    document_number: Optional[str] = ""
    partner_name: Optional[str] = ""
    contact_value: str
    otp_verified: bool = False


class OnboardingSubmission(BaseModel):
    full_name: str = Field(..., min_length=2)
    password: str = Field(..., min_length=4)
    preferred_language: Literal["en", "am"] = "en"
    preferences: AccessibilityPreferences = Field(default_factory=AccessibilityPreferences)
    identity: IdentityVerification
    support_needs: List[str] = []


class OnboardingDraftRequest(BaseModel):
    token: Optional[str] = None
    step: int = 1
    data: dict = Field(default_factory=dict)


class PartnerReferralRequest(BaseModel):
    partner_name: str = Field(..., min_length=2)
    learner_name: str = Field(..., min_length=2)
    learner_contact: str = Field(..., min_length=3)
    consent_confirmed: bool


class CareerSelectRequest(BaseModel):
    career_id: str = Field(..., min_length=2)


class StageProgressRequest(BaseModel):
    career_id: str = Field(..., min_length=2)
    stage_id: str = Field(..., min_length=2)
    completed: bool = True


class PreferencesUpdateRequest(BaseModel):
    preferences: AccessibilityPreferences


class JobPostingCreate(BaseModel):
    title: str = Field(..., min_length=2)
    employer_name: str = Field(..., min_length=2)
    location: str = "Addis Ababa / Remote"
    description: str = Field(..., min_length=5)
    accommodations_offered: List[str] = []


class JobApplicationRequest(BaseModel):
    job_id: str
    applicant_name: str = Field(..., min_length=2)
    applicant_contact: str = Field(..., min_length=3)
    voice_pitch_transcript: str = Field(..., min_length=3)
    interview_accommodations: Optional[str] = ""
    support_needs: List[str] = []


class LoginRequest(BaseModel):
    full_name: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    language: Literal["en", "am"] = "en"


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    language: Literal["en", "am"] = "en"
    step: int = 1


class OTPSendRequest(BaseModel):
    contact_value: str
    language: Literal["en", "am"] = "en"


class OTPVerifyRequest(BaseModel):
    contact_value: str
    code: str