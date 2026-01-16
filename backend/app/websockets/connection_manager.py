from typing import List, Dict
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, call_id: int, websocket: WebSocket):
        await websocket.accept()
        if call_id not in self.active_connections:
            self.active_connections[call_id] = []
        self.active_connections[call_id].append(websocket)

    def disconnect(self, call_id: int, websocket: WebSocket):
        if call_id in self.active_connections:
            if websocket in self.active_connections[call_id]:
                self.active_connections[call_id].remove(websocket)
            if not self.active_connections[call_id]:
                del self.active_connections[call_id]

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def send_json(self, data: dict, websocket: WebSocket):
        await websocket.send_json(data)

    async def broadcast(self, call_id: int, message: dict, exclude_socket: WebSocket = None):
        if call_id in self.active_connections:
            for connection in self.active_connections[call_id]:
                if connection != exclude_socket:
                    try:
                        await connection.send_json(message)
                    except Exception:
                        pass


manager = ConnectionManager()
