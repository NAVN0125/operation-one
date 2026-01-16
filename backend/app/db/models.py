"""
Database models for call analysis
"""
from sqlalchemy import Column, Integer, String, DateTime, Text, Enum, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
import secrets
import string
from datetime import datetime, timedelta

from app.db.session import Base


class CallStatus(str, enum.Enum):
    INITIATED = "initiated"
    PICKED_UP = "picked_up"
    ENDED = "ended"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=True)
    display_name = Column(String(255), nullable=True)
    google_id = Column(String(255), unique=True, nullable=True)
    connection_code = Column(String(8), unique=True, index=True, nullable=True)
    connection_code_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    calls = relationship("Call", foreign_keys="[Call.user_id]", back_populates="user")
    initiated_calls = relationship("Call", foreign_keys="[Call.caller_id]", back_populates="caller")
    received_calls = relationship("Call", foreign_keys="[Call.callee_id]", back_populates="callee")
    
    # Connections where this user is the initiator
    connections_initiated = relationship(
        "UserConnection",
        foreign_keys="[UserConnection.user_id]",
        back_populates="user"
    )
    # Connections where this user is the target
    connections_received = relationship(
        "UserConnection",
        foreign_keys="[UserConnection.connected_user_id]",
        back_populates="connected_user"
    )
    
    presence = relationship("UserPresence", back_populates="user", uselist=False)

    def generate_connection_code(self):
        """Generate a new 8-character connection code valid for 5 minutes."""
        self.connection_code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        self.connection_code_expires_at = datetime.utcnow() + timedelta(minutes=5)
    
    def is_connection_code_valid(self) -> bool:
        """Check if the current connection code is still valid."""
        if not self.connection_code or not self.connection_code_expires_at:
            return False
        return datetime.utcnow() < self.connection_code_expires_at


class Call(Base):
    __tablename__ = "calls"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Kept for backward compatibility
    caller_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    callee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    room_id = Column(String(255), index=True, nullable=True)
    status = Column(Enum(CallStatus), default=CallStatus.INITIATED)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    recording_url = Column(String(512), nullable=True)

    user = relationship("User", foreign_keys=[user_id], back_populates="calls")
    caller = relationship("User", foreign_keys=[caller_id], back_populates="initiated_calls")
    callee = relationship("User", foreign_keys=[callee_id], back_populates="received_calls")
    transcript = relationship("Transcript", back_populates="call", uselist=False)
    analysis = relationship("Analysis", back_populates="call", uselist=False)


class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(Integer, ForeignKey("calls.id"), unique=True, nullable=False)
    content = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    call = relationship("Call", back_populates="transcript")


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(Integer, ForeignKey("calls.id"), unique=True, nullable=False)
    user_interpretation = Column(Text, nullable=True)
    result = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    call = relationship("Call", back_populates="analysis")


class UserConnection(Base):
    """Represents a bidirectional connection between two users."""
    __tablename__ = "user_connections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    connected_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id], back_populates="connections_initiated")
    connected_user = relationship("User", foreign_keys=[connected_user_id], back_populates="connections_received")


class UserPresence(Base):
    """Tracks user online/offline status."""
    __tablename__ = "user_presence"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    is_online = Column(Boolean, default=False)
    last_seen = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="presence")


class CallParticipant(Base):
    """Tracks all participants in a call (for group calls)."""
    __tablename__ = "call_participants"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(Integer, ForeignKey("calls.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String(50), default="participant")  # host, participant
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    call = relationship("Call", back_populates="participants")
    user = relationship("User", back_populates="participated_calls")


# Add back_populates to User and Call
User.participated_calls = relationship("CallParticipant", back_populates="user")
Call.participants = relationship("CallParticipant", back_populates="call", cascade="all, delete-orphan")
