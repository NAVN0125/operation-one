"""
WebSocket handler for user presence tracking
"""
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, status
from sqlalchemy.orm import Session
from typing import Dict, Set

from app.db.session import get_db
from app.db.models import User, UserPresence, UserConnection
from app.core.security import verify_jwt_token


router = APIRouter()


class PresenceManager:
    """Manages WebSocket connections for presence tracking."""
    
    def __init__(self):
        # Map of user_id -> Set[WebSocket]
        self.active_connections: Dict[int, Set[WebSocket]] = {}
    
    async def connect(self, user_id: int, websocket: WebSocket, db: Session):
        """Connect a user and mark them as online."""
        await websocket.accept()
        
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        
        # Update or create presence record
        presence = db.query(UserPresence).filter(UserPresence.user_id == user_id).first()
        if presence:
            presence.is_online = True
        else:
            presence = UserPresence(user_id=user_id, is_online=True)
            db.add(presence)
        db.commit()
        
        # Notify all connections that this user is now online
        await self.broadcast_presence_update(user_id, True, db)
    
    async def disconnect(self, user_id: int, websocket: WebSocket, db: Session):
        """Disconnect a specific websocket and mark user offline if last one."""
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            
            # If no more connections for this user, mark as offline
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                
                # Update presence record
                presence = db.query(UserPresence).filter(UserPresence.user_id == user_id).first()
                if presence:
                    presence.is_online = False
                    db.commit()
                
                # Notify all connections that this user is now offline
                await self.broadcast_presence_update(user_id, False, db)
    
    async def broadcast_presence_update(self, user_id: int, is_online: bool, db: Session):
        """Notify all of a user's connections about their presence change."""
        # Get all users connected to this user
        connections_initiated = db.query(UserConnection).filter(
            UserConnection.user_id == user_id
        ).all()
        
        connections_received = db.query(UserConnection).filter(
            UserConnection.connected_user_id == user_id
        ).all()
        
        # Collect unique connected user IDs
        connected_user_ids = set()
        for conn in connections_initiated:
            connected_user_ids.add(conn.connected_user_id)
        for conn in connections_received:
            connected_user_ids.add(conn.user_id)
        
        # Send presence update to each connected user who is online
        message = {
            "type": "presence_update",
            "user_id": user_id,
            "is_online": is_online
        }
        
        for connected_user_id in connected_user_ids:
            if connected_user_id in self.active_connections:
                for ws in list(self.active_connections[connected_user_id]):
                    try:
                        await ws.send_json(message)
                    except Exception:
                        # Will be cleaned up on next disconnect
                        pass
    
    async def send_heartbeat(self, websocket: WebSocket):
        """Send a heartbeat ping to keep connection alive."""
        try:
            await websocket.send_json({"type": "heartbeat"})
        except Exception:
            pass

    async def send_personal_message(self, user_id: int, message: dict):
        """Send a message to all of a user's active connections."""
        success = False
        if user_id in self.active_connections:
            for ws in list(self.active_connections[user_id]):
                try:
                    await ws.send_json(message)
                    success = True
                except Exception:
                    pass
        return success


presence_manager = PresenceManager()


@router.websocket("/ws/presence")
async def presence_websocket(
    websocket: WebSocket,
    token: str
):
    """
    WebSocket endpoint for presence tracking.
    
    Query params:
        token: JWT authentication token
    """
    from app.db.session import SessionLocal
    
    # Verify JWT
    try:
        user_info = verify_jwt_token(token)
        user_id = int(user_info.sub)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    
    # Connect user - create a temporary session for this operation
    db = SessionLocal()
    try:
        await presence_manager.connect(user_id, websocket, db)
    finally:
        db.close()
    
    try:
        while True:
            # Wait for messages (mainly for heartbeat responses or manual disconnect)
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "heartbeat_response":
                # Client acknowledged heartbeat
                pass
            elif message.get("type") == "disconnect":
                # Client requesting disconnect
                break
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Presence WebSocket error for user {user_id}: {e}")
    finally:
        # Disconnect and mark offline - create another temp session
        db = SessionLocal()
        try:
            await presence_manager.disconnect(user_id, websocket, db)
        finally:
            db.close()
