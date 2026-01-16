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
    
    transcriber = None
    transcript_buffer = []

    def on_transcript(text: str, is_final: bool):
        if is_final:
            transcript_buffer.append(text)
        
        # Broadcast transcript update to ALL participants
        import asyncio
        asyncio.run_coroutine_threadsafe(
            manager.broadcast(call_id, {"type": "transcript", "text": text, "is_final": is_final}),
            asyncio.get_event_loop()
        )

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "start_transcription":
                if not transcriber:
                    transcriber = transcription_service.create_realtime_transcriber(
                        on_transcript=on_transcript
                    )
                    transcriber.connect()
                await manager.send_json({"type": "status", "message": "Transcription started"}, websocket)
            
            elif message["type"] == "audio":
                # 1. Relay audio
                print(f"Received audio data from user {user_id} for call {call_id}: {len(message['data'])} bytes")
                await manager.broadcast(call_id, message, exclude_socket=websocket)
                
                # 2. Process for transcription
                if transcriber:
                    # Expecting base64 encoded audio chunk
                    audio_data = base64.b64decode(message["data"])
                    transcriber.stream(audio_data)
            
            elif message["type"] == "stop_transcription":
                if transcriber:
                    transcriber.close()
                    transcriber = None
                
                # Save final transcript
                final_transcript = " ".join(transcript_buffer)
                db = SessionLocal()
                try:
                    existing_transcript = db.query(Transcript).filter(Transcript.call_id == call_id).first()
                    if existing_transcript:
                        existing_transcript.content = final_transcript
                    else:
                        db.add(Transcript(call_id=call_id, content=final_transcript))
                    db.commit()
                finally:
                    db.close()
                
                await manager.send_json({"type": "status", "message": "Transcription stopped and saved"}, websocket)

    except WebSocketDisconnect:
        manager.disconnect(call_id, websocket)
        if transcriber:
            transcriber.close()
            # Save final transcript on disconnect
            if transcript_buffer:
                final_transcript = " ".join(transcript_buffer)
                db = SessionLocal()
                try:
                    existing_transcript = db.query(Transcript).filter(Transcript.call_id == call_id).first()
                    if existing_transcript:
                        existing_transcript.content = final_transcript
                    else:
                        db.add(Transcript(call_id=call_id, content=final_transcript))
                    db.commit()
                finally:
                    db.close()
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(call_id, websocket)
        if transcriber:
            transcriber.close()
