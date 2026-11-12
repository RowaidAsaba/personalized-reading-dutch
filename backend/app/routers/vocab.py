"""The user's vocabulary vector: review queue, discover, and the events that change words."""
import datetime
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.krs_service import RESERVOIR_FLOOR, SOURCE_GEMINI, ensure_reservoir, reservoir_rows
from app.models import Lexicon, ReadingSession, RecommendedVocabulary, User, UserVocabularyVector, VocabStatus, utcnow
from app.schemas import AddToLearnRequest, LookupRequest, ReviewRequest, WordIdRequest
from app.security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/vocab", tags=["Vocabulary"])

DISCOVER_MIN_READY = 10        # refill synchronously below this many unseen words
REVIEW_INTERVALS = [1, 2, 4, 8, 16, 30]
MASTERED_REVIEW_DAYS = 30
LOOKUP_MASTERY_PENALTY = 0.05
DEMOTE_LOOKUPS = 2             # lookups of a MASTERED word within DEMOTE_WINDOW_DAYS move it back
DEMOTE_WINDOW_DAYS = 30


# ---------------------------------------------------------------- helpers

def _examples(entry: Lexicon) -> list[dict]:
    examples = entry.examples or []
    if isinstance(examples, list):
        cleaned = [ex for ex in examples if isinstance(ex, dict) and ex.get("nl") and "en" in ex]
        if cleaned:
            return cleaned
    return [{"nl": entry.word, "en": entry.translation}]


def _card(entry: Lexicon, row: UserVocabularyVector | None = None) -> dict:
    return {
        "wordId": str(entry.word_id),
        "dutch": entry.word,
        "english": entry.translation,
        "cefrLevel": entry.cefr_level,
        "examples": _examples(entry),
        "status": row.status.value.lower() if row else "new",
        "masteryScore": row.mastery_score if row else 0.0,
        "nextReviewDate": row.next_review_at.isoformat() if row and row.next_review_at else None,
        "reviewInterval": row.review_interval_days if row else None,
        "lookupCount": row.lookup_count if row else 0,
    }


def _vector_row(user_id: str, word_id: int, db: Session) -> UserVocabularyVector | None:
    return (
        db.query(UserVocabularyVector)
        .filter(UserVocabularyVector.user_id == user_id, UserVocabularyVector.word_id == word_id)
        .first()
    )


def _require_word(word_id: int, db: Session) -> Lexicon:
    lex = db.query(Lexicon).filter(Lexicon.word_id == word_id).first()
    if not lex:
        raise HTTPException(status_code=404, detail="Word not found")
    return lex


def _drop_recommendation(user_id: str, word_id: int, db: Session) -> None:
    db.query(RecommendedVocabulary).filter(
        RecommendedVocabulary.user_id == user_id, RecommendedVocabulary.word_id == word_id,
    ).delete(synchronize_session=False)


def _background_refill(user_id: str) -> None:
    db = SessionLocal()
    try:
        ensure_reservoir(user_id, db)
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning("[Vocab] background refill failed for %s: %s", user_id, exc)
    finally:
        db.close()


# ---------------------------------------------------------------- queues

@router.get("/review")
def review_queue(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = utcnow()
    rows = (
        db.query(UserVocabularyVector)
        .join(UserVocabularyVector.lexicon_entry)
        .filter(
            UserVocabularyVector.user_id == user.user_id,
            UserVocabularyVector.status == VocabStatus.LEARNING,
            or_(UserVocabularyVector.next_review_at <= now, UserVocabularyVector.next_review_at.is_(None)),
        )
        .order_by(UserVocabularyVector.mastery_score.asc(), UserVocabularyVector.next_review_at.asc())
        .all()
    )
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    reviewed_today = (
        db.query(UserVocabularyVector)
        .filter(UserVocabularyVector.user_id == user.user_id, UserVocabularyVector.last_reviewed_at >= today_start)
        .count()
    )
    learning_total = (
        db.query(UserVocabularyVector)
        .filter(UserVocabularyVector.user_id == user.user_id, UserVocabularyVector.status == VocabStatus.LEARNING)
        .count()
    )
    return {
        "cards": [_card(r.lexicon_entry, r) for r in rows],
        "due_count": len(rows),
        "reviewed_today": reviewed_today,
        "learning_total": learning_total,
    }


@router.get("/discover")
def discover(
    background_tasks: BackgroundTasks,
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = reservoir_rows(user.user_id, db)
    if len(rows) < DISCOVER_MIN_READY:
        try:
            ensure_reservoir(user.user_id, db, minimum=DISCOVER_MIN_READY)
        except Exception as exc:
            logger.warning("[Vocab] discover refill failed for %s: %s", user.user_id, exc)
        rows = reservoir_rows(user.user_id, db)

    vectors = {
        v.word_id: v for v in db.query(UserVocabularyVector)
        .filter(UserVocabularyVector.user_id == user.user_id, UserVocabularyVector.status == VocabStatus.ENCOUNTERED)
        .all()
    }
    epoch = datetime.datetime(1970, 1, 1)

    def sort_key(row: RecommendedVocabulary):
        vec = vectors.get(row.word_id)
        looked_up = vec.last_looked_up_at if vec and vec.last_looked_up_at else epoch
        seen = vec.last_seen_in_text_at if vec and vec.last_seen_in_text_at else epoch
        lookups = vec.lookup_count if vec else 0
        source_rank = 0 if row.source == SOURCE_GEMINI else 1
        return (-lookups, -looked_up.timestamp(), -seen.timestamp(), source_rank, -row.recommended_at.timestamp())

    rows.sort(key=sort_key)
    if len(rows) < RESERVOIR_FLOOR:
        background_tasks.add_task(_background_refill, user.user_id)

    return {
        "words": [_card(r.lexicon_entry, vectors.get(r.word_id)) for r in rows[:limit]],
        "remaining": len(rows),
    }


# ---------------------------------------------------------------- events

@router.post("/review")
def review_word(req: ReviewRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _vector_row(user.user_id, req.word_id, db)
    if not row:
        raise HTTPException(status_code=404, detail="Word is not in your vocabulary")
    now = utcnow()
    row.last_reviewed_at = now

    if req.remembered:
        row.mastery_score = min(1.0, (row.mastery_score or 0.0) + 0.25)
        if req.interval_days is not None:
            days = req.interval_days
        else:
            previous = row.review_interval_days or 0
            days = next((d for d in REVIEW_INTERVALS if d > previous), REVIEW_INTERVALS[-1])
        row.review_interval_days = days
        row.next_review_at = now + (datetime.timedelta(hours=4) if days == 0 else datetime.timedelta(days=days))
    else:
        row.mastery_score = max(0.0, (row.mastery_score or 0.0) - 0.15)
        row.status = VocabStatus.LEARNING
        row.review_interval_days = None
        row.next_review_at = now + datetime.timedelta(minutes=10)

    db.commit()
    return {"success": True, "status": row.status.value.lower(), "mastery_score": row.mastery_score,
            "next_review_at": row.next_review_at.isoformat() if row.next_review_at else None}


@router.post("/mark-known")
def mark_known(req: WordIdRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_word(req.word_id, db)
    now = utcnow()
    row = _vector_row(user.user_id, req.word_id, db)
    if row:
        row.status = VocabStatus.MASTERED
        row.mastery_score = 1.0
        row.last_reviewed_at = now
        row.next_review_at = now + datetime.timedelta(days=MASTERED_REVIEW_DAYS)
        row.review_interval_days = MASTERED_REVIEW_DAYS
    else:
        db.add(UserVocabularyVector(
            user_id=user.user_id, word_id=req.word_id, status=VocabStatus.MASTERED,
            mastery_score=1.0, last_reviewed_at=now, source="discover",
            next_review_at=now + datetime.timedelta(days=MASTERED_REVIEW_DAYS),
            review_interval_days=MASTERED_REVIEW_DAYS,
        ))
    _drop_recommendation(user.user_id, req.word_id, db)
    db.commit()
    return {"success": True, "status": "mastered"}


@router.post("/add-to-learn")
def add_to_learn(req: AddToLearnRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_word(req.word_id, db)
    now = utcnow()
    next_review = now - datetime.timedelta(minutes=1) if req.interval_days == 0 else now + datetime.timedelta(days=req.interval_days)
    row = _vector_row(user.user_id, req.word_id, db)
    if row:
        if row.status == VocabStatus.MASTERED:
            # Explicit re-learn request: back to the queue at half mastery.
            row.mastery_score = min(row.mastery_score or 0.0, 0.5)
        row.status = VocabStatus.LEARNING
        row.review_interval_days = req.interval_days
        row.next_review_at = next_review
    else:
        db.add(UserVocabularyVector(
            user_id=user.user_id, word_id=req.word_id, status=VocabStatus.LEARNING,
            mastery_score=0.0, review_interval_days=req.interval_days, next_review_at=next_review,
            source="discover",
        ))
    _drop_recommendation(user.user_id, req.word_id, db)
    db.commit()
    return {"success": True, "status": "learning"}


@router.post("/lookup")
def lookup_word(req: LookupRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The reader asked for a translation while reading. At most one lookup per word per reading counts."""
    _require_word(req.word_id, db)
    now = utcnow()

    if req.session_id is not None:
        session = (
            db.query(ReadingSession)
            .filter(ReadingSession.session_id == req.session_id, ReadingSession.user_id == user.user_id)
            .first()
        )
        if session is not None:
            seen = list(session.looked_up_word_ids or [])
            if req.word_id in seen:
                row = _vector_row(user.user_id, req.word_id, db)
                return {"success": True, "counted": False,
                        "status": row.status.value.lower() if row else "new", "demoted": False}
            seen.append(req.word_id)
            session.looked_up_word_ids = seen

    row = _vector_row(user.user_id, req.word_id, db)
    demoted = False
    if row is None:
        row = UserVocabularyVector(
            user_id=user.user_id, word_id=req.word_id, status=VocabStatus.ENCOUNTERED,
            mastery_score=0.0, lookup_count=1, last_looked_up_at=now, source="reading",
        )
        db.add(row)
    else:
        previous_lookup = row.last_looked_up_at
        row.lookup_count = (row.lookup_count or 0) + 1
        row.last_looked_up_at = now
        if row.status == VocabStatus.LEARNING:
            row.mastery_score = max(0.0, (row.mastery_score or 0.0) - LOOKUP_MASTERY_PENALTY)
            if row.next_review_at is None or row.next_review_at > now:
                row.next_review_at = now
        elif row.status == VocabStatus.MASTERED:
            recent = previous_lookup is not None and (now - previous_lookup) <= datetime.timedelta(days=DEMOTE_WINDOW_DAYS)
            if recent and row.lookup_count >= DEMOTE_LOOKUPS:
                row.status = VocabStatus.LEARNING
                row.mastery_score = 0.5
                row.review_interval_days = 1
                row.next_review_at = now + datetime.timedelta(days=1)
                demoted = True

    db.commit()
    return {"success": True, "counted": True, "status": row.status.value.lower(),
            "lookup_count": row.lookup_count, "demoted": demoted}
