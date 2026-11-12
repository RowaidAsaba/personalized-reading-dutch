"""Knowledge Recommendation Service: keeps a reservoir of new words per user.

The reservoir (recommended_vocabulary) feeds both the Discover flashcards and the
"blue" target words in generated texts. Words are chosen by Gemini from the
user's profile and interests, matched against the lexicon, and topped up from
the lexicon at the user's level when Gemini is unavailable or returns too few
usable words.
"""
from __future__ import annotations

import logging
import random

from sqlalchemy.orm import Session

from app import gemini
from app.models import (
    CEFR_LEVELS,
    Lexicon,
    RecommendedVocabulary,
    TopicStatus,
    User,
    UserTopic,
    UserVocabularyVector,
    VocabStatus,
)

logger = logging.getLogger(__name__)

RESERVOIR_TARGET = 50   # fill up to this many unseen recommendations
RESERVOIR_FLOOR = 25    # refill when fewer than this remain
SOURCE_GEMINI = "gemini"
SOURCE_FALLBACK = "lexicon_fallback"

DECIDED_STATUSES = (VocabStatus.LEARNING, VocabStatus.MASTERED)

FUNCTION_WORDS = {
    "de", "het", "een", "en", "maar", "of", "want", "dus", "omdat",
    "ik", "jij", "je", "hij", "zij", "ze", "wij", "we", "u", "jullie",
    "mij", "me", "jou", "hem", "haar", "ons", "hun", "hen",
    "dit", "dat", "deze", "die", "wie", "wat", "waar", "wanneer",
    "in", "op", "aan", "van", "voor", "met", "naar", "uit", "bij",
    "door", "over", "onder", "boven", "tussen", "achter", "naast",
    "niet", "geen", "wel", "al", "nog", "ook", "er", "hier", "daar",
    "is", "zijn", "was", "waren", "ben", "bent", "worden", "hebben",
    "heb", "hebt", "heeft", "had", "hadden",
}


def is_target_candidate(lex: Lexicon) -> bool:
    word = (lex.word or "").strip().lower()
    if not word or word in FUNCTION_WORDS:
        return False
    if word.startswith("'") or any(ch.isdigit() for ch in word):
        return False
    return 3 <= len(word) <= 36


# ---------------------------------------------------------------- user signals

def acquisition_score(user_id: str, db: Session) -> int:
    """Share of decided words the user knows: MASTERED / (MASTERED + LEARNING), in percent."""
    rows = (
        db.query(UserVocabularyVector.status)
        .filter(UserVocabularyVector.user_id == user_id, UserVocabularyVector.status.in_(DECIDED_STATUSES))
        .all()
    )
    if not rows:
        return 0
    mastered = sum(1 for (status,) in rows if status == VocabStatus.MASTERED)
    return int(round(mastered / len(rows) * 100))


def interested_topics(user_id: str, db: Session) -> list[str]:
    return [
        row.topic_name
        for row in db.query(UserTopic)
        .filter(UserTopic.user_id == user_id, UserTopic.status == TopicStatus.INTERESTED)
        .order_by(UserTopic.score.desc(), UserTopic.id)
        .all()
    ]


def decided_word_ids(user_id: str, db: Session) -> set[int]:
    return {
        word_id
        for (word_id,) in db.query(UserVocabularyVector.word_id)
        .filter(UserVocabularyVector.user_id == user_id, UserVocabularyVector.status.in_(DECIDED_STATUSES))
        .all()
    }


def reservoir_rows(user_id: str, db: Session) -> list[RecommendedVocabulary]:
    """Recommendations the user has not yet decided on (not LEARNING / MASTERED)."""
    decided = decided_word_ids(user_id, db)
    rows = (
        db.query(RecommendedVocabulary)
        .filter(RecommendedVocabulary.user_id == user_id)
        .join(RecommendedVocabulary.lexicon_entry)
        .all()
    )
    return [row for row in rows if row.word_id not in decided]


# ---------------------------------------------------------------- refill

def ensure_reservoir(user_id: str, db: Session, minimum: int = RESERVOIR_FLOOR, force: bool = False) -> dict:
    """Refill the reservoir when it drops below `minimum` (or always when `force`).

    Returns a small report dict for logging.
    """
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise ValueError(f"User '{user_id}' not found.")

    usable = reservoir_rows(user_id, db)
    if len(usable) >= minimum and not force:
        return {"skipped": True, "usable": len(usable), "gemini": 0, "fallback": 0}

    needed = max(10, RESERVOIR_TARGET - len(usable))
    gemini_saved = 0
    if gemini.is_configured():
        words = _call_gemini(user, db, needed)
        gemini_saved = _save_words(user_id, words, SOURCE_GEMINI, db)
        if gemini_saved:
            _replace_fallback_rows(user_id, gemini_saved, db)

    usable_after = len(reservoir_rows(user_id, db))
    fallback_saved = 0
    if usable_after < minimum:
        fallback_saved = _top_up_from_lexicon(user, RESERVOIR_TARGET - usable_after, db)

    logger.info(
        "[KRS] user=%s usable=%d needed=%d gemini=%d fallback=%d",
        user_id, len(usable), needed, gemini_saved, fallback_saved,
    )
    return {"skipped": False, "usable": len(usable), "gemini": gemini_saved, "fallback": fallback_saved}


def _call_gemini(user: User, db: Session, count: int) -> list[str]:
    interests = interested_topics(user.user_id, db)
    excluded = _excluded_words(user.user_id, db)
    score = acquisition_score(user.user_id, db)
    level = user.estimated_cefr or "B1"

    language_line = ""
    if user.mother_language:
        others = f" and also speaks {user.other_languages}" if user.other_languages else ""
        language_line = (
            f"- Languages: the learner's mother tongue is {user.mother_language}{others}. "
            f"Prefer words whose meaning is NOT transparent from those languages "
            f"(avoid obvious cognates and international words).\n"
        )

    prompt = (
        "You help choose Dutch vocabulary for an adult language learner.\n\n"
        "LEARNER PROFILE:\n"
        f"- Age: {user.age or 'unknown'}\n"
        f"- Location: {user.city or 'unknown'}\n"
        f"- Job: {user.job or 'unknown'}\n"
        f"- Academic background: {user.academic_background or 'unknown'}\n"
        f"- Purpose of learning Dutch: {user.purpose or 'general'}\n"
        f"- Estimated CEFR level: {level}\n"
        f"- Share of studied words already known: {score}%\n"
        f"- Interests: {', '.join(interests) if interests else 'general life'}\n"
        f"{language_line}\n"
        f"EXCLUSION LIST (never recommend these): {', '.join(sorted(excluded)) if excluded else 'none'}\n\n"
        "TASK:\n"
        f"Recommend exactly {count} common Dutch words (single words, lower-case, dictionary form) that are "
        f"useful for this learner's interests, job and daily life at CEFR level {level}. "
        f"{'Prefer challenging boundary words at the top of the level.' if score > 70 else 'Prefer core, high-frequency words of the level.'}\n"
        "Return ONLY a JSON array of strings.\n"
    )
    try:
        words = gemini.generate_json(prompt, attempts=2, label="KRS", max_output_tokens=1500)
    except Exception as exc:
        logger.warning("[KRS] Gemini call failed: %s", exc)
        return []
    if not isinstance(words, list):
        return []
    return [w.strip().lower() for w in words if isinstance(w, str) and w.strip()]


def _excluded_words(user_id: str, db: Session) -> set[str]:
    known = (
        db.query(Lexicon.word)
        .join(UserVocabularyVector, UserVocabularyVector.word_id == Lexicon.word_id)
        .filter(UserVocabularyVector.user_id == user_id, UserVocabularyVector.status.in_(DECIDED_STATUSES))
        .all()
    )
    recommended = (
        db.query(Lexicon.word)
        .join(RecommendedVocabulary, RecommendedVocabulary.word_id == Lexicon.word_id)
        .filter(RecommendedVocabulary.user_id == user_id)
        .all()
    )
    return {w for (w,) in known} | {w for (w,) in recommended}


def _save_words(user_id: str, words: list[str], source: str, db: Session) -> int:
    if not words:
        return 0
    lexicon_rows = {row.word: row for row in db.query(Lexicon).filter(Lexicon.word.in_(set(words))).all()}
    existing_recs = {
        word_id for (word_id,) in db.query(RecommendedVocabulary.word_id)
        .filter(RecommendedVocabulary.user_id == user_id).all()
    }
    decided = decided_word_ids(user_id, db)

    saved = 0
    for word in words:
        lex = lexicon_rows.get(word)
        if not lex or lex.word_id in existing_recs or lex.word_id in decided or not is_target_candidate(lex):
            continue
        db.add(RecommendedVocabulary(user_id=user_id, word_id=lex.word_id, source=source))
        existing_recs.add(lex.word_id)
        saved += 1
    db.commit()
    return saved


def _replace_fallback_rows(user_id: str, count: int, db: Session) -> None:
    """Fallback rows are the least personalised; drop up to `count` untouched ones once Gemini delivered."""
    touched = {
        word_id for (word_id,) in db.query(UserVocabularyVector.word_id)
        .filter(UserVocabularyVector.user_id == user_id).all()
    }
    rows = (
        db.query(RecommendedVocabulary)
        .filter(RecommendedVocabulary.user_id == user_id, RecommendedVocabulary.source == SOURCE_FALLBACK)
        .order_by(RecommendedVocabulary.recommended_at.asc())
        .all()
    )
    removed = 0
    for row in rows:
        if removed >= count:
            break
        if row.word_id in touched:
            continue
        db.delete(row)
        removed += 1
    if removed:
        db.commit()


def _top_up_from_lexicon(user: User, count: int, db: Session) -> int:
    """Deterministic fallback: unseen lexicon words at the learner's level, then adjacent levels."""
    if count <= 0:
        return 0
    level = user.estimated_cefr if user.estimated_cefr in CEFR_LEVELS else "B1"
    idx = CEFR_LEVELS.index(level)
    levels = [level]
    for step in range(1, len(CEFR_LEVELS)):
        if idx - step >= 0:
            levels.append(CEFR_LEVELS[idx - step])
        if idx + step < len(CEFR_LEVELS):
            levels.append(CEFR_LEVELS[idx + step])

    seen = {
        word_id for (word_id,) in db.query(UserVocabularyVector.word_id)
        .filter(UserVocabularyVector.user_id == user.user_id).all()
    } | {
        word_id for (word_id,) in db.query(RecommendedVocabulary.word_id)
        .filter(RecommendedVocabulary.user_id == user.user_id).all()
    }

    picked: list[Lexicon] = []
    for lvl in levels:
        pool = [
            lex for lex in db.query(Lexicon).filter(Lexicon.cefr_level == lvl).all()
            if lex.word_id not in seen and is_target_candidate(lex)
        ]
        random.shuffle(pool)
        for lex in pool:
            picked.append(lex)
            seen.add(lex.word_id)
            if len(picked) >= count:
                break
        if len(picked) >= count:
            break

    for lex in picked:
        db.add(RecommendedVocabulary(user_id=user.user_id, word_id=lex.word_id, source=SOURCE_FALLBACK))
    db.commit()
    return len(picked)
