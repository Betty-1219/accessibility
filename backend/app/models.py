import json
import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

NAME_RE = re.compile(r"^[A-Za-z\u1200-\u137F\u1380-\u139F\u2D80-\u2DDF\u2019' .\-]+$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9\s\-()]{6,19}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
DRAFT_KEYS = {
    "full_name",
    "preferred_language",
    "preferences",
    "identity",
    "support_needs",
}
MAX_DRAFT_CHARS = 32_000


def _clean_text(value: str, field: str, max_len: int) -> str:
    text = (value or "").strip()
    if CONTROL_RE.search(text):
        raise ValueError(f"{field} contains unsupported control characters.")
    if len(text) > max_len:
        raise ValueError(f"{field} must be {max_len} characters or fewer.")
    return text


def _validate_name(value: str) -> str:
    name = _clean_text(value, "Full name", 120)
    if len(name) < 2 or not NAME_RE.match(name):
        raise ValueError("Full name must contain letters, spaces, apostrophes or hyphens only.")
    return name


def _validate_contact(value: str) -> str:
    contact = (value or "").strip()
    if len(contact) > 254:
        raise ValueError("Contact must be 254 characters or fewer.")
    if not (PHONE_RE.match(contact) or EMAIL_RE.match(contact)):
        raise ValueError("Enter a valid phone number or email address.")
    return contact


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
    custom_bg: str = Field(default="#000000", max_length=7)
    custom_fg: str = Field(default="#FFFF00", max_length=7)
    zoom_percent: int = Field(default=100, ge=80, le=200)
    tts_enabled: bool = False
    stt_enabled: bool = False
    language: Literal["en", "am"] = "en"

    @field_validator("custom_bg", "custom_fg")
    @classmethod
    def validate_hex(cls, value: str) -> str:
        if not re.match(r"^#[0-9A-Fa-f]{6}$", value):
            raise ValueError("Colours must be six-digit hex values, e.g. #000000.")
        return value


class IdentityVerification(BaseModel):
    route: Literal[
        "national_kebele_id",
        "refugee_id",
        "alt_doc",
        "partner_referral",
    ] = "national_kebele_id"
    document_number: Optional[str] = Field(default="", max_length=64)
    partner_name: Optional[str] = Field(default="", max_length=120)
    contact_value: str = Field(..., max_length=254)
    # Accepted for compatibility only. The server verifies the OTP itself.
    otp_verified: bool = False

    @field_validator("document_number", "partner_name")
    @classmethod
    def clean_reference(cls, value: Optional[str]) -> str:
        return _clean_text(value or "", "Reference", 120)

    @field_validator("contact_value")
    @classmethod
    def validate_contact(cls, value: str) -> str:
        return _validate_contact(value)


class OnboardingSubmission(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    password: str = Field(..., min_length=8, max_length=128)
    preferred_language: Literal["en", "am"] = "en"
    preferences: AccessibilityPreferences = Field(default_factory=AccessibilityPreferences)
    identity: IdentityVerification
    support_needs: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("full_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _validate_name(value)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Passcode cannot be blank.")
        return value

    @field_validator("support_needs")
    @classmethod
    def validate_support_needs(cls, values: List[str]) -> List[str]:
        cleaned = []
        for item in values:
            text = _clean_text(str(item), "Support need", 64)
            if text:
                cleaned.append(text)
        return cleaned


class OnboardingDraftRequest(BaseModel):
    token: Optional[str] = Field(default=None, max_length=64)
    step: int = Field(default=1, ge=0, le=100)
    data: dict = Field(default_factory=dict)

    @field_validator("data")
    @classmethod
    def validate_draft(cls, value: dict) -> dict:
        unknown = set(value.keys()) - DRAFT_KEYS
        if unknown:
            raise ValueError("Draft contains unsupported fields.")
        if len(json.dumps(value, ensure_ascii=False)) > MAX_DRAFT_CHARS:
            raise ValueError("Draft is too large.")
        return value


class PartnerReferralRequest(BaseModel):
    partner_name: str = Field(..., min_length=2, max_length=120)
    learner_name: str = Field(..., min_length=2, max_length=120)
    learner_contact: str = Field(..., max_length=254)
    consent_confirmed: bool

    @field_validator("partner_name")
    @classmethod
    def validate_partner(cls, value: str) -> str:
        return _clean_text(value, "Partner name", 120)

    @field_validator("learner_name")
    @classmethod
    def validate_learner(cls, value: str) -> str:
        return _validate_name(value)

    @field_validator("learner_contact")
    @classmethod
    def validate_contact(cls, value: str) -> str:
        return _validate_contact(value)


class CareerSelectRequest(BaseModel):
    career_id: str = Field(..., min_length=2, max_length=64)


class StageProgressRequest(BaseModel):
    career_id: str = Field(..., min_length=2, max_length=64)
    stage_id: str = Field(..., min_length=2, max_length=64)
    completed: bool = True


class PreferencesUpdateRequest(BaseModel):
    preferences: AccessibilityPreferences


class JobPostingCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    employer_name: str = Field(..., min_length=2, max_length=120)
    location: str = Field(default="Addis Ababa / Remote", max_length=120)
    description: str = Field(..., min_length=5, max_length=4000)
    accommodations_offered: List[str] = Field(default_factory=list, max_length=12)

    @field_validator("title", "employer_name", "location", "description")
    @classmethod
    def clean(cls, value: str) -> str:
        text = _clean_text(value, "Job field", 4000)
        if "<" in text or ">" in text:
            raise ValueError("Job postings must be plain text (no HTML).")
        return text

    @field_validator("accommodations_offered")
    @classmethod
    def clean_accommodations(cls, values: List[str]) -> List[str]:
        cleaned = []
        for item in values:
            text = _clean_text(str(item), "Accommodation", 64)
            if text and re.match(r"^[a-z0-9_\-]+$", text):
                cleaned.append(text)
        return cleaned


class JobApplicationRequest(BaseModel):
    job_id: str = Field(..., min_length=2, max_length=64)
    applicant_name: str = Field(..., min_length=2, max_length=120)
    applicant_contact: str = Field(..., max_length=254)
    voice_pitch_transcript: str = Field(..., min_length=3, max_length=3000)
    interview_accommodations: Optional[str] = Field(default="", max_length=500)
    support_needs: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("applicant_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _validate_name(value)

    @field_validator("applicant_contact")
    @classmethod
    def validate_contact(cls, value: str) -> str:
        return _validate_contact(value)

    @field_validator("voice_pitch_transcript", "interview_accommodations")
    @classmethod
    def clean(cls, value: Optional[str]) -> str:
        return _clean_text(value or "", "Application text", 3000)


class LoginRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    language: Literal["en", "am"] = "en"


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=500)
    language: Literal["en", "am"] = "en"
    step: int = Field(default=1, ge=0, le=100)


class OTPSendRequest(BaseModel):
    contact_value: str = Field(..., max_length=254)
    language: Literal["en", "am"] = "en"

    @field_validator("contact_value")
    @classmethod
    def validate_contact(cls, value: str) -> str:
        return _validate_contact(value)


class OTPVerifyRequest(BaseModel):
    contact_value: str = Field(..., max_length=254)
    code: str = Field(..., min_length=4, max_length=10)

    @field_validator("contact_value")
    @classmethod
    def validate_contact(cls, value: str) -> str:
        return _validate_contact(value)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value or "")
        if len(digits) != 6:
            raise ValueError("Verification code must be six digits.")
        return digits
