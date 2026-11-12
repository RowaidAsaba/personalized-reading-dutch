"""How reading feedback changes what the next text looks like.

Every "End reading" with feedback writes:
  * a reading_feedback row and a per-session feedback_signal,
  * topic scores on user_topics (interest and relevance),
  * users.difficulty_offset after three consistent difficulty ratings.

`build_adaptation()` turns the last few feedbacks into the instructions that
the text generator puts in its prompt.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import (
    ReadingFeedback,
    ReadingSession,
    TopicStatus,
    User,
    UserTopic,
    utcnow,
)

FEEDBACK_WINDOW = 3            # feedbacks averaged for difficulty / worth
INTEREST_WINDOW = 2            # feedbacks checked for low interest / relevance
LOW_RATING = 2                 # stars <= this count as "low"
TOPIC_SCORE_UP = 0.2
TOPIC_SCORE_DOWN = 0.3
TOPIC_SCORE_MIN = 0.2
TOPIC_SCORE_MAX = 2.0
HATED_THRESHOLD = 0.4          # neutral topics at or below this become HATED

DIFFICULTY_LABELS = {
    1: "much_harder",
    2: "harder",
    3: "same",
    4: "easier",
    5: "much_easier",
}


def signal_for(feedback: ReadingFeedback) -> dict:
    """Per-feedback signal stored on the session (for history and debugging)."""
    return {
        "difficulty": feedback.difficulty,
        "interest": feedback.interest,
        "relevance": feedback.relevance,
        "worth_time": feedback.worth_time,
        "challenge_direction": DIFFICULTY_LABELS[feedback.difficulty],
        "interest_boost": feedback.interest <= LOW_RATING or feedback.relevance <= LOW_RATING,
        "shorter": feedback.worth_time <= LOW_RATING,
    }


def recent_feedbacks(user_id: str, db: Session, limit: int, since=None) -> list[ReadingFeedback]:
    q = (
        db.query(ReadingFeedback)
        .join(ReadingSession, ReadingSession.session_id == ReadingFeedback.session_id)
        .filter(ReadingSession.user_id == user_id)
    )
    if since is not None:
        q = q.filter(ReadingFeedback.created_at > since)
    return q.order_by(ReadingFeedback.created_at.desc(), ReadingFeedback.id.desc()).limit(limit).all()


def build_adaptation(user: User, db: Session) -> dict:
    """Aggregate the last feedbacks into prompt-level instructions.

    difficulty: 1..5 rounded average of the last 3 difficulty ratings (3 = keep level)
    interest_boost: any low interest or relevance in the last 2 feedbacks
    shorter: mean worth-your-time of the last 3 feedbacks below 2.5
    """
    rows = recent_feedbacks(user.user_id, db, FEEDBACK_WINDOW)
    if not rows:
        return {"difficulty": 3, "interest_boost": False, "shorter": False, "feedback_count": 0}

    avg_difficulty = sum(r.difficulty for r in rows) / len(rows)
    difficulty = max(1, min(5, int(round(avg_difficulty))))
    avg_worth = sum(r.worth_time for r in rows) / len(rows)
    interest_boost = any(
        r.interest <= LOW_RATING or r.relevance <= LOW_RATING for r in rows[:INTEREST_WINDOW]
    )
    return {
        "difficulty": difficulty,
        "interest_boost": interest_boost,
        "shorter": avg_worth < 2.5,
        "feedback_count": len(rows),
    }


def apply_feedback(user: User, session: ReadingSession, feedback: ReadingFeedback, db: Session) -> dict:
    """Write everything a feedback answer changes. Caller commits."""
    signal = signal_for(feedback)
    session.feedback_signal = signal
    update_topic_scores(user, session.topic_used, feedback, db)
    signal["difficulty_offset"] = update_difficulty_offset(user, db)
    return signal


def update_topic_scores(user: User, topic_used: str | None, feedback: ReadingFeedback, db: Session) -> None:
    if not topic_used:
        return
    topic = topic_used.strip().lower()
    rating = min(feedback.interest, feedback.relevance)
    row = (
        db.query(UserTopic)
        .filter(UserTopic.user_id == user.user_id, UserTopic.topic_name == topic)
        .first()
    )

    if row is None:
        # A topic from the neutral pool: remember how it landed.
        if rating <= LOW_RATING:
            db.add(UserTopic(
                user_id=user.user_id, topic_name=topic, status=TopicStatus.NEUTRAL,
                score=max(TOPIC_SCORE_MIN, 1.0 - TOPIC_SCORE_DOWN),
            ))
        elif feedback.interest >= 4:
            db.add(UserTopic(
                user_id=user.user_id, topic_name=topic, status=TopicStatus.NEUTRAL,
                score=min(TOPIC_SCORE_MAX, 1.0 + TOPIC_SCORE_UP),
            ))
        return

    if feedback.interest >= 4:
        row.score = min(TOPIC_SCORE_MAX, (row.score or 1.0) + TOPIC_SCORE_UP)
    elif rating <= LOW_RATING:
        row.score = max(TOPIC_SCORE_MIN, (row.score or 1.0) - TOPIC_SCORE_DOWN)
        if row.status == TopicStatus.NEUTRAL and row.score <= HATED_THRESHOLD:
            row.status = TopicStatus.HATED
    row.updated_at = utcnow()


def update_difficulty_offset(user: User, db: Session) -> int:
    """Move the offset one step when the last 3 ratings (since the last move) are all on one side."""
    rows = recent_feedbacks(user.user_id, db, FEEDBACK_WINDOW, since=user.difficulty_offset_updated_at)
    if len(rows) < FEEDBACK_WINDOW:
        return user.difficulty_offset or 0

    ratings = [r.difficulty for r in rows]
    current = user.difficulty_offset or 0
    if all(r <= 2 for r in ratings) and current < 1:
        user.difficulty_offset = current + 1
        user.difficulty_offset_updated_at = utcnow()
    elif all(r >= 4 for r in ratings) and current > -1:
        user.difficulty_offset = current - 1
        user.difficulty_offset_updated_at = utcnow()
    return user.difficulty_offset or 0
