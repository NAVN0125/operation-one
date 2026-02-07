"""
Recordings API routes for meeting recordings
"""
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile
import shutil
from pathlib import Path
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime

from app.db.session import get_db
from app.db.models import MeetingRecording, RecordingStatus
from app.core.security import get_current_user, TokenPayload
from app.services.transcription_service import transcription_service
from app.services.local_transcription_service import local_transcription_service
from app.services.analysis_service import analysis_service
from app.core.config import settings


router = APIRouter(prefix="/recordings", tags=["recordings"])


class RecordingResponse(BaseModel):
    id: int
    filename: str
    file_path: Optional[str]
    duration_seconds: Optional[int]
    status: str
    transcript: Optional[str]
    analysis_result: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AnalyzeRequest(BaseModel):
    user_interpretation: str


@router.post("/upload", response_model=RecordingResponse)
async def upload_recording(
    file: UploadFile = File(...),
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a meeting recording file."""
    user_id = int(current_user.sub)
    
    # Ensure uploads directory exists
    upload_dir = Path("uploads/meetings")
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate unique filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"user_{user_id}_{timestamp}_{file.filename}"
    file_path = upload_dir / safe_filename
    
    # Save file
    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save recording: {e}")
    
    # Create database record
    recording = MeetingRecording(
        user_id=user_id,
        filename=file.filename,
        file_path=str(file_path),
        status=RecordingStatus.UPLOADED,
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)
    
    return recording


@router.get("/", response_model=List[RecordingResponse])
async def list_recordings(
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all recordings for the current user."""
    user_id = int(current_user.sub)
    recordings = db.query(MeetingRecording).filter(
        MeetingRecording.user_id == user_id
    ).order_by(MeetingRecording.created_at.desc()).all()
    return recordings


@router.get("/{recording_id}", response_model=RecordingResponse)
async def get_recording(
    recording_id: int,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a specific recording."""
    user_id = int(current_user.sub)
    recording = db.query(MeetingRecording).filter(
        MeetingRecording.id == recording_id,
        MeetingRecording.user_id == user_id,
    ).first()
    
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    return recording


@router.post("/{recording_id}/transcribe", response_model=RecordingResponse)
async def transcribe_recording(
    recording_id: int,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Transcribe a recording using ElevenLabs."""
    user_id = int(current_user.sub)
    recording = db.query(MeetingRecording).filter(
        MeetingRecording.id == recording_id,
        MeetingRecording.user_id == user_id,
    ).first()
    
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    if not recording.file_path:
        raise HTTPException(status_code=400, detail="Recording file not found")
    
    # Update status
    recording.status = RecordingStatus.TRANSCRIBING
    db.commit()
    
    try:
        # Use local or ElevenLabs based on config
        if settings.transcription_provider == "local":
            transcript = await local_transcription_service.transcribe_audio_file(recording.file_path)
        else:
            transcript = await transcription_service.transcribe_audio_file(recording.file_path)
        recording.transcript = transcript
        recording.status = RecordingStatus.TRANSCRIBED
        db.commit()
        db.refresh(recording)
        return recording
    except Exception as e:
        recording.status = RecordingStatus.FAILED
        db.commit()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


@router.post("/{recording_id}/analyze", response_model=RecordingResponse)
async def analyze_recording(
    recording_id: int,
    request: AnalyzeRequest,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Analyze a recording using OpenRouter."""
    user_id = int(current_user.sub)
    recording = db.query(MeetingRecording).filter(
        MeetingRecording.id == recording_id,
        MeetingRecording.user_id == user_id,
    ).first()
    
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    if not recording.transcript:
        raise HTTPException(status_code=400, detail="Recording must be transcribed first")
    
    # Update status
    recording.status = RecordingStatus.ANALYZING
    recording.user_interpretation = request.user_interpretation
    db.commit()
    
    try:
        result = await analysis_service.analyze_call(
            transcript=recording.transcript,
            user_interpretation=request.user_interpretation,
        )
        recording.analysis_result = result
        recording.status = RecordingStatus.COMPLETED
        recording.analyzed_at = datetime.utcnow()
        db.commit()
        db.refresh(recording)
        return recording
    except Exception as e:
        recording.status = RecordingStatus.FAILED
        db.commit()
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@router.delete("/{recording_id}")
async def delete_recording(
    recording_id: int,
    current_user: TokenPayload = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a recording."""
    user_id = int(current_user.sub)
    recording = db.query(MeetingRecording).filter(
        MeetingRecording.id == recording_id,
        MeetingRecording.user_id == user_id,
    ).first()
    
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    # Delete file if exists
    if recording.file_path:
        file_path = Path(recording.file_path)
        if file_path.exists():
            file_path.unlink()
    
    db.delete(recording)
    db.commit()
    
    return {"message": "Recording deleted"}
