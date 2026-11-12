import datetime
import enum
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime.datetime:
    """Naive UTC timestamp, used for every DATETIME column so SQLite and Postgres agree."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
GENDER_VALUES = ("female", "male", "non_binary", "prefer_not_to_say")


class VocabStatus(str, enum.Enum):
    ENCOUNTERED = "ENCOUNTERED"   # met in a text or looked up, no decision yet
    LEARNING = "LEARNING"         # in the review queue
    MASTERED = "MASTERED"         # known


class TopicStatus(str, enum.Enum):
    INTERESTED = "INTERESTED"
    NEUTRAL = "NEUTRAL"
    HATED = "HATED"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "gender IS NULL OR gender IN ('female','male','non_binary','prefer_not_to_say')",
            name="ck_users_gender",
        ),
        CheckConstraint("difficulty_offset BETWEEN -1 AND 1", name="ck_users_difficulty_offset"),
    )

    user_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    google_sub: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    job: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    academic_background: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    mother_language: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    other_languages: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    purpose: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    estimated_cefr: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    # Moves one step after three consistent difficulty ratings; applied on top of estimated_cefr.
    difficulty_offset: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    difficulty_offset_updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)

    topics: Mapped[list["UserTopic"]] = relationship(
        "UserTopic", back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    vocab_vectors: Mapped[list["UserVocabularyVector"]] = relationship(
        "UserVocabularyVector", back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    recommendations: Mapped[list["RecommendedVocabulary"]] = relationship(
        "RecommendedVocabulary", back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    sessions: Mapped[list["ReadingSession"]] = relationship(
        "ReadingSession", back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def effective_cefr(self) -> str:
        base = self.estimated_cefr if self.estimated_cefr in CEFR_LEVELS else "B1"
        idx = CEFR_LEVELS.index(base) + (self.difficulty_offset or 0)
        return CEFR_LEVELS[max(0, min(len(CEFR_LEVELS) - 1, idx))]


class UserTopic(Base):
    __tablename__ = "user_topics"
    __table_args__ = (
        UniqueConstraint("user_id", "topic_name", name="uq_user_topic"),
        Index("ix_user_topics_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(50), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    topic_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[TopicStatus] = mapped_column(SAEnum(TopicStatus), nullable=False)
    # Feedback-adjusted weight used by the topic roll (0.2 .. 2.0).
    score: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    user: Mapped["User"] = relationship("User", back_populates="topics")


class Lexicon(Base):
    __tablename__ = "lexicon"

    word_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    word: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    translation: Mapped[str] = mapped_column(String(255), nullable=False)
    cefr_level: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    examples: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    use_cases: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    vocab_vectors: Mapped[list["UserVocabularyVector"]] = relationship("UserVocabularyVector", back_populates="lexicon_entry")
    recommendations: Mapped[list["RecommendedVocabulary"]] = relationship("RecommendedVocabulary", back_populates="lexicon_entry")


class UserVocabularyVector(Base):
    __tablename__ = "user_vocabulary_vector"
    __table_args__ = (
        UniqueConstraint("user_id", "word_id", name="uq_user_word"),
        Index("ix_uvv_user_status", "user_id", "status"),
        Index("ix_uvv_user_next_review", "user_id", "next_review_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(50), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    word_id: Mapped[int] = mapped_column(Integer, ForeignKey("lexicon.word_id"), nullable=False)
    status: Mapped[VocabStatus] = mapped_column(SAEnum(VocabStatus), nullable=False, default=VocabStatus.LEARNING)
    mastery_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Number of generated texts that contained this word.
    exposure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_seen_in_text_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    # Translation look-ups while reading.
    lookup_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_looked_up_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    next_review_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    last_reviewed_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    review_interval_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # onboarding_check | reading | discover | flashcard
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="reading")
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    user: Mapped["User"] = relationship("User", back_populates="vocab_vectors")
    lexicon_entry: Mapped["Lexicon"] = relationship("Lexicon", back_populates="vocab_vectors")


class RecommendedVocabulary(Base):
    __tablename__ = "recommended_vocabulary"
    __table_args__ = (
        UniqueConstraint("user_id", "word_id", name="uq_user_rec_word"),
        Index("ix_recommended_vocabulary_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(50), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    word_id: Mapped[int] = mapped_column(Integer, ForeignKey("lexicon.word_id"), nullable=False)
    recommended_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    # gemini | lexicon_fallback
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="gemini")

    user: Mapped["User"] = relationship("User", back_populates="recommendations")
    lexicon_entry: Mapped["Lexicon"] = relationship("Lexicon", back_populates="recommendations")


class ReadingSession(Base):
    __tablename__ = "reading_sessions"
    __table_args__ = (
        Index("ix_reading_sessions_user_created", "user_id", "created_at"),
    )

    session_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(50), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    topic_used: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    reading_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    cefr_level_used: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    blue_word_ids: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    yellow_word_ids: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    looked_up_word_ids: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    word_translations: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    narrative_memory: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    continuation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_continued_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    ended_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    feedback_signal: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="sessions")
    feedback: Mapped[Optional["ReadingFeedback"]] = relationship(
        "ReadingFeedback", back_populates="session", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def ended(self) -> bool:
        return self.ended_at is not None


class ReadingFeedback(Base):
    __tablename__ = "reading_feedback"
    __table_args__ = (
        CheckConstraint("difficulty BETWEEN 1 AND 5", name="ck_feedback_difficulty"),
        CheckConstraint("interest BETWEEN 1 AND 5", name="ck_feedback_interest"),
        CheckConstraint("relevance BETWEEN 1 AND 5", name="ck_feedback_relevance"),
        CheckConstraint("worth_time BETWEEN 1 AND 5", name="ck_feedback_worth_time"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reading_sessions.session_id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # 1 = too easy, 2 = easy, 3 = normal, 4 = difficult, 5 = too difficult
    difficulty: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    interest: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    relevance: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    worth_time: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    session: Mapped["ReadingSession"] = relationship("ReadingSession", back_populates="feedback")
