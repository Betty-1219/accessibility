"""Security regression tests for SelamPath / AccessPath.

Run from the backend directory:

    python -m pytest tests -q
"""

import os
import tempfile

import pytest

_TMP_DIR = tempfile.mkdtemp(prefix="selampath-tests-")
os.environ.setdefault("DB_PATH", os.path.join(_TMP_DIR, "test.db"))
os.environ.setdefault("ENV", "test")
os.environ.setdefault("ENABLE_DOCS", "true")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, limiter  # noqa: E402
from app.storage import (  # noqa: E402
    OtpRateLimited,
    PersistentStorage,
    UserAlreadyExists,
)


@pytest.fixture()
def client():
    limiter._hits.clear()
    with TestClient(app) as test_client:
        yield test_client


def _user_payload(name: str, password: str = "correct-horse-9", contact: str = "+251911000111"):
    return {
        "full_name": name,
        "password": password,
        "preferred_language": "en",
        "preferences": {},
        "identity": {
            "route": "national_kebele_id",
            "document_number": "ID-123",
            "partner_name": "",
            "contact_value": contact,
            "otp_verified": True,
        },
        "support_needs": ["screen_reader_compatible"],
    }


def test_security_headers_present(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_submit_rejected_without_verified_contact(client):
    response = client.post("/api/v1/onboarding/submit", json=_user_payload("Unverified Learner"))
    assert response.status_code == 400
    assert "verify" in response.json()["detail"].lower()


def test_client_supplied_otp_flag_is_ignored(client):
    payload = _user_payload("Flag Spoof Learner")
    payload["identity"]["otp_verified"] = True
    response = client.post("/api/v1/onboarding/submit", json=payload)
    assert response.status_code == 400


def test_duplicate_name_cannot_reset_password():
    name = "Duplicate Learner"
    PersistentStorage.save_user(
        {
            "full_name": name,
            "password": "original-pass-1",
            "preferred_language": "en",
            "preferences": {},
            "identity": {},
        }
    )
    with pytest.raises(UserAlreadyExists):
        PersistentStorage.save_user(
            {
                "full_name": name,
                "password": "attacker-pass-2",
                "preferred_language": "en",
                "preferences": {},
                "identity": {},
            }
        )
    assert PersistentStorage.authenticate_user(name, "original-pass-1") is not None
    assert PersistentStorage.authenticate_user(name, "attacker-pass-2") is None


def test_duplicate_name_is_case_insensitive():
    PersistentStorage.save_user(
        {
            "full_name": "Case Learner",
            "password": "case-pass-123",
            "preferred_language": "en",
            "preferences": {},
            "identity": {},
        }
    )
    with pytest.raises(UserAlreadyExists):
        PersistentStorage.save_user(
            {
                "full_name": "case learner",
                "password": "case-pass-456",
                "preferred_language": "en",
                "preferences": {},
                "identity": {},
            }
        )


def test_short_password_is_rejected(client):
    payload = _user_payload("Short Pass Learner", password="short")
    response = client.post("/api/v1/onboarding/submit", json=payload)
    assert response.status_code == 422


def test_job_posting_requires_authentication(client):
    response = client.post(
        "/api/v1/career/jobs",
        json={
            "title": "Community Support Officer",
            "employer_name": "Example NGO",
            "location": "Addis Ababa",
            "description": "Support learners with accessible tools.",
            "accommodations_offered": ["screen_reader_compatible"],
        },
    )
    assert response.status_code == 401


def test_job_application_requires_authentication(client):
    response = client.post(
        "/api/v1/career/apply",
        json={
            "job_id": "job-1",
            "applicant_name": "Applicant Name",
            "applicant_contact": "+251911000222",
            "voice_pitch_transcript": "I would like to apply for this role.",
            "interview_accommodations": "",
            "support_needs": [],
        },
    )
    assert response.status_code == 401


def test_application_to_unknown_job_returns_404(client):
    user_id = PersistentStorage.save_user(
        {
            "full_name": "Unknown Job Learner",
            "password": "unknown-job-12",
            "preferred_language": "en",
            "preferences": {},
            "identity": {"contact_value": "unknown-job@example.com"},
        }
    )
    token = PersistentStorage.create_session(user_id)
    response = client.post(
        "/api/v1/career/apply",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "job_id": "job-does-not-exist",
            "applicant_name": "Unknown Job Learner",
            "applicant_contact": "unknown-job@example.com",
            "voice_pitch_transcript": "I would like to apply for this role.",
            "interview_accommodations": "",
            "support_needs": [],
        },
    )
    assert response.status_code == 404


def test_logout_revokes_session(client):
    name = "Logout Learner"
    user_id = PersistentStorage.save_user(
        {
            "full_name": name,
            "password": "logout-pass-12",
            "preferred_language": "en",
            "preferences": {},
            "identity": {"contact_value": "logout@example.com"},
        }
    )
    token = PersistentStorage.create_session(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/v1/career/dashboard", headers=headers).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/career/dashboard", headers=headers).status_code == 401


def test_career_passport_requires_authentication(client):
    response = client.get("/api/v1/career/passport")
    assert response.status_code == 401


def test_career_passport_summarizes_progress(client):
    contact = "passport@example.com"
    code = PersistentStorage.create_otp(contact)
    assert PersistentStorage.verify_otp(contact, code) is True
    assert PersistentStorage.consume_contact_verification(contact) is True
    user_id = PersistentStorage.save_user(
        {
            "full_name": "Passport Learner",
            "password": "passport-pass-1",
            "preferred_language": "en",
            "preferences": {},
            "identity": {"contact_value": contact},
            "support_needs": ["screen_reader_compatible"],
        }
    )
    token = PersistentStorage.create_session(user_id)
    PersistentStorage.set_selected_career(user_id, "software-dev")
    PersistentStorage.set_stage_progress(user_id, "software-dev", "sd-1", True)

    response = client.get(
        "/api/v1/career/passport",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    passport = response.json()
    assert passport["passport_id"].startswith("AP-")
    assert passport["learner"]["name"] == "Passport Learner"
    assert passport["learner"]["contact_verified"] is True
    assert passport["career"]["id"] == "software-dev"
    assert passport["progress_percent"] > 0
    assert passport["readiness"]["level"] == "building"
    assert "Python Basics" in passport["acquired_skills"]
    assert passport["applications"]["count"] == 0


def test_unknown_draft_fields_are_rejected(client):
    response = client.post(
        "/api/v1/onboarding/session",
        json={"step": 1, "data": {"full_name": "Draft Learner", "is_admin": True}},
    )
    assert response.status_code == 422


def test_unsupported_job_filter_is_rejected(client):
    response = client.get("/api/v1/career/jobs?support=not_a_real_accommodation")
    assert response.status_code == 400


def test_otp_cooldown_blocks_rapid_resend():
    contact = "+251911999888"
    PersistentStorage.create_otp(contact)
    with pytest.raises(OtpRateLimited):
        PersistentStorage.create_otp(contact)


def test_otp_is_single_use():
    contact = "+251911999777"
    code = PersistentStorage.create_otp(contact)
    assert PersistentStorage.verify_otp(contact, code) is True
    assert PersistentStorage.consume_contact_verification(contact) is True
    assert PersistentStorage.consume_contact_verification(contact) is False
