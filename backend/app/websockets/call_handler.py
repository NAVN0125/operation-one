import json
import base64
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models import Call, CallStatus, Transcript
from app.core.security import verify_jwt_token
from app.websockets.connection_manager import manager
from app.services.transcription_service import transcription_service

router = APIRouter()

@router.websocket("/ws/call/{call_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    call_id: int,
    token: str
):
    from app.db.session import SessionLocal
    
    # Verify JWT from query param
    try:
        user_info = verify_jwt_token(token)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Check if call exists and belongs to user
    user_id = int(user_info.sub)
    db = SessionLocal()
    try:
        call = db.query(Call).filter(Call.id == call_id).first()
        if not call:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
            
        # Verify participation
        is_participant = (
            call.user_id == user_id or 
            call.caller_id == user_id or 
            call.callee_id == user_id
        )
        
        if not is_participant:
            from app.db.models import CallParticipant
            is_participant = db.query(CallParticipant).filter(
                CallParticipant.call_id == call_id,
                CallParticipant.user_id == user_id
            ).first() is not None
            
        if not is_participant:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    finally:
        db.close()

    await manager.connect(call_id, websocket)

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # WebRTC Signaling Messages
            if message["type"] in ["offer", "answer", "ice_candidate"]:
                # Relay signaling messages to other participants
                # We exclude the sender so they don't receive their own signals
                await manager.broadcast(call_id, message, exclude_socket=websocket)
                
            elif message["type"] == "stop_transcription":
                # Kept for compatibility if client sends it, but logic removed
                pass

    except WebSocketDisconnect:
        manager.disconnect(call_id, websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(call_id, websocket)
