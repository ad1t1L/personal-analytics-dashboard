from collections.abc import Generator
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose.exceptions import JWTError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models import User
from backend.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_db() -> Generator[Session, Any, None]:  # pragma: no cover
    db: Session = SessionLocal()                 # pragma: no cover
    try:                                         # pragma: no cover
        yield db                                 # pragma: no cover
    finally:                                     # pragma: no cover
        db.close()                               # pragma: no cover


def get_current_user(
    token: str     = Depends(oauth2_scheme),
    db:    Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload: dict[str, Any] = decode_access_token(token)
        user_id_raw: Any = payload.get("sub")
        if user_id_raw is None:
            raise credentials_exception
        user_id: int = int(user_id_raw)
    except (JWTError, ValueError):
        raise credentials_exception

    user: User | None = db.query(User).filter(User.id == user_id).first()

    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Account is disabled")
    if not user.is_verified:
        raise HTTPException(status_code=403, detail="Please verify your email address first")

    return user