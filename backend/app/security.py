import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash, generate_password_hash

from app.config import ACCESS_TOKEN_EXPIRE_MINUTES, AUTH_SECRET_KEY
from app.database import get_db
from app.models import User

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
_DEV_SECRET = "dev-secret-change-me"

if not AUTH_SECRET_KEY:
    logger.warning("AUTH_SECRET_KEY is not set; using an insecure development secret.")
_SECRET = AUTH_SECRET_KEY or _DEV_SECRET

bearer_scheme = HTTPBearer(auto_error=False)


def new_user_id() -> str:
    return uuid.uuid4().hex


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    return check_password_hash(password_hash, password)


def create_access_token(user_id: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": user_id, "exp": expires_at}, _SECRET, algorithm=ALGORITHM)


def _credentials_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Please log in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _credentials_error()
    try:
        payload = jwt.decode(credentials.credentials, _SECRET, algorithms=[ALGORITHM])
    except JWTError:
        raise _credentials_error()

    user_id = payload.get("sub")
    if not user_id:
        raise _credentials_error()

    user = db.query(User).filter(User.user_id == user_id).first()
    if user is None:
        raise _credentials_error()
    return user
