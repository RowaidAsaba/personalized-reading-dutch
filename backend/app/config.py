import os
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# Database: sqlite:///./dev.db locally, postgresql+psycopg://... on Neon.
DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./dev.db")

FRONTEND_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

# Gemini (text generation, word recommendations, dictionary fallback).
GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")

# Authentication.
AUTH_SECRET_KEY: str = os.getenv("AUTH_SECRET_KEY", "")
try:
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 14)))
except ValueError:
    ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 14

# Google Sign-In (OAuth web client id). Empty disables "Continue with Google".
GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
