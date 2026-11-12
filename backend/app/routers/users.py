import datetime
import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models import ReadingSession, TopicStatus, User, UserTopic, UserVocabularyVector, VocabStatus, utcnow
from app.schemas import ProfileUpdateRequest, UserOut
from app.security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users", tags=["Users"])

WORDS_KNOWN_GOAL = 1000


def user_out(user: User, db: Session) -> UserOut:
    interests = [
        row.topic_name
        for row in db.query(UserTopic)
        .filter(UserTopic.user_id == user.user_id, UserTopic.status == TopicStatus.INTERESTED)
        .order_by(UserTopic.id)
        .all()
    ]
    return UserOut(
        id=user.user_id,
        email=user.email,
        display_name=user.display_name,
        interests=interests,
        estimated_cefr=user.estimated_cefr,
        effective_cefr=user.effective_cefr if user.estimated_cefr else None,
        difficulty_offset=user.difficulty_offset or 0,
        onboarding_completed=user.onboarding_completed,
        has_password=bool(user.password_hash),
        has_google=bool(user.google_sub),
        age=user.age,
        city=user.city,
        gender=user.gender,
        job=user.job,
        academic_background=user.academic_background,
        mother_language=user.mother_language,
        other_languages=user.other_languages,
        purpose=user.purpose,
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


def _refresh_recommendations(user_id: str) -> None:
    """Background: refill the recommendation reservoir after the profile changed."""
    from app.krs_service import ensure_reservoir

    db = SessionLocal()
    try:
        ensure_reservoir(user_id, db, force=True)
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning("[Users] recommendation refresh failed for %s: %s", user_id, exc)
    finally:
        db.close()


def replace_interests(user: User, interests: list[str], db: Session) -> bool:
    """Replace the INTERESTED topics, keeping the learned score of topics that stay."""
    wanted: list[str] = []
    for raw in interests:
        value = raw.strip().lower()
        if value and value not in wanted:
            wanted.append(value)

    rows = {
        row.topic_name: row
        for row in db.query(UserTopic).filter(UserTopic.user_id == user.user_id).all()
    }
    changed = False
    for name, row in rows.items():
        if row.status == TopicStatus.INTERESTED and name not in wanted:
            db.delete(row)
            changed = True
    for name in wanted:
        row = rows.get(name)
        if row is None:
            db.add(UserTopic(user_id=user.user_id, topic_name=name, status=TopicStatus.INTERESTED, score=1.0))
            changed = True
        elif row.status != TopicStatus.INTERESTED:
            row.status = TopicStatus.INTERESTED
            row.score = 1.0
            changed = True
    return changed


@router.get("/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_out(user, db)


@router.put("/me/profile", response_model=UserOut)
def update_profile(
    payload: ProfileUpdateRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile_changed = False
    for field in (
        "display_name", "age", "city", "job", "academic_background",
        "mother_language", "other_languages", "purpose",
    ):
        value = getattr(payload, field)
        if value is not None:
            if isinstance(value, str):
                value = value.strip() or None
            if getattr(user, field) != value:
                setattr(user, field, value)
                profile_changed = True

    if payload.gender is not None:
        user.gender = payload.gender or None
    if payload.estimated_cefr is not None and payload.estimated_cefr != user.estimated_cefr:
        user.estimated_cefr = payload.estimated_cefr
        profile_changed = True
    if payload.difficulty_offset is not None and payload.difficulty_offset != user.difficulty_offset:
        user.difficulty_offset = payload.difficulty_offset
        user.difficulty_offset_updated_at = utcnow()

    interests_changed = False
    if payload.interests is not None:
        interests_changed = replace_interests(user, payload.interests, db)

    db.commit()
    db.refresh(user)

    if user.onboarding_completed and (profile_changed or interests_changed):
        background_tasks.add_task(_refresh_recommendations, user.user_id)

    return user_out(user, db)


@router.get("/me/dashboard-stats")
def get_dashboard_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    vectors = db.query(UserVocabularyVector).filter(UserVocabularyVector.user_id == user.user_id).all()
    total_learning = sum(1 for v in vectors if v.status == VocabStatus.LEARNING)
    total_mastered = sum(1 for v in vectors if v.status == VocabStatus.MASTERED)
    to_review = sum(
        1 for v in vectors
        if v.status == VocabStatus.LEARNING and (v.next_review_at is None or v.next_review_at <= now)
    )
    reviewed_today = sum(1 for v in vectors if v.last_reviewed_at is not None and v.last_reviewed_at >= today_start)
    total_daily_task = reviewed_today + to_review
    daily_progress = (reviewed_today / total_daily_task * 100) if total_daily_task > 0 else 0

    sessions = db.query(ReadingSession).filter(ReadingSession.user_id == user.user_id).all()
    ended_sessions = [s for s in sessions if s.ended_at is not None]

    def session_minutes(session: ReadingSession) -> float:
        if session.duration_seconds:
            return session.duration_seconds / 60
        return 6.0

    week_start = today_start - datetime.timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)
    time_today = sum(session_minutes(s) for s in ended_sessions if s.created_at >= today_start)
    time_week = sum(session_minutes(s) for s in ended_sessions if s.created_at >= week_start)
    time_month = sum(session_minutes(s) for s in ended_sessions if s.created_at >= month_start)

    recent = sorted(ended_sessions, key=lambda s: s.session_id)[-10:]
    productivity_data = [
        {
            "session_name": f"Reading {s.reading_number}",
            "duration_min": round((s.duration_seconds or 0) / 60, 1),
            "date": s.created_at.isoformat() if s.created_at else None,
        }
        for s in recent
    ]
    avg_duration = (
        sum(d["duration_min"] for d in productivity_data) / len(productivity_data)
        if productivity_data else 0
    )

    return {
        "cefr_level": user.estimated_cefr or "—",
        "effective_cefr": user.effective_cefr if user.estimated_cefr else None,
        "difficulty_offset": user.difficulty_offset or 0,
        "words_known_goal": WORDS_KNOWN_GOAL,
        "acquisition_score": min(100, int(total_mastered / WORDS_KNOWN_GOAL * 100)),
        "total_known": total_mastered,
        "total_learning": total_learning,
        "total_mastered": total_mastered,
        "to_review": to_review,
        "reviewed_today": reviewed_today,
        "daily_progress": daily_progress,
        "readings_completed": len(ended_sessions),
        "readings_total": len(sessions),
        "productivity_data": productivity_data,
        "avg_duration_min": round(avg_duration, 1),
        "time_today_min": round(time_today, 1),
        "time_week_min": round(time_week, 1),
        "time_month_min": round(time_month, 1),
        "is_new": len(sessions) == 0 and total_mastered == 0,
    }
