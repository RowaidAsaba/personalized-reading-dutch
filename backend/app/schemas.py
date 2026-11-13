from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.models import GENDER_VALUES

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
Rating = Literal[1, 2, 3, 4, 5]


def normalise_email(value: str) -> str:
    email = value.strip().lower()
    if not _EMAIL_RE.match(email):
        raise ValueError("Enter a valid email address.")
    return email


# ---------------------------------------------------------------- auth

class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=255)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return normalise_email(value)


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return normalise_email(value)


class GoogleAuthRequest(BaseModel):
    credential: str


class UserOut(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    interests: list[str] = []
    estimated_cefr: Optional[str] = None
    effective_cefr: Optional[str] = None
    difficulty_offset: int = 0
    onboarding_completed: bool = False
    has_password: bool = False
    has_google: bool = False
    age: Optional[int] = None
    city: Optional[str] = None
    gender: Optional[str] = None
    job: Optional[str] = None
    academic_background: Optional[str] = None
    mother_language: Optional[str] = None
    other_languages: Optional[str] = None
    purpose: Optional[str] = None
    created_at: Optional[str] = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------------------------------------------------------------- profile

class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=255)
    age: Optional[int] = Field(default=None, ge=5, le=120)
    city: Optional[str] = Field(default=None, max_length=255)
    gender: Optional[str] = None
    job: Optional[str] = Field(default=None, max_length=255)
    academic_background: Optional[str] = Field(default=None, max_length=255)
    mother_language: Optional[str] = Field(default=None, max_length=100)
    other_languages: Optional[str] = Field(default=None, max_length=255)
    purpose: Optional[str] = Field(default=None, max_length=100)
    interests: Optional[list[str]] = None
    estimated_cefr: Optional[str] = None
    difficulty_offset: Optional[int] = Field(default=None, ge=-1, le=1)

    @field_validator("gender")
    @classmethod
    def _gender(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return value
        if value not in GENDER_VALUES:
            raise ValueError("Unknown gender value.")
        return value

    @field_validator("estimated_cefr")
    @classmethod
    def _cefr(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.upper()
        if value not in {"A1", "A2", "B1", "B2", "C1", "C2"}:
            raise ValueError("Unknown CEFR level.")
        return value


# ---------------------------------------------------------------- assessment (onboarding word check)

class AssessmentBatchRequest(BaseModel):
    batch_number: int = Field(default=1, ge=1, le=2)
    self_reported_cefr: str = "B1"
    known_words: list[str] = []
    all_words: list[str] = []


class AssessmentSubmitRequest(BaseModel):
    batch_number: int
    known_word_ids: list[str]
    all_word_ids: list[str]
    estimated_level: str
    confidence_score: float
    is_final: bool = False


# ---------------------------------------------------------------- lexicon / words

class LexiconEntry(BaseModel):
    word_id: int
    word: str
    translation: str
    cefr_level: str
    examples: Optional[Any] = None
    use_cases: Optional[Any] = None

    model_config = {"from_attributes": True}


class WordInfo(BaseModel):
    word_id: int
    word: str
    translation: str
    cefr_level: str
    examples: Optional[Any] = None


class TextToken(BaseModel):
    text: str
    type: Literal["word", "punctuation", "space"]
    status: Optional[Literal["new", "learning", "known"]] = None
    word_id: Optional[int] = None


# ---------------------------------------------------------------- reading sessions

class GenerateSessionRequest(BaseModel):
    word_count_range: str = "150-200"


class SessionResponse(BaseModel):
    session_id: int
    title: str
    content: str
    tokens: list[TextToken] = []
    topic_used: Optional[str] = None
    reading_number: int
    cefr_level: Optional[str] = None
    narrative_style: Optional[str] = None
    ended: bool = False
    ended_at: Optional[str] = None
    continuation_count: int = 0
    blue_words: list[WordInfo] = []
    yellow_words: list[WordInfo] = []
    word_translations: dict[str, str] = {}
    metadata: dict[str, Any] = {}


class ReadingFeedbackRequest(BaseModel):
    difficulty: Rating   # 1 too easy .. 3 normal .. 5 too difficult
    interest: Rating
    relevance: Rating
    worth_time: Rating


class EndSessionRequest(BaseModel):
    duration_seconds: Optional[int] = Field(default=None, ge=0)
    feedback: Optional[ReadingFeedbackRequest] = None


# ---------------------------------------------------------------- vocabulary vector

class WordIdRequest(BaseModel):
    word_id: int


class ReviewRequest(BaseModel):
    word_id: int
    remembered: bool
    interval_days: Optional[int] = Field(default=None, ge=0, le=365)
    practice: bool = False   # practice round: "remembered" must not touch the schedule


class AddToLearnRequest(BaseModel):
    word_id: int
    interval_days: int = Field(default=1, ge=0, le=365)


class LookupRequest(BaseModel):
    word_id: int
    session_id: Optional[int] = None
