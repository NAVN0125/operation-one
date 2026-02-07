"""
Core configuration module
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # App
    app_name: str = "Operation One"
    debug: bool = False
    
    # Database
    database_url: str = "mysql+pymysql://root:password@localhost:3306/call_analysis"
    
    # JWT
    jwt_secret_key: str = "your-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 60
    
    # Google OAuth
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    
    # ElevenLabs
    elevenlabs_api_key: Optional[str] = None
    
    # Transcription provider: "local" or "elevenlabs"
    transcription_provider: str = "local"
    
    # OpenRouter
    openrouter_api_key: Optional[str] = None

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
