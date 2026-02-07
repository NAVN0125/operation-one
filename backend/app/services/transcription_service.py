"""
ElevenLabs Transcription Service
"""
from typing import Optional
from elevenlabs import ElevenLabs
from app.core.config import settings


class TranscriptionService:
    """Service for audio transcription using ElevenLabs Speech-to-Text."""

    def __init__(self):
        self.client = None
        if settings.elevenlabs_api_key:
            self.client = ElevenLabs(api_key=settings.elevenlabs_api_key)

    async def transcribe_audio_file(self, audio_path: str) -> Optional[str]:
        """
        Transcribe an audio file using ElevenLabs Speech-to-Text.
        
        Args:
            audio_path: Path to the audio file.
        
        Returns:
            Transcription text.
        """
        if not settings.elevenlabs_api_key:
            raise ValueError("ElevenLabs API key not configured")

        if not self.client:
            self.client = ElevenLabs(api_key=settings.elevenlabs_api_key)

        # Open and transcribe the audio file
        with open(audio_path, "rb") as audio_file:
            result = self.client.speech_to_text.convert(
                file=audio_file,
                model_id="scribe_v1",  # ElevenLabs default STT model
                language_code="en",  # Default to English
            )

        return result.text if hasattr(result, 'text') else str(result)

    async def transcribe_audio_bytes(self, audio_bytes: bytes, filename: str = "audio.webm") -> Optional[str]:
        """
        Transcribe audio from bytes using ElevenLabs Speech-to-Text.
        
        Args:
            audio_bytes: Audio data as bytes.
            filename: Name hint for the audio format.
        
        Returns:
            Transcription text.
        """
        if not settings.elevenlabs_api_key:
            raise ValueError("ElevenLabs API key not configured")

        if not self.client:
            self.client = ElevenLabs(api_key=settings.elevenlabs_api_key)

        # ElevenLabs can accept file-like objects
        import io
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = filename

        result = self.client.speech_to_text.convert(
            file=audio_file,
            model_id="scribe_v1",
            language_code="en",
        )

        return result.text if hasattr(result, 'text') else str(result)


transcription_service = TranscriptionService()
