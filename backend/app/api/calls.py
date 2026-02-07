"""
Call API routes
"""
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile
import shutil
from pathlib import Path
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
import uuid

from app.db.session import get_db
from app.db.session import get_db
from app.db.models import Call, CallStatus, UserConnection, CallParticipant, User
from app.core.security import get_current_user, TokenPayload
from app.websockets.presence_handler import presence_manager
from app.websockets.connection_manager import manager


router = APIRouter(prefix="/calls", tags=["calls"])


class InitiateCallRequest(BaseModel):
    target_user_id: int  # Required: ID of the user to call
    room_name: Optional[str] = None


class CallInitiateResponse(BaseModel):
    room_name: str
    call_id: int


class CallResponse(BaseModel):
    id: int
    room_id: Optional[str]
    status: str
    started_at: Optional[str]
    ended_at: Optional[str]

    class Config:
        from_attributes = True


@router.post("/initiate", response_model=CallInitiateResponse)
async def initiate_call(
    request: InitiateCallRequest,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Initiate a new call to a connected user.
    
    Requires target_user_id and verifies connection exists.
    Returns a call_id to be used with WebSocket connections.
    """
    caller_id = int(current_user.sub)
    callee_id = request.target_user_id
    
    # Verify users are connected (bidirectional check)
    connection = db.query(UserConnection).filter(
        ((UserConnection.user_id == caller_id) & (UserConnection.connected_user_id == callee_id)) |
        ((UserConnection.user_id == callee_id) & (UserConnection.connected_user_id == caller_id))
    ).first()
    
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only call users in your connections",
        )
    
    # Generate room name if not provided
    room_name = request.room_name or f"call-{uuid.uuid4().hex[:8]}"

    # Create call record
    new_call = Call(
        user_id=caller_id,
        caller_id=caller_id,
        callee_id=callee_id,
        room_id=room_name,
        status=CallStatus.INITIATED
    )
    db.add(new_call)
    db.commit()
    db.refresh(new_call)
    
    # Add participants
    caller_participant = CallParticipant(
        call_id=new_call.id,
        user_id=caller_id,
        role="host"
    )
    callee_participant = CallParticipant(
        call_id=new_call.id,
        user_id=callee_id,
        role="participant"
    )
    db.add(caller_participant)
    db.add(callee_participant)
    db.commit()

    # Notify callee via Presence WebSocket
    await presence_manager.send_personal_message(
        callee_id,
        {
            "type": "incoming_call",
            "call_id": new_call.id,
            "caller_id": caller_id,
            "caller_name": current_user.name,
            "caller_display_name": current_user.name,
            "room_name": room_name
        }
    )

    return CallInitiateResponse(
        room_name=room_name,
        call_id=new_call.id,
    )


class InviteRequest(BaseModel):
    user_id: int


@router.post("/{call_id}/invite")
async def invite_to_call(
    call_id: int,
    request: InviteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Invite a user to an existing call.
    """
    # Verify call exists and user is a participant
    call = db.query(Call).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
        
    # Check if current user is part of the call (host or participant)
    # We can check the participants table
    current_user_id = int(current_user.sub)
    is_participant = db.query(CallParticipant).filter(
        CallParticipant.call_id == call_id,
        CallParticipant.user_id == current_user_id
    ).first()
    
    if not is_participant:
        raise HTTPException(status_code=403, detail="Not authorized to invite to this call")
        
    # Verify target user exists and is a connection
    target_user = db.query(User).filter(User.id == request.user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")
        
    connection = db.query(UserConnection).filter(
        (UserConnection.user_id == current_user_id) & (UserConnection.connected_user_id == request.user_id)
    ).first()
    
    if not connection:
        raise HTTPException(status_code=400, detail="User is not in your connections")
        
    # Check if already in call
    existing_participant = db.query(CallParticipant).filter(
        CallParticipant.call_id == call_id,
        CallParticipant.user_id == request.user_id
    ).first()
    
    if existing_participant:
        return {"message": "User is already in the call"}
        
    # Add to participants
    new_participant = CallParticipant(
        call_id=call_id,
        user_id=request.user_id,
        role="participant"
    )
    db.add(new_participant)
    db.commit()
    
    # Notify invited user
    await presence_manager.send_personal_message(
        request.user_id,
        {
            "type": "incoming_call",
            "call_id": call_id,
            "caller_id": current_user_id,
            "caller_name": current_user.name, 
            "caller_display_name": current_user.name, 
            "room_name": call.room_id
        }
    )
    
    return {"message": "Invitation sent", "call_id": call.id}


@router.post("/{call_id}/answer")
async def answer_call(
    call_id: int,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Mark a call as answered/picked up.
    
    This triggers the start of transcription.
    """
    call = db.query(Call).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call not found",
        )

    call.status = CallStatus.PICKED_UP
    db.commit()

    # Notify participants via WebSocket that the call is answered
    await manager.broadcast(call_id, {"type": "call_answered", "call_id": call_id})

    return {"message": "Call answered", "status": CallStatus.PICKED_UP.value}


@router.post("/{call_id}/end")
async def end_call(
    call_id: int,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """End a call."""
    from datetime import datetime

    call = db.query(Call).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call not found",
        )

    call.status = CallStatus.ENDED
    call.ended_at = datetime.utcnow()

    if call.started_at:
        duration = (call.ended_at - call.started_at).total_seconds()
        call.duration_seconds = int(duration)

    db.commit()

    return {"message": "Call ended", "duration_seconds": call.duration_seconds}


@router.get("/{call_id}", response_model=CallResponse)
async def get_call(
    call_id: int,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get call details."""
    call = db.query(Call).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call not found",
        )

    return CallResponse(
        id=call.id,
        room_id=call.room_id,
        status=call.status.value,
        started_at=call.started_at.isoformat() if call.started_at else None,
        ended_at=call.ended_at.isoformat() if call.ended_at else None,
    )


@router.post("/{call_id}/recording")
async def upload_recording(
    call_id: int,
    file: UploadFile = File(...),
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a recording for a completed call."""
    call = db.query(Call).filter(Call.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
        
    # Ensure uploads directory exists
    upload_dir = Path("uploads")
    upload_dir.mkdir(exist_ok=True)
    
    # Save file
    file_path = upload_dir / f"call_{call_id}_{file.filename}"
    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save recording: {e}")
        
    # Update call record
    # Note: In production, upload to S3/Cloud Storage and save URL
    call.recording_url = str(file_path)
    db.commit()
    
    return {"message": "Recording uploaded successfully", "url": str(file_path)}
