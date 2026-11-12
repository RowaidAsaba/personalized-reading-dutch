"""Onboarding word check: estimates the CEFR level and seeds known words."""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app import gemini
from app.database import SessionLocal, get_db
from app.models import CEFR_LEVELS, Lexicon, User, UserVocabularyVector, VocabStatus, utcnow
from app.schemas import AssessmentBatchRequest, AssessmentSubmitRequest
from app.security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assessment", tags=["Assessment"])

PSEUDO_WORDS = [
    "mivelen", "drokkel", "plinterig", "zomberen", "kluftig",
    "trieven", "bleksel", "vorfelen", "snuiselen", "galperen",
]
FIRST_BATCH_SIZE = 100
SECOND_BATCH_SIZE = 50


def _levels_from(level: str) -> list[str]:
    idx = CEFR_LEVELS.index(level) if level in CEFR_LEVELS else 2
    ordered = [CEFR_LEVELS[idx]]
    for step in range(1, len(CEFR_LEVELS)):
        if idx - step >= 0:
            ordered.append(CEFR_LEVELS[idx - step])
        if idx + step < len(CEFR_LEVELS):
            ordered.append(CEFR_LEVELS[idx + step])
    return ordered


def _gemini_second_batch(user: User, known: list[str], all_words: list[str], level: str) -> list[dict]:
    if not gemini.is_configured():
        return []
    success_rate = (len(known) / len(all_words)) * 100 if all_words else 0
    prompt = f"""\
You are a Dutch vocabulary specialist for second-language learners.
Age: {user.age or 'Unknown'}
Job: {user.job or 'Unknown'}
Academic Background: {user.academic_background or 'Unknown'}
Purpose of Learning: {user.purpose or 'Unknown'}
Initial CEFR Level: {level}
Success Rate on first batch: {success_rate:.1f}%

Task: generate exactly {SECOND_BATCH_SIZE} adaptive Dutch words for the second assessment batch.
If the learner is a student, prioritize academic and campus vocabulary.
If the learner is a professional, prioritize business/industry-specific terms.
Success > 80%: move up one CEFR level to find their ceiling.
Success 50-80%: stay in the current level but use specific 'frontier' words.
Success < 50%: drop down one level to find their stable floor.
Do not reuse any of these words: {", ".join(all_words[:150])}

Return ONLY a JSON array: [{{"word": "Dutch", "translation": "English", "cefr": "Level"}}]
"""
    try:
        words = gemini.generate_json(prompt, attempts=1, label="Assessment", max_output_tokens=4000)
        return words if isinstance(words, list) else []
    except Exception as exc:
        logger.warning("[Assessment] Gemini second batch failed: %s", exc)
        return []


def _lexicon_second_batch(db: Session, level: str, all_words: list[str]) -> list[dict]:
    seen = {w.strip().lower() for w in all_words if w.strip()}
    out: list[dict] = []
    for lvl in _levels_from(level):
        rows = db.query(Lexicon).filter(Lexicon.cefr_level == lvl).order_by(Lexicon.word_id).all()
        for row in rows:
            if row.word in seen:
                continue
            out.append({"word": row.word, "translation": row.translation, "cefr": row.cefr_level})
            if len(out) >= SECOND_BATCH_SIZE:
                return out
    return out


@router.post("/batch/generate")
def generate_batch(
    payload: AssessmentBatchRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    level = payload.self_reported_cefr.upper() if payload.self_reported_cefr else "B1"
    words: list[dict] = []

    if payload.batch_number == 1:
        rows: list[Lexicon] = []
        for lvl in _levels_from(level):
            rows = db.query(Lexicon).filter(Lexicon.cefr_level == lvl).order_by(Lexicon.word_id).all()
            if rows:
                break
        for lex in rows[:FIRST_BATCH_SIZE]:
            words.append({"word_id": str(lex.word_id), "dutch": lex.word, "english": lex.translation, "is_pseudo": False})
        pseudo = PSEUDO_WORDS[:5]
    else:
        data = _gemini_second_batch(user, payload.known_words, payload.all_words, level)
        if not data:
            data = _lexicon_second_batch(db, level, payload.all_words)
        for item in data[:SECOND_BATCH_SIZE]:
            word = str(item.get("word", "")).strip().lower()
            if not word:
                continue
            lex = db.query(Lexicon).filter(Lexicon.word == word).first()
            words.append({
                "word_id": str(lex.word_id) if lex else f"gen-{word}",
                "dutch": word,
                "english": item.get("translation") or (lex.translation if lex else None),
                "is_pseudo": False,
            })
        pseudo = PSEUDO_WORDS[5:10]

    for pw in pseudo:
        words.append({"word_id": f"pseudo-{pw}", "dutch": pw, "english": None, "is_pseudo": True})

    return {"batch_number": payload.batch_number, "total_batches": 2, "words": words}


def _refill_recommendations(user_id: str) -> None:
    from app.krs_service import ensure_reservoir

    db = SessionLocal()
    try:
        ensure_reservoir(user_id, db)   # fills only while below the floor (generation may already have done it)
    except Exception as exc:  # pragma: no cover
        logger.warning("[Assessment] reservoir refill failed for %s: %s", user_id, exc)
    finally:
        db.close()


@router.post("/submit")
def submit_assessment(
    payload: AssessmentSubmitRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.is_final:
        return {"success": True, "is_final": False}

    level = payload.estimated_level.upper()
    if level in CEFR_LEVELS:
        user.estimated_cefr = level
        user.difficulty_offset = 0
        user.difficulty_offset_updated_at = utcnow()

    known_ids = {int(raw) for raw in payload.known_word_ids if str(raw).isdigit()}
    if known_ids:
        valid_ids = {wid for (wid,) in db.query(Lexicon.word_id).filter(Lexicon.word_id.in_(known_ids)).all()}
        existing = {
            row.word_id: row for row in db.query(UserVocabularyVector)
            .filter(UserVocabularyVector.user_id == user.user_id, UserVocabularyVector.word_id.in_(valid_ids))
            .all()
        }
        for word_id in valid_ids:
            row = existing.get(word_id)
            if row:
                row.status = VocabStatus.MASTERED
                row.mastery_score = 1.0
            else:
                db.add(UserVocabularyVector(
                    user_id=user.user_id, word_id=word_id, status=VocabStatus.MASTERED,
                    mastery_score=1.0, source="onboarding_check",
                ))

    first_time = not user.onboarding_completed
    user.onboarding_completed = True
    db.commit()

    background_tasks.add_task(_refill_recommendations, user.user_id)
    return {"success": True, "is_final": True, "estimated_cefr": user.estimated_cefr, "first_time": first_time}
