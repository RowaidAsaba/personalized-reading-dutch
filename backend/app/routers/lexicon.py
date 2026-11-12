import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import gemini
from app.database import get_db
from app.models import Lexicon, User
from app.schemas import LexiconEntry
from app.security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/lexicon", tags=["Lexicon"])


@router.get("/word/{word_id}", response_model=LexiconEntry)
def get_word_by_id(word_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = db.query(Lexicon).filter(Lexicon.word_id == word_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Word not found")
    return LexiconEntry.model_validate(entry)


@router.get("/define/{word}", response_model=LexiconEntry)
def define_word(word: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Dictionary lookup; unknown words are defined by Gemini once and cached in the lexicon."""
    clean_word = word.strip().lower()
    if not clean_word or len(clean_word) > 64:
        raise HTTPException(status_code=422, detail="Invalid word")

    existing = db.query(Lexicon).filter(Lexicon.word == clean_word).first()
    if existing:
        return LexiconEntry.model_validate(existing)

    if not gemini.is_configured():
        raise HTTPException(status_code=503, detail="Dictionary lookups need the text generator to be configured.")

    prompt = f"""\
Provide a concise lexicon entry for the Dutch word "{clean_word}".
Return ONLY a valid JSON object with this exact structure:
{{
  "word": "{clean_word}",
  "translation": "English translation (keep it short, 1-5 words)",
  "cefr_level": "A1|A2|B1|B2|C1|C2",
  "examples": [
    {{"nl": "Dutch example sentence using the word", "en": "English translation of that sentence"}},
    {{"nl": "Another Dutch example", "en": "Its English translation"}}
  ],
  "use_cases": [
    {{"nl": "Context sentence showing typical use", "en": "English translation"}}
  ]
}}
"""
    try:
        data = gemini.generate_json(prompt, attempts=2, label="Lexicon")
    except Exception as exc:
        logger.warning("[Lexicon/define] failed for %r: %s", clean_word, exc)
        raise HTTPException(status_code=502, detail="Could not look up this word right now.")
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Could not look up this word right now.")

    entry = Lexicon(
        word=clean_word,
        translation=str(data.get("translation") or "—")[:255],
        cefr_level=str(data.get("cefr_level") or "B1")[:10],
        examples=data.get("examples") or [],
        use_cases=data.get("use_cases") or [],
    )
    db.add(entry)
    try:
        db.commit()
        db.refresh(entry)
    except Exception:
        db.rollback()
        existing = db.query(Lexicon).filter(Lexicon.word == clean_word).first()
        if existing:
            return LexiconEntry.model_validate(existing)
        raise
    return LexiconEntry.model_validate(entry)
