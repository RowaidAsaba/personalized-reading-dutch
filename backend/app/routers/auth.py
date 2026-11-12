import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import GOOGLE_CLIENT_ID
from app.database import get_db
from app.models import User
from app.routers.users import user_out
from app.schemas import AuthResponse, GoogleAuthRequest, LoginRequest, RegisterRequest, UserOut
from app.security import (
    create_access_token,
    get_current_user,
    hash_password,
    new_user_id,
    verify_password,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Auth"])


def _auth_response(user: User, db: Session) -> AuthResponse:
    return AuthResponse(access_token=create_access_token(user.user_id), user=user_out(user, db))


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User.user_id).filter(User.email == req.email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    user = User(
        user_id=new_user_id(),
        email=req.email,
        password_hash=hash_password(req.password),
        display_name=(req.display_name or "").strip() or None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _auth_response(user, db)


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.password_hash):
        if user and not user.password_hash and user.google_sub:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="This account uses Google sign-in. Please continue with Google.",
            )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    return _auth_response(user, db)


def _verify_google_credential(credential: str) -> dict:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on this server.")
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        info = id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID)
    except ValueError as exc:
        logger.info("Rejected Google credential: %s", exc)
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified.")
    if not info.get("sub") or not info.get("email"):
        raise HTTPException(status_code=401, detail="Google account has no usable email.")
    if not info.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Your Google email address is not verified.")
    return info


@router.post("/google", response_model=AuthResponse)
def google_sign_in(req: GoogleAuthRequest, db: Session = Depends(get_db)):
    info = _verify_google_credential(req.credential)
    sub = str(info["sub"])
    email = str(info["email"]).strip().lower()

    user = db.query(User).filter(User.google_sub == sub).first()
    created = False
    if not user:
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.google_sub = sub          # link Google to an existing email account
        else:
            user = User(
                user_id=new_user_id(),
                email=email,
                google_sub=sub,
                display_name=(info.get("name") or info.get("given_name") or "").strip() or None,
            )
            db.add(user)
            created = True
    elif not user.display_name and info.get("name"):
        user.display_name = str(info["name"]).strip()

    db.commit()
    db.refresh(user)
    logger.info("Google sign-in for %s (%s)", user.user_id, "new" if created else "existing")
    return _auth_response(user, db)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_out(user, db)
