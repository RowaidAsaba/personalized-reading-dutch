"""Personalised Dutch text generation (first text and continuations)."""
from __future__ import annotations

import logging
import random
import re

from sqlalchemy.orm import Session

from app import gemini
from app.adaptation import build_adaptation
from app.krs_service import SOURCE_GEMINI, ensure_reservoir, reservoir_rows
from app.models import (
    Lexicon,
    ReadingFeedback,
    ReadingSession,
    RecommendedVocabulary,
    TopicStatus,
    User,
    UserTopic,
    UserVocabularyVector,
    VocabStatus,
    utcnow,
)

logger = logging.getLogger(__name__)

GenerationFailedError = gemini.GenerationFailedError
GenerationRateLimitError = gemini.GenerationRateLimitError

INTEREST_SHARE = 0.7            # chance the topic comes from the user's interests
RECENT_TOPIC_WINDOW = 5         # avoid topics of the last N texts
YELLOW_POOL = 8                 # learning words considered for reinforcement
MAX_BLUE_WORDS_DEFAULT = 2

_NEUTRAL_POOL = [
    "reizen", "technologie", "muziek", "natuur", "gezondheid",
    "wetenschap", "duurzaamheid", "sport", "cultuur", "innovatie",
    "voedsel", "media", "geschiedenis", "steden", "onderwijs",
]

# Rotating text styles: key -> (name shown in the prompt, one-line guide).
STYLES: dict[str, tuple[str, str]] = {
    "short_story": (
        "Short story",
        "A character wants something, meets an obstacle, and it resolves.",
    ),
    "mystery_explainer": (
        "Mystery explainer",
        "Open with a strange fact or puzzle, then reveal the explanation step by step.",
    ),
    "true_profile": (
        "True profile",
        "The real story of a person, place or invention, told as a story.",
    ),
    "scene": (
        "Scene",
        "One vivid moment in a place, seen through someone's eyes.",
    ),
    "day_in_the_life": (
        "Day in the life",
        "Someone's day in a job or place connected to the topic.",
    ),
    "interview": (
        "Interview",
        "A short Q&A with a (fictional) expert or character.",
    ),
}
STYLE_ROTATION_WINDOW = 2       # never repeat the style of the last N texts
STYLE_LOW_INTEREST = 2          # last feedback with interest <= this also blocks that text's style

_SYSTEM_INSTRUCTION = """\
You are an expert Dutch writer for second-language learners. You write short texts that people
read for pleasure: stories, scenes, profiles, interviews and explainers that start with a hook,
follow one thread and end well. You are not a textbook and not an encyclopedia.

Your writing must adhere to four strict pillars:

1. CEFR Alignment: Follow the specified CEFR level's grammar and sentence length strictly.
   Apart from the target words, the reader must be able to read without stopping.

2. Enjoyment: concrete scenes, people with stakes, specific names, numbers and objects,
   one surprise, and a satisfying ending. No lecturing, no moralising, no filler.

3. Truth: invented characters and scenes are fine, but every fact around them must be
   accurate. Never invent statistics, studies, places or historical claims.

4. Subtle Personalisation: Let the learner's traits INSPIRE the angle, setting or examples.
   Do NOT write the text 'about' the learner.
   The reader thinks: 'this fits my world', not 'this text is about me'.

Lexical Injection: Weave every Target Word naturally into a sentence whose context helps the
reader guess its meaning. The words must serve the story, not interrupt it.

Formatting Rule: Every time you use a word from the provided Target Lists,
you MUST wrap it in double brackets, like this: [[woord]]. Do NOT wrap any other words in brackets.\
"""

_GENDER_NOUN = {
    "female": "a woman",
    "male": "a man",
    "non_binary": "a non-binary person",
}


# ---------------------------------------------------------------- helpers

def _strip_inline_markdown(text: str | None) -> str:
    if not text:
        return ""
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)
    return text


def clean_title(title: str | None, fallback: str = "") -> str:
    text = _strip_inline_markdown(title).strip() or fallback
    return re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)


def _lex_to_dict(entry: Lexicon) -> dict:
    return {
        "word_id": entry.word_id,
        "word": entry.word,
        "translation": entry.translation,
        "cefr_level": entry.cefr_level,
        "examples": entry.examples or [],
    }


def _is_basic_level(cefr: str) -> bool:
    return cefr in ("A1", "A2")


# ---------------------------------------------------------------- prompt blocks

def _adaptation_block(adapt: dict) -> str:
    if not adapt.get("feedback_count"):
        return ""
    lines: list[str] = []
    difficulty = adapt.get("difficulty", 3)
    if difficulty == 1:
        lines.append(
            "The learner rated recent texts TOO EASY. Make this text clearly harder: use more complex and "
            "varied sentence structures, subordinate clauses, and a higher proportion of new (blue) words."
        )
    elif difficulty == 2:
        lines.append(
            "The learner rated recent texts a bit easy. Make this text slightly harder: a few longer sentences "
            "and slightly less frequent vocabulary."
        )
    elif difficulty == 4:
        lines.append(
            "The learner found recent texts a bit difficult. Make this text slightly simpler: shorter sentences "
            "and more familiar vocabulary around the target words."
        )
    elif difficulty == 5:
        lines.append(
            "The learner found recent texts TOO DIFFICULT. Make this text clearly simpler: short sentences, "
            "no long subordinate clauses, high-frequency everyday vocabulary, and explain any necessary "
            "difficult term immediately in simple words."
        )
    else:
        lines.append("Recent texts were rated at the right difficulty. Keep the same level and sentence complexity.")

    if adapt.get("interest_boost"):
        lines.append(
            "The learner found recent texts not interesting or not relevant to them. Choose an angle that "
            "connects explicitly to their stated interests and profile, and make that connection visible early "
            "in the text (first paragraph). Prefer surprising, concrete and current examples."
        )
    if adapt.get("shorter"):
        lines.append(
            "The learner felt recent texts were not worth their time. Keep this text short and practical: "
            "focus on information the learner can use (tips, numbers, how-to, where, when), no padding."
        )
    return "\n".join(lines)


def _perspective_block(user: User) -> str:
    noun = _GENDER_NOUN.get(user.gender or "")
    if not noun:
        return ""
    return f"""
### PERSPECTIVE (does not change topic, difficulty or vocabulary)
When the article features a person, interviewee, example character or first-person example,
prefer {noun} in that role where it is natural. Keep the topic, facts, difficulty and target
words exactly as specified. Never state or imply what this reader is "typically" interested
in because of this.
"""


def _spotlight_block(user: User) -> str:
    profile_pool = []
    if user.city:
        profile_pool.append(f"Location: {user.city}")
    if user.job:
        profile_pool.append(f"Occupation: {user.job}")
    if user.academic_background:
        profile_pool.append(f"Academic Background: {user.academic_background}")
    if user.purpose:
        profile_pool.append(f"Learning Purpose: {user.purpose}")
    spotlight = random.sample(profile_pool, min(2, len(profile_pool))) if profile_pool else ["General Adult Learner"]
    return "\n".join(f"- {attr}" for attr in spotlight)


# ---------------------------------------------------------------- selection

def _recent_topics(user_id: str, db: Session) -> list[str]:
    rows = (
        db.query(ReadingSession.topic_used)
        .filter(ReadingSession.user_id == user_id)
        .order_by(ReadingSession.session_id.desc())
        .limit(RECENT_TOPIC_WINDOW)
        .all()
    )
    return [topic for (topic,) in rows if topic]


def _recent_styles(user_id: str, db: Session, limit: int) -> list[str | None]:
    rows = (
        db.query(ReadingSession.narrative_style)
        .filter(ReadingSession.user_id == user_id)
        .order_by(ReadingSession.session_id.desc())
        .limit(limit)
        .all()
    )
    return [style for (style,) in rows]


def choose_style(user_id: str, db: Session) -> str:
    """Rotate styles: never the style of the last two texts, and not the style of the
    last text if its feedback said it was not interesting."""
    blocked = {style for style in _recent_styles(user_id, db, STYLE_ROTATION_WINDOW) if style}
    last = (
        db.query(ReadingSession, ReadingFeedback)
        .join(ReadingFeedback, ReadingFeedback.session_id == ReadingSession.session_id)
        .filter(ReadingSession.user_id == user_id)
        .order_by(ReadingFeedback.created_at.desc(), ReadingFeedback.id.desc())
        .first()
    )
    if last is not None:
        session, feedback = last
        if feedback.interest <= STYLE_LOW_INTEREST and session.narrative_style:
            blocked.add(session.narrative_style)
    candidates = [key for key in STYLES if key not in blocked] or list(STYLES)
    return random.choice(candidates)


def _style_lines(style_key: str | None) -> tuple[str, str]:
    name, guide = STYLES.get(style_key or "", STYLES["short_story"])
    return name, guide


def _weighted_choice(rows: list[UserTopic]) -> str:
    weights = [max(0.05, row.score or 1.0) for row in rows]
    return random.choices([row.topic_name for row in rows], weights=weights, k=1)[0]


def choose_topic(user_id: str, db: Session, interest_only: bool = False) -> str:
    topics = db.query(UserTopic).filter(UserTopic.user_id == user_id).all()
    hated = {t.topic_name for t in topics if t.status == TopicStatus.HATED}
    recent = set(_recent_topics(user_id, db))
    blocked = hated | recent

    interested = [t for t in topics if t.status == TopicStatus.INTERESTED]
    neutral_rows = [t for t in topics if t.status == TopicStatus.NEUTRAL]

    use_interests = interest_only or random.random() < INTEREST_SHARE
    if use_interests and interested:
        candidates = [t for t in interested if t.topic_name not in blocked] or interested
        return _weighted_choice(candidates)

    neutral_candidates = [t for t in neutral_rows if t.topic_name not in blocked]
    pool = [name for name in _NEUTRAL_POOL if name not in blocked]
    if neutral_candidates or pool:
        # Rated neutral topics carry their score; the fixed pool counts as weight 1.
        names = [t.topic_name for t in neutral_candidates] + pool
        weights = [max(0.05, t.score or 1.0) for t in neutral_candidates] + [1.0] * len(pool)
        return random.choices(names, weights=weights, k=1)[0]
    if interested:
        return _weighted_choice(interested)
    return random.choice([name for name in _NEUTRAL_POOL if name not in hated] or ["dagelijks leven"])


def _pick_blue_words(user_id: str, count: int, db: Session) -> list[Lexicon]:
    """New target words from the reservoir: never-shown words first, then least exposed."""
    rows = reservoir_rows(user_id, db)
    if len(rows) < count:
        # Brand-new user or drained reservoir: refill now rather than teaching nothing.
        try:
            ensure_reservoir(user_id, db, minimum=max(count, 10))
        except Exception as exc:  # pragma: no cover - generation continues without blue words
            logger.warning("[SessionGen] reservoir refill failed for %s: %s", user_id, exc)
        rows = reservoir_rows(user_id, db)
    if not rows:
        return []
    vectors = {
        v.word_id: v for v in db.query(UserVocabularyVector)
        .filter(UserVocabularyVector.user_id == user_id, UserVocabularyVector.status == VocabStatus.ENCOUNTERED)
        .all()
    }

    def sort_key(row: RecommendedVocabulary):
        vec = vectors.get(row.word_id)
        exposure = vec.exposure_count if vec else -1
        source_rank = 0 if row.source == SOURCE_GEMINI else 1
        return (exposure, source_rank, random.random())

    rows.sort(key=sort_key)
    return [row.lexicon_entry for row in rows[:count]]


def _pick_yellow_words(user_id: str, db: Session) -> list[Lexicon]:
    """Learning words to reinforce: lowest mastery and least exposure first."""
    pool = (
        db.query(UserVocabularyVector)
        .join(UserVocabularyVector.lexicon_entry)
        .filter(UserVocabularyVector.user_id == user_id, UserVocabularyVector.status == VocabStatus.LEARNING)
        .order_by(UserVocabularyVector.mastery_score.asc(), UserVocabularyVector.exposure_count.asc())
        .limit(YELLOW_POOL)
        .all()
    )
    if not pool:
        return []
    sample_size = min(len(pool), random.randint(2, 4))
    return [row.lexicon_entry for row in random.sample(pool, sample_size)]


def record_exposure(user_id: str, word_ids: list[int], db: Session) -> None:
    """A generated text contained these words: count it on the vector."""
    if not word_ids:
        return
    now = utcnow()
    rows = {
        row.word_id: row for row in db.query(UserVocabularyVector)
        .filter(UserVocabularyVector.user_id == user_id, UserVocabularyVector.word_id.in_(word_ids))
        .all()
    }
    for word_id in word_ids:
        row = rows.get(word_id)
        if row:
            row.exposure_count = (row.exposure_count or 0) + 1
            row.last_seen_in_text_at = now
        else:
            db.add(UserVocabularyVector(
                user_id=user_id, word_id=word_id, status=VocabStatus.ENCOUNTERED,
                mastery_score=0.0, exposure_count=1, last_seen_in_text_at=now, source="reading",
            ))


def _length_and_difficulty(cefr: str, adapt: dict, word_count_range: str, continuation: bool) -> tuple[str, str]:
    basic = _is_basic_level(cefr)
    if continuation:
        length = "80-120" if basic else "180-220"
        if adapt.get("shorter"):
            length = "60-90" if basic else "120-150"
    else:
        length = "100-150" if basic else word_count_range
        if adapt.get("shorter"):
            length = "80-110" if basic else "100-140"

    if basic:
        difficulty = (
            f"Difficulty: CEFR {cefr} — Use simple, short sentences. You CAN use basic connectors "
            f"(like 'en', 'maar', 'want', 'omdat') so the text flows naturally. Avoid highly complex nested "
            f"clauses, but ensure the text is connected and logical."
        )
    else:
        difficulty = f"Difficulty: CEFR {cefr} — clear grammar, appropriate sentence complexity, no advanced subjunctive."
    return length, difficulty


def _info_block(cefr: str, continuation: bool) -> str:
    if _is_basic_level(cefr):
        return (
            "- For A1/A2: one simple, concrete situation from daily life, told in short clear steps. "
            "Grounded in reality, no statistics needed."
        )
    if continuation:
        return (
            "- Ground this part in at least ONE new true, specific detail (a real place, name, number or date) "
            "that was not in the earlier parts."
        )
    return (
        "- Ground the text in at least TWO true, specific details (a real place, name, number or date). "
        "They should feel like part of the story, not like a fact box."
    )


_TARGET_WORD_RULE = (
    "CRITICAL RULE FOR TARGET WORDS: If a target word is a basic everyday object (e.g., 'stoel', 'raam'), "
    "do NOT invent fake facts or bizarre logic to make it sound 'educational'. Just use the word naturally "
    "in a normal, logical sentence. Never sacrifice logic just to force an educational tone."
)


# ---------------------------------------------------------------- generation

def generate_session(user: User, db: Session, word_count_range: str = "150-200") -> ReadingSession:
    adapt = build_adaptation(user, db)
    cefr = user.effective_cefr
    reading_number = db.query(ReadingSession).filter(ReadingSession.user_id == user.user_id).count() + 1

    topic = choose_topic(user.user_id, db, interest_only=bool(adapt.get("interest_boost")))
    recent_topics = _recent_topics(user.user_id, db)
    style_key = choose_style(user.user_id, db)
    style, style_guide = _style_lines(style_key)

    blue_count = {1: 3, 2: 2, 5: 1}.get(adapt.get("difficulty", 3), random.randint(1, MAX_BLUE_WORDS_DEFAULT))
    blue_entries = _pick_blue_words(user.user_id, blue_count, db)
    yellow_entries = _pick_yellow_words(user.user_id, db)
    blue_words = [_lex_to_dict(e) for e in blue_entries]
    yellow_words = [_lex_to_dict(e) for e in yellow_entries]

    length, difficulty = _length_and_difficulty(cefr, adapt, word_count_range, continuation=False)
    adaptation = _adaptation_block(adapt)
    adaptation_section = f"\n### ADAPTATION FROM PREVIOUS READINGS\n{adaptation}\n" if adaptation else ""

    prompt = f"""\
### GENERATION TASK
Write a short Dutch text that a learner will ENJOY reading: something they would read even if it were not for practice.
Style for this text: {style}
{style_guide}

### LEARNER PROFILE SPOTLIGHT
These traits should inspire the angle, setting or examples, not the subject:
{_spotlight_block(user)}
- The reader should think "this fits my world", never "this is about me".
- Use a Location at most once, as a small setting detail or comparison.

### TOPIC
{topic}
Recently used (avoid these and close subtopics): {", ".join(recent_topics) if recent_topics else "(none)"}
{_perspective_block(user)}

### WHAT MAKES IT ENJOYABLE (follow all)
1. Hook first: open with a concrete scene, a surprising fact, or a question the reader wants answered. Never open with a definition or a general statement.
2. One clear thread: build the text around one question, problem or small journey, and pay it off by the end.
3. People and stakes: where natural, follow a person (real or invented) who wants something or faces a problem.
4. Concrete over abstract: specific names, numbers, places, objects, sounds. Show, don't summarise.
5. One surprise: include at least one specific, true detail the reader probably did not know.
6. Rhythm: mix short and medium sentences; use a line of direct speech or a question where it fits the level.
7. Satisfying ending: close with a twist, a small insight, or a line that links back to the opening. No moral, no summary, no "Kortom".
8. Facts must be true. Invented characters and scenes are fine, but the facts around them must be accurate.

### MANDATORY VOCABULARY
1. BLUE WORDS (new): include EVERY word at least once, wrapped in [[word]]: {", ".join(w["word"] for w in blue_words) or "(none)"}
2. YELLOW WORDS (reinforce): include EVERY word at least once, wrapped in [[word]]: {", ".join(w["word"] for w in yellow_words) or "(none)"}
Put each target word in a sentence where the context helps the reader guess its meaning. The words must serve the story, not interrupt it.
{_TARGET_WORD_RULE}

### LEVEL
{adaptation_section}
{_info_block(cefr, continuation=False)}
- Apart from the target words, use only vocabulary and grammar the learner clearly knows at {cefr}, so they can read without stopping (aim for about 98% familiar words).
- Length: approximately {length} Dutch words.
- {difficulty}

### AVOID
Encyclopedia or textbook tone, lists of tips, lecturing or moralising, giving the reader advice in "jij"-form, repeating the same idea, filler sentences, empty enthusiasm ("Dat is echt fascinerend!").

### OUTPUT SPECIFICATION
Return ONLY valid JSON:
{{
  "title": "A short Dutch title that makes the reader curious: a question, a named person or place, or a surprising claim. No clickbait.",
  "content": "The full Dutch text with [[target_words]] bracketed",
  "metadata": {{
    "topic_used": "{topic}",
    "cefr_actual": "{cefr}",
    "narrative_style": "{style}",
    "injected_blue_count": 0,
    "injected_yellow_count": 0
  }}
}}
"""

    logger.info(
        "[SessionGen] user=%s topic=%s style=%s level=%s blue=%d yellow=%d adapt=%s",
        user.user_id, topic, style_key, cefr, len(blue_words), len(yellow_words), adapt,
    )
    story = gemini.generate_json(prompt, system_instruction=_SYSTEM_INSTRUCTION, label="SessionGen")
    if not isinstance(story, dict) or not story.get("content"):
        raise GenerationFailedError("The text generator returned an empty text. Please try again.")

    content = _strip_inline_markdown(story.get("content"))
    word_translations = {w["word"].lower(): w["translation"] for w in blue_words + yellow_words}

    session = ReadingSession(
        user_id=user.user_id,
        title=clean_title(story.get("title"), f"Reading {reading_number}"),
        content=content,
        topic_used=topic,
        reading_number=reading_number,
        cefr_level_used=cefr,
        narrative_style=style_key,
        blue_word_ids=[w["word_id"] for w in blue_words],
        yellow_word_ids=[w["word_id"] for w in yellow_words],
        looked_up_word_ids=[],
        word_translations=word_translations,
        narrative_memory=None,
    )
    db.add(session)
    record_exposure(user.user_id, [w["word_id"] for w in blue_words + yellow_words], db)
    db.commit()
    db.refresh(session)

    session.narrative_memory = _build_narrative_memory(
        content=content, topic=topic,
        words=[w["word"] for w in blue_words + yellow_words],
    )
    db.commit()
    db.refresh(session)
    session.generation_metadata = story.get("metadata", {})  # transient, for the response
    return session


def generate_continuation(user: User, session: ReadingSession, db: Session) -> ReadingSession:
    adapt = build_adaptation(user, db)
    cefr = session.cefr_level_used or user.effective_cefr

    blue_entries = _pick_blue_words(user.user_id, random.randint(1, MAX_BLUE_WORDS_DEFAULT), db)
    yellow_entries = _pick_yellow_words(user.user_id, db)
    blue_words = [_lex_to_dict(e) for e in blue_entries]
    yellow_words = [_lex_to_dict(e) for e in yellow_entries]

    mem: dict = session.narrative_memory or {}
    topic = session.topic_used or "Dutch everyday life"
    style, style_guide = _style_lines(session.narrative_style)
    discourse_summary = mem.get("discourse_summary") or (session.content or "")[-600:]
    last_ending = mem.get("last_ending_context") or (session.content or "")[-300:]
    vocab_used: list[str] = mem.get("vocabulary_used", [])

    length, difficulty = _length_and_difficulty(cefr, adapt, "150-200", continuation=True)
    adaptation = _adaptation_block(adapt)
    adaptation_section = f"\n### ADAPTATION FROM PREVIOUS READINGS\n{adaptation}\n" if adaptation else ""

    prompt = f"""\
### CONTINUATION TASK
The learner has ALREADY READ the earlier parts of this Dutch text and chose "Continue the story".
Write the NEXT PART: same style, same characters, same thread. Move it forward.
Do NOT restart, summarise, repeat or rephrase anything already covered.
Style of this text: {style}
{style_guide}

### WHAT CAME BEFORE (do NOT repeat or re-explain any of this)
**Summary of the earlier parts:**
{discourse_summary}

**Last lines (continue directly from here):**
"{last_ending}"

**Subtopics already covered:** {", ".join(mem.get("subtopics_used", [topic])) or topic}
**Vocabulary already used:** {", ".join(vocab_used) or "(none)"}
{_perspective_block(user)}

### WHAT MAKES IT ENJOYABLE (follow all)
1. Pick up the thread: the same people, place and open question as before; the reader should feel the story moving.
2. Something new happens: a development, a complication, a discovery or an answer. Not more of the same.
3. Concrete over abstract: specific names, numbers, places, objects, sounds. Show, don't summarise.
4. One surprise: include at least one specific, true detail the reader probably did not know.
5. Rhythm: mix short and medium sentences; use a line of direct speech or a question where it fits the level.
6. Ending: stop at a natural resting point that feels complete, but leave ONE small open question or loose end,
   so continuing is tempting and stopping here also feels fine. No moral, no summary, no "Kortom".
7. Facts must be true. Invented characters and scenes are fine, but the facts around them must be accurate.

### MANDATORY VOCABULARY (this part only)
1. BLUE WORDS (new): include EVERY word at least once, wrapped in [[word]]: {", ".join(w["word"] for w in blue_words) or "(none)"}
2. YELLOW WORDS (reinforce): include EVERY word at least once, wrapped in [[word]]: {", ".join(w["word"] for w in yellow_words) or "(none)"}
Put each target word in a sentence where the context helps the reader guess its meaning. The words must serve the story, not interrupt it.
{_TARGET_WORD_RULE}

### LEVEL
The learner is at CEFR {cefr}.
{adaptation_section}
{_info_block(cefr, continuation=True)}
- Apart from the target words, use only vocabulary and grammar the learner clearly knows at {cefr}, so they can read without stopping (aim for about 98% familiar words).
- Length: approximately {length} Dutch words.
- {difficulty}

### AVOID
Recaps, encyclopedia or textbook tone, lists of tips, lecturing or moralising, advice in "jij"-form, repeating an idea, filler sentences, empty enthusiasm.

### OUTPUT SPECIFICATION
Return ONLY valid JSON:
{{
  "title": "A short Dutch title for this part that makes the reader curious",
  "content": "The continuation text with [[target_words]] bracketed",
  "metadata": {{
    "topic_used": "{topic}",
    "cefr_actual": "{cefr}",
    "narrative_style": "{style}",
    "injected_blue_count": 0,
    "injected_yellow_count": 0
  }}
}}
"""

    logger.info("[SessionGen] continuation user=%s session=%s blue=%d yellow=%d",
                user.user_id, session.session_id, len(blue_words), len(yellow_words))
    story = gemini.generate_json(prompt, system_instruction=_SYSTEM_INSTRUCTION, temperature=0.7, label="SessionGen")
    if not isinstance(story, dict) or not story.get("content"):
        raise GenerationFailedError("Could not generate a continuation. Please try again.")

    new_chunk = _strip_inline_markdown(story.get("content"))
    session.content = (session.content or "") + "\n\n" + new_chunk
    session.continuation_count = (session.continuation_count or 0) + 1
    session.last_continued_at = utcnow()

    translations = dict(session.word_translations or {})
    for w in blue_words + yellow_words:
        translations[w["word"].lower()] = w["translation"]
    session.word_translations = translations
    session.blue_word_ids = sorted(set(session.blue_word_ids or []) | {w["word_id"] for w in blue_words})
    session.yellow_word_ids = sorted(set(session.yellow_word_ids or []) | {w["word_id"] for w in yellow_words})
    session.narrative_memory = _build_narrative_memory(
        content=session.content, topic=topic,
        words=[w["word"] for w in blue_words + yellow_words],
        existing_memory=mem,
    )
    record_exposure(user.user_id, [w["word_id"] for w in blue_words + yellow_words], db)
    db.commit()
    db.refresh(session)
    session.generation_metadata = story.get("metadata", {})
    return session


# ---------------------------------------------------------------- narrative memory

def _generate_summary(content: str, topic: str) -> str:
    prompt = (
        f"Read the following Dutch text about '{topic}' and write a concise "
        f"3-5 sentence summary IN ENGLISH covering: the style and setting, the characters or people, "
        f"what happens or is explained, any open question, and how the text ended. Return ONLY the plain summary text.\n\n"
        f"TEXT:\n{content[:3000]}"
    )
    try:
        return gemini.generate_text(prompt)
    except Exception as exc:
        logger.warning("[SessionGen] summary failed, using tail excerpt: %s", exc)
        return content[-400:].strip()


def _build_narrative_memory(content: str, topic: str, words: list[str], existing_memory: dict | None = None) -> dict:
    prev = existing_memory or {}
    subtopics = list(prev.get("subtopics_used", []))
    if topic and topic not in subtopics:
        subtopics.append(topic)
    vocabulary = list(prev.get("vocabulary_used", []))
    for w in words:
        if w not in vocabulary:
            vocabulary.append(w)
    return {
        "topic": topic,
        "subtopics_used": subtopics,
        "vocabulary_used": vocabulary,
        "discourse_summary": _generate_summary(content, topic),
        "last_ending_context": content.strip()[-300:].strip(),
    }
