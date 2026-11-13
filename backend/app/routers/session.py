import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.adaptation import apply_feedback
from app.database import get_db
from app.models import Lexicon, ReadingFeedback, ReadingSession, User, utcnow
from app.schemas import EndSessionRequest, GenerateSessionRequest, SessionResponse, WordInfo
from app.security import get_current_user
from app.session_generator import (
    GenerationFailedError,
    GenerationRateLimitError,
    clean_title,
    generate_continuation,
    generate_session,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/session", tags=["Session"])


# ---------------------------------------------------------------- helpers

def _word_info(entry: Lexicon) -> WordInfo:
    return WordInfo(
        word_id=entry.word_id, word=entry.word, translation=entry.translation,
        cefr_level=entry.cefr_level, examples=entry.examples or [],
    )


def _tokenize(content: str, blue: list[WordInfo], yellow: list[WordInfo]) -> list[dict]:
    word_map: dict[str, dict] = {}
    for w in blue:
        word_map[w.word.lower()] = {"word_id": w.word_id, "status": "new"}
    for w in yellow:
        word_map[w.word.lower()] = {"word_id": w.word_id, "status": "learning"}

    tokens: list[dict] = []

    def add_word(text: str) -> None:
        match = word_map.get(text.lower())
        tokens.append({
            "text": text, "type": "word",
            "status": match["status"] if match else None,
            "word_id": match["word_id"] if match else None,
        })

    for part in re.split(r"(\[\[[^\]]+\]\])", content or ""):
        if not part:
            continue
        if part.startswith("[[") and part.endswith("]]"):
            add_word(part[2:-2])
            continue
        for sub in re.split(r"([^\wÀ-ſ]+)", part):
            if not sub:
                continue
            if re.match(r"^[^\wÀ-ſ]+$", sub):
                tokens.append({"text": sub, "type": "space" if sub.isspace() else "punctuation"})
            else:
                add_word(sub)
    return tokens


def _session_words(session: ReadingSession, db: Session) -> tuple[list[WordInfo], list[WordInfo]]:
    yellow_ids = list(session.yellow_word_ids or [])
    blue_ids = [wid for wid in (session.blue_word_ids or []) if wid not in set(yellow_ids)]
    ids = set(blue_ids) | set(yellow_ids)
    entries = {row.word_id: row for row in db.query(Lexicon).filter(Lexicon.word_id.in_(ids)).all()} if ids else {}
    blue = [_word_info(entries[i]) for i in blue_ids if i in entries]
    yellow = [_word_info(entries[i]) for i in yellow_ids if i in entries]
    return blue, yellow


def _to_response(session: ReadingSession, db: Session, metadata: dict | None = None) -> SessionResponse:
    blue, yellow = _session_words(session, db)
    return SessionResponse(
        session_id=session.session_id,
        title=clean_title(session.title, f"Reading {session.reading_number}"),
        content=session.content,
        tokens=_tokenize(session.content, blue, yellow),
        topic_used=session.topic_used,
        reading_number=session.reading_number,
        cefr_level=session.cefr_level_used,
        narrative_style=session.narrative_style,
        ended=session.ended_at is not None,
        ended_at=session.ended_at.isoformat() if session.ended_at else None,
        continuation_count=session.continuation_count or 0,
        blue_words=blue,
        yellow_words=yellow,
        word_translations=session.word_translations or {},
        metadata=metadata or {},
    )


def _own_session(session_id: int, user: User, db: Session) -> ReadingSession:
    session = (
        db.query(ReadingSession)
        .filter(ReadingSession.session_id == session_id, ReadingSession.user_id == user.user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Reading not found")
    return session


def _run_generation(fn, *args):
    try:
        return fn(*args)
    except GenerationRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except GenerationFailedError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - unexpected
        logger.exception("Generation failed")
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}")


# ---------------------------------------------------------------- endpoints

@router.post("/generate", response_model=SessionResponse)
def generate(
    req: GenerateSessionRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    word_count_range = (req.word_count_range if req else None) or "150-200"
    session = _run_generation(generate_session, user, db, word_count_range)
    return _to_response(session, db, getattr(session, "generation_metadata", None))


@router.post("/{session_id}/continue", response_model=SessionResponse)
def continue_reading(session_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _own_session(session_id, user, db)
    if session.ended_at is not None:
        raise HTTPException(status_code=409, detail="This reading has been ended. Start a new reading to continue learning.")
    session = _run_generation(generate_continuation, user, session, db)
    return _to_response(session, db, getattr(session, "generation_metadata", None))


@router.post("/{session_id}/end", response_model=SessionResponse)
def end_reading(
    session_id: int,
    payload: EndSessionRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _own_session(session_id, user, db)
    payload = payload or EndSessionRequest()

    if session.ended_at is None:
        session.ended_at = utcnow()
        if payload.duration_seconds:
            session.duration_seconds = payload.duration_seconds
        elif session.created_at:
            session.duration_seconds = max(1, int((utcnow() - session.created_at).total_seconds()))

    if payload.feedback is not None and session.feedback is None:
        feedback = ReadingFeedback(
            session_id=session.session_id,
            difficulty=payload.feedback.difficulty,
            interest=payload.feedback.interest,
            relevance=payload.feedback.relevance,
            worth_time=payload.feedback.worth_time,
        )
        db.add(feedback)
        db.flush()
        signal = apply_feedback(user, session, feedback, db)
        logger.info("[Feedback] user=%s session=%d signal=%s", user.user_id, session.session_id, signal)

    db.commit()
    db.refresh(session)
    return _to_response(session, db)


@router.get("/list")
def list_sessions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions = (
        db.query(ReadingSession)
        .filter(ReadingSession.user_id == user.user_id)
        .order_by(ReadingSession.created_at.desc(), ReadingSession.session_id.desc())
        .all()
    )
    return [
        {
            "session_id": s.session_id,
            "title": clean_title(s.title, f"Reading {s.reading_number}"),
            "topic_used": s.topic_used,
            "reading_number": s.reading_number,
            "cefr_level": s.cefr_level_used,
            "ended": s.ended_at is not None,
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "continuation_count": s.continuation_count or 0,
        }
        for s in sessions
    ]


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _own_session(session_id, user, db)
    return _to_response(session, db)
