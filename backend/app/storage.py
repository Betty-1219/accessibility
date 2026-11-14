import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional

DB_PATH = os.getenv("DB_PATH", "digital_bridge.db")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
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
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS otp_codes (
                contact_value TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            """
        )


def _hash_password(plain_password: str, salt_hex: Optional[str] = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
    digest = hashlib.scrypt(plain_password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return salt.hex(), digest.hex()


class PersistentStorage:
    @staticmethod
    def save_user(user_dict: dict) -> int:
        init_db()
        salt, pw_hash = _hash_password(user_dict["password"])
        now = datetime.now(timezone.utc).isoformat()
        with _get_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO users (
                    full_name, password_salt, password_hash,
                    preferred_language, preferences_json, identity_json, support_needs_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(full_name) DO UPDATE SET
                    password_salt = excluded.password_salt,
                    password_hash = excluded.password_hash,
                    preferred_language = excluded.preferred_language,
                    preferences_json = excluded.preferences_json,
                    identity_json = excluded.identity_json,
                    support_needs_json = excluded.support_needs_json
                """,
                (
                    user_dict["full_name"].strip(),
                    salt,
                    pw_hash,
                    user_dict["preferred_language"],
                    json.dumps(user_dict["preferences"]),
                    json.dumps(user_dict["identity"]),
                    json.dumps(user_dict["support_needs"]),
                    now,
                ),
            )
            row = conn.execute(
                "SELECT id FROM users WHERE full_name = ?",
                (user_dict["full_name"].strip(),),
            ).fetchone()
            return int(row["id"]) if row else cur.lastrowid

    @staticmethod
    def authenticate_user(full_name: str, plain_password: str) -> Optional[dict]:
        init_db()
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE full_name = ?",
                (full_name.strip(),),
            ).fetchone()
            if not row:
                return None
            _, computed = _hash_password(plain_password, row["password_salt"])
            if not hmac.compare_digest(computed, row["password_hash"]):
                return None
            return PersistentStorage._row_to_user(row)

    @staticmethod
    def create_session(user_id: int) -> str:
        init_db()
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        with _get_conn() as conn:
            conn.execute(
                "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
                (token, user_id, expires),
            )
        return token

    @staticmethod
    def get_user_by_session(token: str) -> Optional[dict]:
        init_db()
        with _get_conn() as conn:
            row = conn.execute(
                """
                SELECT u.*, s.expires_at FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = ?
                """,
                (token,),
            ).fetchone()
            if not row:
                return None
            if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
                return None
            return PersistentStorage._row_to_user(row)

    @staticmethod
    def create_otp(contact_value: str) -> str:
        init_db()
        code = f"{secrets.randbelow(900000) + 100000}"
        expires = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        with _get_conn() as conn:
            conn.execute(
                """
                INSERT INTO otp_codes (contact_value, code, expires_at)
                VALUES (?, ?, ?)
                ON CONFLICT(contact_value) DO UPDATE SET
                    code = excluded.code,
                    expires_at = excluded.expires_at
                """,
                (contact_value.strip(), code, expires),
            )
        return code

    @staticmethod
    def verify_otp(contact_value: str, code: str) -> bool:
        init_db()
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT code, expires_at FROM otp_codes WHERE contact_value = ?",
                (contact_value.strip(),),
            ).fetchone()
            if not row:
                return False
            if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
                return False
            if hmac.compare_digest(row["code"], code.strip()):
                conn.execute("DELETE FROM otp_codes WHERE contact_value = ?", (contact_value.strip(),))
                return True
            return False

    @staticmethod
    def _row_to_user(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "full_name": row["full_name"],
            "preferred_language": row["preferred_language"],
            "preferences": json.loads(row["preferences_json"]),
            "identity": json.loads(row["identity_json"]),
            "support_needs": json.loads(row["support_needs_json"]),
        }