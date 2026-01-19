"""
Operation One - FastAPI Backend
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.calls import router as calls_router
from app.api.analysis import router as analysis_router
from app.api.users import router as users_router
from app.websockets.call_handler import router as ws_router
from app.websockets.presence_handler import router as presence_router

app = FastAPI(
    title="Operation One API",
    description="Backend for VoIP, Transcription, and Call Analysis",
    version="0.1.0",
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://operation1.n4vn.space"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(calls_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")
app.include_router(ws_router)
app.include_router(presence_router)


@app.get("/")
async def root():
    return {"message": "Operation One API is running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
