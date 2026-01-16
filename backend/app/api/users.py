"""
User API routes for profile and connection management
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime

from app.db.session import get_db
from app.db.models import User, UserConnection, UserPresence
from app.core.security import get_current_user, TokenPayload


router = APIRouter(prefix="/users", tags=["users"])


class UserProfileResponse(BaseModel):
    id: int
    email: str
    name: Optional[str] = None
    display_name: Optional[str] = None
    connection_code: Optional[str] = None
    connection_code_expires_at: Optional[str] = None
    
    class Config:
        from_attributes = True


class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = None


class UserSearchResult(BaseModel):
    id: int
    name: Optional[str] = None
    display_name: Optional[str] = None
    email: str  # Only shown in search results


class AddConnectionRequest(BaseModel):
    connection_code: str


class ConnectionResponse(BaseModel):
    id: int
    user_id: int
    connected_user_id: int
    connected_user_name: Optional[str] = None
    connected_user_display_name: Optional[str] = None
    is_online: bool = False
    created_at: str
    
    class Config:
        from_attributes = True


@router.get("/me/profile", response_model=UserProfileResponse)
async def get_my_profile(
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get current user's profile with connection code.
    Auto-refreshes connection code if expired.
    """
    user = db.query(User).filter(User.id == int(current_user.sub)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    # Auto-refresh connection code if expired or doesn't exist
    if not user.is_connection_code_valid():
        user.generate_connection_code()
        db.commit()
        db.refresh(user)
    
    expires_at = user.connection_code_expires_at.isoformat() if user.connection_code_expires_at else None
    if expires_at and "+" not in expires_at and "Z" not in expires_at:
        expires_at += "Z"

    return UserProfileResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        display_name=user.display_name,
        connection_code=user.connection_code,
        connection_code_expires_at=expires_at,
    )


@router.post("/me/refresh-code", response_model=UserProfileResponse)
async def refresh_connection_code(
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually force refresh of the 5-minute connection code."""
    user = db.query(User).filter(User.id == int(current_user.sub)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    user.generate_connection_code()
    db.commit()
    db.refresh(user)
    
    expires_at = user.connection_code_expires_at.isoformat() if user.connection_code_expires_at else None
    if expires_at and "+" not in expires_at and "Z" not in expires_at:
        expires_at += "Z"

    return UserProfileResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        display_name=user.display_name,
        connection_code=user.connection_code,
        connection_code_expires_at=expires_at,
    )


@router.put("/me/profile", response_model=UserProfileResponse)
async def update_my_profile(
    request: UpdateProfileRequest,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update current user's display name."""
    user = db.query(User).filter(User.id == int(current_user.sub)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    if request.display_name is not None:
        user.display_name = request.display_name
    
    db.commit()
    db.refresh(user)
    
    expires_at = user.connection_code_expires_at.isoformat() if user.connection_code_expires_at else None
    if expires_at and "+" not in expires_at and "Z" not in expires_at:
        expires_at += "Z"

    return UserProfileResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        display_name=user.display_name,
        connection_code=user.connection_code,
        connection_code_expires_at=expires_at,
    )


@router.get("/search", response_model=UserSearchResult)
async def search_user_by_code(
    code: str,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Search for a user by their active connection code.
    Returns 404 if code is expired or doesn't exist.
    """
    user = db.query(User).filter(User.connection_code == code.upper()).first()
    
    if not user or not user.is_connection_code_valid():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid or expired connection code",
        )
    
    # Don't allow users to search for themselves
    if user.id == int(current_user.sub):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add yourself as a connection",
        )
    
    return UserSearchResult(
        id=user.id,
        name=user.name,
        display_name=user.display_name,
        email=user.email,
    )


@router.get("/me/connections", response_model=List[ConnectionResponse])
async def get_my_connections(
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all connections for the current user with online status."""
    user_id = int(current_user.sub)
    
    # Get connections where current user is either the initiator or the target
    connections_initiated = db.query(UserConnection).filter(
        UserConnection.user_id == user_id
    ).all()
    
    connections_received = db.query(UserConnection).filter(
        UserConnection.connected_user_id == user_id
    ).all()
    
    # Combine and deduplicate
    all_connections = []
    seen_user_ids = set()
    
    for conn in connections_initiated:
        if conn.connected_user_id not in seen_user_ids:
            connected_user = db.query(User).filter(User.id == conn.connected_user_id).first()
            presence = db.query(UserPresence).filter(UserPresence.user_id == conn.connected_user_id).first()
            
            all_connections.append(ConnectionResponse(
                id=conn.id,
                user_id=user_id,
                connected_user_id=conn.connected_user_id,
                connected_user_name=connected_user.name if connected_user else None,
                connected_user_display_name=connected_user.display_name if connected_user else None,
                is_online=presence.is_online if presence else False,
                created_at=conn.created_at.isoformat(),
            ))
            seen_user_ids.add(conn.connected_user_id)
    
    for conn in connections_received:
        if conn.user_id not in seen_user_ids:
            connected_user = db.query(User).filter(User.id == conn.user_id).first()
            presence = db.query(UserPresence).filter(UserPresence.user_id == conn.user_id).first()
            
            all_connections.append(ConnectionResponse(
                id=conn.id,
                user_id=user_id,
                connected_user_id=conn.user_id,
                connected_user_name=connected_user.name if connected_user else None,
                connected_user_display_name=connected_user.display_name if connected_user else None,
                is_online=presence.is_online if presence else False,
                created_at=conn.created_at.isoformat(),
            ))
            seen_user_ids.add(conn.user_id)
    
    return all_connections


@router.post("/me/connections", response_model=ConnectionResponse)
async def add_connection(
    request: AddConnectionRequest,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a new connection using their connection code."""
    user_id = int(current_user.sub)
    
    # Find user by connection code
    target_user = db.query(User).filter(
        User.connection_code == request.connection_code.upper()
    ).first()
    
    if not target_user or not target_user.is_connection_code_valid():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid or expired connection code",
        )
    
    if target_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add yourself as a connection",
        )
    
    # Check if connection already exists (bidirectional check)
    existing_connection = db.query(UserConnection).filter(
        ((UserConnection.user_id == user_id) & (UserConnection.connected_user_id == target_user.id)) |
        ((UserConnection.user_id == target_user.id) & (UserConnection.connected_user_id == user_id))
    ).first()
    
    if existing_connection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection already exists",
        )
    
    # Create bidirectional connection
    connection = UserConnection(
        user_id=user_id,
        connected_user_id=target_user.id,
    )
    db.add(connection)
    db.commit()
    db.refresh(connection)
    
    # Get presence info
    presence = db.query(UserPresence).filter(UserPresence.user_id == target_user.id).first()
    
    return ConnectionResponse(
        id=connection.id,
        user_id=user_id,
        connected_user_id=target_user.id,
        connected_user_name=target_user.name,
        connected_user_display_name=target_user.display_name,
        is_online=presence.is_online if presence else False,
        created_at=connection.created_at.isoformat(),
    )


@router.delete("/me/connections/{connected_user_id}")
async def remove_connection(
    connected_user_id: int,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a connection."""
    user_id = int(current_user.sub)
    
    # Find and delete the connection (bidirectional)
    connection = db.query(UserConnection).filter(
        ((UserConnection.user_id == user_id) & (UserConnection.connected_user_id == connected_user_id)) |
        ((UserConnection.user_id == connected_user_id) & (UserConnection.connected_user_id == user_id))
    ).first()
    
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connection not found",
        )
    
    db.delete(connection)
    db.commit()
    
    return {"message": "Connection removed successfully"}
