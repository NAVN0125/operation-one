"""
Local Transcription Service using faster-whisper
Optimized for CPU execution on Intel Mac with limited RAM.
"""
from typing import Optional
from faster_whisper import WhisperModel


class LocalTranscriptionService:
    """Service for audio transcription using faster-whisper on CPU."""

    def __init__(self, model_size: str = "base", compute_type: str = "int8"):
        """
        Initialize the transcription service.
        
        Args:
            model_size: Whisper model size (tiny, base, small, medium, large).
            compute_type: Quantization type (int8 recommended for CPU).
        """
        self.model_size = model_size
        self.compute_type = compute_type
        self._model: Optional[WhisperModel] = None

    def _get_model(self) -> WhisperModel:
        """Lazy-load the model to avoid startup overhead."""
        if self._model is None:
            self._model = WhisperModel(
                self.model_size,
                device="cpu",
                compute_type=self.compute_type,
            )
        return self._model

    async def transcribe_audio_file(self, audio_path: str) -> Optional[str]:
        """
        Transcribe an audio file using faster-whisper.
        
        Args:
            audio_path: Path to the audio file.
        
        Returns:
            Transcription text.
        """
        model = self._get_model()
        
        segments, info = model.transcribe(
            audio_path,
            beam_size=5,
            language="en",
            vad_filter=True,  # Voice Activity Detection for cleaner segments
        )
        
        # Combine all segments into full transcript
        transcript = " ".join([segment.text.strip() for segment in segments])
        return transcript

    async def transcribe_audio_bytes(
        self, audio_bytes: bytes, filename: str = "audio.webm"
    ) -> Optional[str]:
        """
        Transcribe audio from bytes using faster-whisper.
        
        Args:
            audio_bytes: Audio data as bytes.
            filename: Name hint for the audio format.
        
        Returns:
            Transcription text.
        """
        import io
        import tempfile
        import os
        
        # faster-whisper requires a file path, so write bytes to temp file
        suffix = os.path.splitext(filename)[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        try:
            return await self.transcribe_audio_file(tmp_path)
        finally:
            os.unlink(tmp_path)


# Singleton instance
local_transcription_service = LocalTranscriptionService()
