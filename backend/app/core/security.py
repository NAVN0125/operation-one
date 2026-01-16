"""
JWT and Security utilities
"""
from datetime import datetime, timedelta
from typing import Optional, Union
from jose import jwt, JWTError
from pydantic import BaseModel
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx

from app.core.config import settings


security = HTTPBearer()


class TokenPayload(BaseModel):
    sub: str
    email: str
    name: Optional[str] = None
    exp: datetime


class GoogleUser(BaseModel):
    """Google user info from token verification."""
    sub: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None


def create_access_token(
    subject: str,
    email: str,
    name: Optional[str] = None,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create a new JWT access token."""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.jwt_expiration_minutes
        )

    to_encode = {"sub": subject, "email": email, "name": name, "exp": expire}
    encoded_jwt = jwt.encode(
        to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )
    return encoded_jwt


def verify_jwt_token(token: str) -> TokenPayload:
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        return TokenPayload(**payload)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
        )


async def verify_google_token(id_token: str) -> GoogleUser:
    """Verify a Google ID token and return user info."""
    try:
        async with httpx.AsyncClient() as client:
            print(f"Verifying Google token (length: {len(id_token if id_token else '')})")
            response = await client.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
            )
            if response.status_code != 200:
                print(f"Google token verification failed: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Invalid Google token: {response.text}",
                )
            data = response.json()
            return GoogleUser(
                sub=data["sub"],
                email=data["email"],
                name=data.get("name"),
                picture=data.get("picture"),
            )
    except Exception as e:
        if not isinstance(e, HTTPException):
            print(f"Error during Google token verification: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Failed to verify Google token: {str(e)}",
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> TokenPayload:
    """Dependency to get the current authenticated user from JWT."""
    return verify_jwt_token(credentials.credentials)
