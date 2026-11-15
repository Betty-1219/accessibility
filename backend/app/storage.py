import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_DB = (
    "/app/data/digital_bridge.db"
    if os.name == "posix" and os.path.isdir("/app/data")
    else str(_BACKEND_DIR / "digital_bridge.db")
)
DB_PATH = os.getenv("DB_PATH", _DEFAULT_DB)

SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "7"))
OTP_TTL_MINUTES = int(os.getenv("OTP_TTL_MINUTES", "15"))
OTP_COOLDOWN_SECONDS = int(os.getenv("OTP_COOLDOWN_SECONDS", "60"))
OTP_MAX_PER_HOUR = int(os.getenv("OTP_MAX_PER_HOUR", "5"))
VERIFICATION_TTL_MINUTES = int(os.getenv("VERIFICATION_TTL_MINUTES", "30"))


class UserAlreadyExists(Exception):
    """Raised when onboarding tries to register a name that is already taken."""


class OtpRateLimited(Exception):
    """Raised when an OTP is requested again too soon or too often."""

    def __init__(self, retry_after: int):
        super().__init__("Too many verification codes requested.")
        self.retry_after = max(1, int(retry_after))


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def init_db() -> None:
    with _get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT UNIQUE NOT NULL,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                preferred_language TEXT NOT NULL,
                preferences_json TEXT NOT NULL,
                identity_json TEXT NOT NULL,
                support_needs_json TEXT NOT NULL,
                selected_career_id TEXT DEFAULT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

            CREATE TABLE IF NOT EXISTS otp_codes (
                contact_value TEXT PRIMARY KEY,
                code_salt TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                expires_at TEXT NOT NULL,
                last_sent_at TEXT,
                send_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS contact_verifications (
                contact_value TEXT PRIMARY KEY,
                verified_at TEXT NOT NULL,
                used_at TEXT
            );

            CREATE TABLE IF NOT EXISTS onboarding_drafts (
                token TEXT PRIMARY KEY,
                step INTEGER NOT NULL,
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS partner_referrals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                partner_name TEXT NOT NULL,
                learner_name TEXT NOT NULL,
                learner_contact TEXT NOT NULL,
                consent_confirmed INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_stage_progress (
                user_id INTEGER NOT NULL,
                career_id TEXT NOT NULL,
                stage_id TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, career_id, stage_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_progress_user ON user_stage_progress(user_id, career_id);

            CREATE TABLE IF NOT EXISTS career_jobs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                employer_name TEXT NOT NULL,
                location TEXT NOT NULL,
                description TEXT NOT NULL,
                accommodations_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS career_applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                job_id TEXT NOT NULL,
                applicant_name TEXT NOT NULL,
                applicant_contact TEXT NOT NULL,
                voice_pitch_transcript TEXT NOT NULL,
                interview_accommodations TEXT DEFAULT '',
                support_needs_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_apps_job ON career_applications(job_id);
            """
        )

        cols = [r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "selected_career_id" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN selected_career_id TEXT DEFAULT NULL;")

        otp_cols = [r["name"] for r in conn.execute("PRAGMA table_info(otp_codes)").fetchall()]
        if "last_sent_at" not in otp_cols:
            conn.execute("ALTER TABLE otp_codes ADD COLUMN last_sent_at TEXT;")
        if "send_count" not in otp_cols:
            conn.execute("ALTER TABLE otp_codes ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;")

        # Names are matched case-insensitively at login, so enforce that uniqueness too.
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_full_name_nocase "
                "ON users(lower(full_name));"
            )
        except sqlite3.IntegrityError:
            # An older database already contains case-variant duplicates; keep serving
            # and let operators de-duplicate before the index can be created.
            pass

        count = conn.execute("SELECT COUNT(*) AS c FROM career_jobs").fetchone()["c"]
        if count == 0:
            now = datetime.now(timezone.utc).isoformat()
            seed_jobs = [
                (
                    "job-sd-01",
                    "Junior Accessible Web Developer",
                    "SelamPath Employer Network",
                    "Addis Ababa / Remote",
                    "Build semantic HTML, CSS, and accessible web components. Full NVDA & JAWS support.",
                    json.dumps(["screen_reader_compatible", "flexible_hours", "jaws_nvda_provided"]),
                    now,
                ),
                (
                    "job-cs-02",
                    "Amharic & English Customer Support Specialist",
                    "EthioConnect Hub",
                    "Addis Ababa / Hybrid",
                    "Voice-first customer care with screen-reader compatible CRM and audio onboarding.",
                    json.dumps(["screen_reader_compatible", "voice_first_tools", "audio_training"]),
                    now,
                ),
                (
                    "job-da-03",
                    "Junior Data & Research Analyst",
                    "Horn Analytics Group",
                    "Remote (Ethiopia)",
                    "Clean datasets, verify reports, and prepare structured accessibility-friendly summaries.",
                    json.dumps(["flexible_hours", "screen_reader_compatible", "remote_friendly"]),
                    now,
                ),
            ]
            conn.executemany(
                """
                INSERT INTO career_jobs (
                    id, title, employer_name, location, description, accommodations_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                seed_jobs,
            )


def _hash_password(plain_password: str, salt_hex: Optional[str] = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
    digest = hashlib.scrypt(plain_password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return salt.hex(), digest.hex()


def _hash_otp(code: str, salt_hex: Optional[str] = None) -> tuple[str, str]:
    salt = salt_hex or secrets.token_hex(16)
    digest = hashlib.sha256((salt + ":" + code.strip()).encode("utf-8")).hexdigest()
    return salt, digest


class PersistentStorage:
    @staticmethod
    def save_user(user_dict: dict) -> int:
        init_db()
        salt, pw_hash = _hash_password(user_dict["password"])
        now = datetime.now(timezone.utc).isoformat()
        with _get_conn() as conn:
            existing = conn.execute(
                "SELECT 1 FROM users WHERE lower(full_name) = lower(?)",
                (user_dict["full_name"].strip(),),
            ).fetchone()
            if existing:
                raise UserAlreadyExists("An account with this name already exists.")
            try:
                cur = conn.execute(
                    """
                    INSERT INTO users (
                        full_name, password_salt, password_hash,
                        preferred_language, preferences_json, identity_json, support_needs_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_dict["full_name"].strip(),
                        salt,
                        pw_hash,
                        user_dict["preferred_language"],
                        json.dumps(user_dict["preferences"]),
                        json.dumps(user_dict["identity"]),
                        json.dumps(user_dict.get("support_needs", [])),
                        now,
                    ),
                )
            except sqlite3.IntegrityError as err:
                # Never overwrite an existing account from public onboarding input.
                raise UserAlreadyExists("An account with this name already exists.") from err
            return int(cur.lastrowid)

    @staticmethod
    def authenticate_user(full_name: str, plain_password: str) -> Optional[dict]:
        init_db()
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE lower(full_name) = lower(?)",
                (full_name.strip(),),
            ).fetchone()
            # Always run one scrypt derivation so a missing account cannot be detected by timing.
            salt = row["password_salt"] if row else "00" * 16
            _, computed = _hash_password(plain_password, salt)
            if not row:
                return None
            if not hmac.compare_digest(computed, row["password_hash"]):
                return None
            return PersistentStorage._row_to_user(row)

    @staticmethod
    def update_preferences(user_id: int, preferences: dict) -> Optional[dict]:
        init_db()
        with _get_conn() as conn:
            conn.execute(
                "UPDATE users SET preferences_json = ?, preferred_language = ? WHERE id = ?",
                (json.dumps(preferences), preferences.get("language", "en"), user_id),
            )
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return PersistentStorage._row_to_user(row) if row else None

    @staticmethod
    def set_selected_career(user_id: int, career_id: str) -> Optional[dict]:
        init_db()
        with _get_conn() as conn:
            conn.execute(
                "UPDATE users SET selected_career_id = ? WHERE id = ?",
                (career_id, user_id),
            )
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return PersistentStorage._row_to_user(row) if row else None

    @staticmethod
    def set_stage_progress(user_id: int, career_id: str, stage_id: str, completed: bool) -> list[str]:
        init_db()
        now = datetime.now(timezone.utc).isoformat()
        with _get_conn() as conn:
            if completed:
                conn.execute(
                    """
                    INSERT INTO user_stage_progress (user_id, career_id, stage_id, completed, updated_at)
                    VALUES (?, ?, ?, 1, ?)
                    ON CONFLICT(user_id, career_id, stage_id) DO UPDATE SET
                        completed = 1,
                        updated_at = excluded.updated_at
                    """,
                    (user_id, career_id, stage_id, now),
                )
            else:
                conn.execute(
                    "DELETE FROM user_stage_progress WHERE user_id = ? AND career_id = ? AND stage_id = ?",
                    (user_id, career_id, stage_id),
                )
            rows = conn.execute(
                "SELECT stage_id FROM user_stage_progress WHERE user_id = ? AND career_id = ? AND completed = 1",
                (user_id, career_id),
            ).fetchall()
            return [r["stage_id"] for r in rows]

    @staticmethod
    def get_career_progress(user_id: int, career_id: str) -> list[str]:
        init_db()
        with _get_conn() as conn:
            rows = conn.execute(
                "SELECT stage_id FROM user_stage_progress WHERE user_id = ? AND career_id = ? AND completed = 1",
                (user_id, career_id),
            ).fetchall()
            return [r["stage_id"] for r in rows]

    @staticmethod
    def create_session(user_id: int) -> str:
        init_db()
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        expires = (now + timedelta(days=SESSION_TTL_DAYS)).isoformat()
        with _get_conn() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(),))
            conn.execute(
                "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
                (token, user_id, expires),
            )
            # Keep only the 10 newest sessions per account so tokens do not pile up forever.
            conn.execute(
                """
                DELETE FROM sessions
                WHERE user_id = ? AND token NOT IN (
                    SELECT token FROM sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 10
                )
                """,
                (user_id, user_id),
            )
        return token

    @staticmethod
    def delete_session(token: str) -> bool:
        init_db()
        with _get_conn() as conn:
            cur = conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return cur.rowcount > 0

    @staticmethod
    def get_user_by_session(token: str) -> Optional[dict]:
        init_db()
        with _get_conn() as conn:
            row = conn.execute(
                """
                SELECT u.*, s.expires_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = ?
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                return None
            return PersistentStorage._row_to_user(row)

    @staticmethod
    def create_otp(contact_value: str) -> str:
        init_db()
        key = contact_value.strip()
        code = f"{secrets.randbelow(900000) + 100000}"
        salt, code_hash = _hash_otp(code)
        now = datetime.now(timezone.utc)
        expires = (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT last_sent_at, send_count FROM otp_codes WHERE contact_value = ?",
                (key,),
            ).fetchone()
            send_count = 0
            if row and row["last_sent_at"]:
                last_sent = datetime.fromisoformat(row["last_sent_at"])
                elapsed = (now - last_sent).total_seconds()
                if elapsed < OTP_COOLDOWN_SECONDS:
                    raise OtpRateLimited(OTP_COOLDOWN_SECONDS - int(elapsed))
                if elapsed < 3600:
                    send_count = int(row["send_count"] or 0)
                if send_count >= OTP_MAX_PER_HOUR:
                    raise OtpRateLimited(3600 - int(elapsed))
            conn.execute(
                """
                INSERT INTO otp_codes (
                    contact_value, code_salt, code_hash, attempts, expires_at, last_sent_at, send_count
                )
                VALUES (?, ?, ?, 0, ?, ?, ?)
                ON CONFLICT(contact_value) DO UPDATE SET
                    code_salt = excluded.code_salt,
                    code_hash = excluded.code_hash,
                    attempts = 0,
                    expires_at = excluded.expires_at,
                    last_sent_at = excluded.last_sent_at,
                    send_count = excluded.send_count
                """,
                (key, salt, code_hash, expires, now.isoformat(), send_count + 1),
            )
        return code

    @staticmethod
    def verify_otp(contact_value: str, code: str) -> bool:
        init_db()
        key = contact_value.strip()
        now = datetime.now(timezone.utc)
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT code_salt, code_hash, attempts, expires_at FROM otp_codes WHERE contact_value = ?",
                (key,),
            ).fetchone()
            if not row:
                return False
            if datetime.fromisoformat(row["expires_at"]) < now or row["attempts"] >= 5:
                conn.execute("DELETE FROM otp_codes WHERE contact_value = ?", (key,))
                return False
            _, computed = _hash_otp(code.strip(), row["code_salt"])
            if hmac.compare_digest(computed, row["code_hash"]):
                conn.execute("DELETE FROM otp_codes WHERE contact_value = ?", (key,))
                conn.execute(
                    """
                    INSERT INTO contact_verifications (contact_value, verified_at, used_at)
                    VALUES (?, ?, NULL)
                    ON CONFLICT(contact_value) DO UPDATE SET
                        verified_at = excluded.verified_at,
                        used_at = NULL
                    """,
                    (key, now.isoformat()),
                )
                return True
            conn.execute("UPDATE otp_codes SET attempts = attempts + 1 WHERE contact_value = ?", (key,))
            return False

    @staticmethod
    def consume_contact_verification(contact_value: str) -> bool:
        """Single-use gate so registration cannot skip the OTP step."""
        init_db()
        key = contact_value.strip()
        now = datetime.now(timezone.utc)
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT verified_at, used_at FROM contact_verifications WHERE contact_value = ?",
                (key,),
            ).fetchone()
            if not row or row["used_at"]:
                return False
            verified_at = datetime.fromisoformat(row["verified_at"])
            if verified_at < now - timedelta(minutes=VERIFICATION_TTL_MINUTES):
                conn.execute("DELETE FROM contact_verifications WHERE contact_value = ?", (key,))
                return False
            conn.execute(
                "UPDATE contact_verifications SET used_at = ? WHERE contact_value = ?",
                (now.isoformat(), key),
            )
            return True

    @staticmethod
    def save_draft(token: Optional[str], step: int, data: dict) -> str:
        init_db()
        draft_token = token or secrets.token_urlsafe(8)
        now = datetime.now(timezone.utc).isoformat()
        with _get_conn() as conn:
            conn.execute(
                """
                INSERT INTO onboarding_drafts (token, step, data_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(token) DO UPDATE SET
                    step = excluded.step,
                    data_json = excluded.data_json,
                    updated_at = excluded.updated_at
                """,
                (draft_token, step, json.dumps(data), now),
            )
        return draft_token

    @staticmethod
    def get_draft(token: str) -> Optional[dict]:
        init_db()
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM onboarding_drafts WHERE token = ?",
                (token.strip(),),
            ).fetchone()
            if not row:
                return None
            return {
                "token": row["token"],
                "step": row["step"],
                "data": json.loads(row["data_json"]),
                "updated_at": row["updated_at"],
            }

    @staticmethod
    def save_partner_referral(
        partner_name: str,
        learner_name: str,
        learner_contact: str,
        consent: bool,
    ) -> int:
        init_db()
        now = datetime.now(timezone.utc).isoformat()
        with _get_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO partner_referrals (
                    partner_name, learner_name, learner_contact, consent_confirmed, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (partner_name.strip(), learner_name.strip(), learner_contact.strip(), int(consent), now),
            )
            return int(cur.lastrowid)

    @staticmethod
    def _like_pattern(value: str) -> str:
        escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return f"%{escaped.lower()}%"

    @staticmethod
    def list_jobs(
        support_filter: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        init_db()
        limit = max(1, min(int(limit or 50), 100))
        offset = max(0, int(offset or 0))
        clauses = []
        params: list = []
        q_low = (q or "").strip()
        if q_low:
            clauses.append(
                "(lower(title) LIKE ? ESCAPE '\\' OR lower(description) LIKE ? ESCAPE '\\' "
                "OR lower(employer_name) LIKE ? ESCAPE '\\')"
            )
            pattern = PersistentStorage._like_pattern(q_low)
            params.extend([pattern, pattern, pattern])
        support = (support_filter or "").strip()
        if support:
            clauses.append("accommodations_json LIKE ? ESCAPE '\\'")
            params.append(f'%"{support.replace(chr(34), "")}"%')
        sql = "SELECT * FROM career_jobs"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with _get_conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        jobs = []
        for r in rows:
            accoms = json.loads(r["accommodations_json"])
            jobs.append(
                {
                    "@context": "https://schema.org",
                    "@type": "JobPosting",
                    "id": r["id"],
                    "title": r["title"],
                    "hiringOrganization": {
                        "@type": "Organization",
                        "name": r["employer_name"],
                    },
                    "jobLocationType": r["location"],
                    "description": r["description"],
                    "accommodations_offered": accoms,
                    "datePosted": r["created_at"],
                }
            )
        return jobs

    @staticmethod
    def list_jobs_for_needs(support_needs: list[str], limit: int = 10) -> list[dict]:
        """Jobs matching any of the learner's private support needs, newest first."""
        needs = [str(n).strip() for n in (support_needs or []) if str(n).strip()]
        if not needs:
            return PersistentStorage.list_jobs(limit=limit)
        matches: list[dict] = []
        seen: set[str] = set()
        for need in needs[:5]:
            for job in PersistentStorage.list_jobs(support_filter=need, limit=50):
                if job["id"] not in seen:
                    seen.add(job["id"])
                    matches.append(job)
                if len(matches) >= limit:
                    return matches
        return matches or PersistentStorage.list_jobs(limit=limit)

    @staticmethod
    def job_exists(job_id: str) -> bool:
        init_db()
        with _get_conn() as conn:
            row = conn.execute("SELECT 1 FROM career_jobs WHERE id = ?", (job_id,)).fetchone()
            return row is not None

    @staticmethod
    def create_job(
        title: str,
        employer_name: str,
        location: str,
        description: str,
        accommodations: list[str],
    ) -> dict:
        init_db()
        job_id = f"job-{secrets.token_hex(4)}"
        now = datetime.now(timezone.utc).isoformat()
        with _get_conn() as conn:
            conn.execute(
                """
                INSERT INTO career_jobs (
                    id, title, employer_name, location, description, accommodations_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    title.strip(),
                    employer_name.strip(),
                    location.strip(),
                    description.strip(),
                    json.dumps(accommodations),
                    now,
                ),
            )
        return {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "id": job_id,
            "title": title.strip(),
            "hiringOrganization": {
                "@type": "Organization",
                "name": employer_name.strip(),
            },
            "jobLocationType": location.strip(),
            "description": description.strip(),
            "accommodations_offered": accommodations,
            "datePosted": now,
        }

    @staticmethod
    def save_job_application(
        user_id: Optional[int],
        job_id: str,
        applicant_name: str,
        applicant_contact: str,
        voice_pitch_transcript: str,
        interview_accommodations: str,
        support_needs: list[str],
    ) -> int:
        init_db()
        now = datetime.now(timezone.utc).isoformat()
        with _get_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO career_applications (
                    user_id, job_id, applicant_name, applicant_contact,
                    voice_pitch_transcript, interview_accommodations, support_needs_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    job_id,
                    applicant_name.strip(),
                    applicant_contact.strip(),
                    voice_pitch_transcript.strip(),
                    (interview_accommodations or "").strip(),
                    json.dumps(support_needs),
                    now,
                ),
            )
            return int(cur.lastrowid)

    @staticmethod
    def _row_to_user(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "full_name": row["full_name"],
            "preferred_language": row["preferred_language"],
            "preferences": json.loads(row["preferences_json"]),
            "identity": json.loads(row["identity_json"]),
            "support_needs": json.loads(row["support_needs_json"]),
            "selected_career_id": row["selected_career_id"],
        }