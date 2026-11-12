"""Personalised Dutch text generation (first text and continuations)."""
from __future__ import annotations

import logging
import random
import re

from sqlalchemy.orm import Session

from app import gemini
from app.adaptation import build_adaptation
from app.krs_service import SOURCE_GEMINI, reservoir_rows
from app.models import (
    Lexicon,
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

_FIXED_STYLE = "Informative Educational Semi-Narrative Article"

_SYSTEM_INSTRUCTION = """\
You are an expert Dutch Pedagogical Content Creator specialising in L2 educational reading.
Your target style is: Personalized Informative Exploration — halfway between National Geographic
(simplified) and a CEFR reading comprehension passage.

Your writing must adhere to five strict pillars:

1. CEFR Alignment: Follow the specified CEFR level's grammar and sentence length strictly.

2. Educational Article Style: Write like an informative Dutch magazine or cultural-explainer
   article. Prefer events, discoveries, named places, real organizations, and factual
   explanations over fiction, diary entries, or emotional reflection.

3. Informational Density: Every paragraph must teach something concrete and specific.
   Include real statistics, named locations, studies, comparisons, rankings, cultural
   facts, historical context, or expert examples. Generic statements like 'movement is
   healthy' are NOT acceptable unless immediately followed by a real number, study, or
   concrete example. Write like a journalist, not like a brochure.

4. Subtle Personalisation: Let the learner's interests and location INSPIRE the specific
   angle — a sports fan gets cycling statistics, a tech fan gets AI examples, a traveller
   gets cultural comparisons. Do NOT make the article 'about' the learner.
   The reader thinks: 'this topic fits my world', not 'this text is about me'.

5. Lexical Injection: Weave every Target Word naturally into an informative, contextual
   sentence. Vocabulary must feel integral to the facts, not bolted on.

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
            "### INFORMATIONAL DENSITY\n"
            "For A1/A2, prioritize a logical, cohesive, and simple text about daily life or basic facts over "
            "dense journalistic statistics. Keep it grounded in reality.\n"
        )
    if continuation:
        return """\
### INFORMATIONAL RICHNESS — MANDATORY
This continuation MUST introduce at least TWO new concrete data points not in the summary above.
Choose from: a real statistic, a named location or organization, a comparison between countries or eras,
a surprising fact, a scientific finding or historical date.
"""
    return """\
### INFORMATIONAL RICHNESS — MANDATORY
The article MUST contain at least THREE of the following:
  a) A real statistic or number
  b) A named real-world location, organization, institution, or event
  c) A comparison between countries, cities, cultures, or time periods
  d) A surprising or counterintuitive fact
  e) A specific historical date, scientific finding, or expert discovery
  f) A concrete real-world case study or example
Do NOT write vague generalities. Every claim should feel grounded and specific.

### PARAGRAPH STRUCTURE — MANDATORY PROGRESSION
  §1 Hook     — open with a concrete fact, surprising statistic, or vivid specific example.
  §2 Depth    — explain one key aspect with real grounding (number, named place, study).
  §3 Expand   — add a comparison, cultural angle, or contrasting perspective.
  §4 Implication (if word count allows) — consequence, trend, or practical application.
NEVER repeat the same idea twice, even with different wording.
"""


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
Write a Personalized Informative Exploration article in Dutch.
Target: National Geographic (simplified) × CEFR reading passage × educational travel magazine.
NOT a generic health-tip listicle. NOT a personal diary. NOT vague Wikipedia prose.

### LEARNER PROFILE SPOTLIGHT
To subtly inspire the angle of the article, focus on these specific traits of the learner:
{_spotlight_block(user)}

CRITICAL PERSONALISATION RULES:
1. Use the traits above to inspire the specific angle, examples, or comparisons in the text.
2. Do NOT write the article *about* the learner. The reader should think, "This topic fits my world."
3. If a Location is provided, use it only as a brief comparison point. The text must explore the wider world.

### TOPIC
{topic}

### TOPIC DIVERSITY (avoid these recently covered topics and their close subtopics)
Recently used: {", ".join(recent_topics) if recent_topics else "(none)"}
{_perspective_block(user)}
### MANDATORY VOCABULARY
1. BLUE WORDS (new): You MUST include EVERY single word from this list at least once. Wrap each in [[word]]. List: {", ".join(w["word"] for w in blue_words) or "(none)"}
2. YELLOW WORDS (reinforce): You MUST include EVERY single word from this list at least once. Wrap each in [[word]]. List: {", ".join(w["word"] for w in yellow_words) or "(none)"}

CRITICAL RULE: The text MUST flow logically. Build a single, cohesive explanation that naturally incorporates these words.
{_TARGET_WORD_RULE}
{adaptation_section}
{_info_block(cefr, continuation=False)}
### WRITING REQUIREMENTS
- Length: approximately {length} Dutch words.
- {difficulty}
- Vocabulary: integrate [[target_words]] into factual, informative sentences where they fit naturally.
- Do NOT address the reader directly or repeat their city/job more than once if at all.
- Avoid: repeated phrases, thematic loops, restating the same idea, empty encouragement.

### OUTPUT SPECIFICATION
Return ONLY valid JSON:
{{
  "title": "A specific, informative Dutch headline (include a number or named place if natural)",
  "content": "The full Dutch article with [[target_words]] bracketed",
  "metadata": {{
    "topic_used": "{topic}",
    "cefr_actual": "{cefr}",
    "narrative_style": "{_FIXED_STYLE}",
    "injected_blue_count": 0,
    "injected_yellow_count": 0
  }}
}}
"""

    logger.info(
        "[SessionGen] user=%s topic=%s level=%s blue=%d yellow=%d adapt=%s",
        user.user_id, topic, cefr, len(blue_words), len(yellow_words), adapt,
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
    discourse_summary = mem.get("discourse_summary") or (session.content or "")[-600:]
    last_ending = mem.get("last_ending_context") or (session.content or "")[-300:]
    vocab_used: list[str] = mem.get("vocabulary_used", [])

    length, difficulty = _length_and_difficulty(cefr, adapt, "150-200", continuation=True)
    adaptation = _adaptation_block(adapt)
    adaptation_section = f"\n### ADAPTATION FROM PREVIOUS READINGS\n{adaptation}\n" if adaptation else ""

    prompt = f"""\
### CONTINUATION TASK
The learner has ALREADY READ the previous section of this Dutch educational article.
Write the NEXT SECTION — advancing the article with new, concrete information.
Do NOT restart, summarise, repeat, or rephrase anything already covered.
The learner is at CEFR {cefr}.

### WHAT HAS BEEN COVERED (do NOT repeat, rephrase, or re-explain any of this)
**Article summary so far:**
{discourse_summary}

**Last sentence / ending context (continue directly from here):**
"{last_ending}"

**Subtopics already covered:** {", ".join(mem.get("subtopics_used", [topic])) or topic}
**Vocabulary already used:** {", ".join(vocab_used) or "(none)"}
{_perspective_block(user)}
### NEW VOCABULARY TO WEAVE IN (this continuation only)
1. BLUE WORDS — wrap in [[word]]: {", ".join(w["word"] for w in blue_words) or "(none)"}
2. YELLOW WORDS — wrap in [[word]]: {", ".join(w["word"] for w in yellow_words) or "(none)"}

{_TARGET_WORD_RULE}
{adaptation_section}
{_info_block(cefr, continuation=True)}
### STRICT CONTINUATION REQUIREMENTS
Style: Personalized Informative Exploration — factual, specific, magazine-like.
- Continue DIRECTLY from where the article ended — no recap, no re-introduction.
- Each paragraph must advance the topic with genuinely NEW information.
- Length: approximately {length} Dutch words across two paragraphs.
- {difficulty}

### OUTPUT SPECIFICATION
Return ONLY valid JSON:
{{
  "title": "A short, specific informative continuation headline in Dutch",
  "content": "The continuation text with [[target_words]] bracketed",
  "metadata": {{
    "topic_used": "{topic}",
    "cefr_actual": "{cefr}",
    "narrative_style": "{_FIXED_STYLE}",
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
        f"Read the following Dutch educational text about '{topic}' and write a concise "
        f"3-5 sentence summary IN ENGLISH covering: the main topic, key entities mentioned, "
        f"key concepts explained, and how the text ended. Return ONLY the plain summary text.\n\n"
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
