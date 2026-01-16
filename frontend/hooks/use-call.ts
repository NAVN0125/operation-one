"use client";

import { useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";

interface CallState {
    callId: number | null;
    roomName: string | null;
    status: "idle" | "initiating" | "connected" | "answered" | "ended";
}

interface UseCallReturn {
    callState: CallState;
    transcript: string;
    initiateCall: (targetUserId: number, roomName?: string) => Promise<void>;
    acceptIncomingCall: (callId: number, roomName: string) => Promise<void>;
    answerCall: () => Promise<void>;
    endCall: () => Promise<void>;
    sendAudio: (base64Audio: string) => void;
    isLoading: boolean;
    error: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API_URL.replace("http", "ws");

export function useCall(): UseCallReturn {
    const { data: session } = useSession();
    const [callState, setCallState] = useState<CallState>({
        callId: null,
        roomName: null,
        status: "idle",
    });
    const [transcript, setTranscript] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);

    const getBackendToken = useCallback(async (): Promise<string | null> => {
        if (!session?.idToken) return null;

        const response = await fetch(`${API_URL}/api/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id_token: session.idToken }),
        });

        if (!response.ok) {
            throw new Error("Failed to authenticate with backend");
        }

        const data = await response.json();
        return data.access_token;
    }, [session]);

    const mediaSourceRef = useRef<MediaSource | null>(null);
    const sourceBufferRef = useRef<SourceBuffer | null>(null);
    const audioQueueRef = useRef<ArrayBuffer[]>([]);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Initialize Audio Player
    const initAudioPlayer = useCallback(() => {
        if (audioRef.current) return;

        const mediaSource = new MediaSource();
        mediaSourceRef.current = mediaSource;

        const audio = new Audio();
        audio.src = URL.createObjectURL(mediaSource);
        audioRef.current = audio;

        const handleSourceOpen = () => {
            if (mediaSource.readyState !== "open") return;

            if (MediaSource.isTypeSupported("audio/webm;codecs=opus")) {
                try {
                    // Check if SourceBuffer already exists to avoid duplicate adds
                    if (mediaSource.sourceBuffers.length > 0) return;

                    const sourceBuffer = mediaSource.addSourceBuffer("audio/webm;codecs=opus");
                    sourceBufferRef.current = sourceBuffer;
                    sourceBuffer.mode = "sequence";

                    sourceBuffer.addEventListener("updateend", () => {
                        processAudioQueue();
                    });
                } catch (e) {
                    console.error("Error creating SourceBuffer:", e);
                }
            } else {
                console.error("MIME type audio/webm;codecs=opus not supported");
            }
        };

        mediaSource.addEventListener("sourceopen", handleSourceOpen);

        // Handle play promise to avoid AbortError
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                if (error.name === 'AbortError') {
                    // Build-in safe handling for when pause() is called while playing
                    console.log('Playback aborted (call likely ended)');
                } else {
                    console.error("Autoplay failed:", error);
                }
            });
        }
    }, []);

    const processAudioQueue = useCallback(() => {
        const sourceBuffer = sourceBufferRef.current;
        const mediaSource = mediaSourceRef.current;

        if (
            sourceBuffer &&
            mediaSource &&
            mediaSource.readyState === "open" &&
            !sourceBuffer.updating &&
            audioQueueRef.current.length > 0
        ) {
            try {
                const chunk = audioQueueRef.current.shift()!;
                sourceBuffer.appendBuffer(chunk);
            } catch (e) {
                console.error("Error appending buffer:", e);
            }
        }
    }, []);

    const cleanupAudio = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = ""; // Detach media source
            audioRef.current = null;
        }

        if (sourceBufferRef.current) {
            try {
                if (mediaSourceRef.current && mediaSourceRef.current.readyState === "open") {
                    // Safe removal if needed, though usually just nulling reft is enough if MS is closing
                    // mediaSourceRef.current.removeSourceBuffer(sourceBufferRef.current);
                }
            } catch (e) {
                console.warn("Error verifying source buffer during cleanup", e);
            }
            sourceBufferRef.current = null;
        }

        if (mediaSourceRef.current) {
            // Removing listeners is good practice
            mediaSourceRef.current = null;
        }

        audioQueueRef.current = [];
    }, []);

    const connectToWebSocket = useCallback(async (callId: number, roomName: string | null, backendToken: string) => {
        if (wsRef.current) {
            wsRef.current.close();
        }

        const socket = new WebSocket(`${WS_URL}/ws/call/${callId}?token=${backendToken}`);

        socket.onopen = () => {
            setCallState({
                callId: callId,
                roomName: roomName,
                status: "connected",
            });
            wsRef.current = socket;
            initAudioPlayer();
        };

        socket.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            if (message.type === "transcript") {
                if (message.is_final) {
                    setTranscript((prev) => prev + " " + message.text);
                }
            } else if (message.type === "audio") {
                // Play audio
                try {
                    const audioData = atob(message.data);
                    const arrayBuffer = new ArrayBuffer(audioData.length);
                    const view = new Uint8Array(arrayBuffer);
                    for (let i = 0; i < audioData.length; i++) {
                        view[i] = audioData.charCodeAt(i);
                    }

                    audioQueueRef.current.push(arrayBuffer);
                    processAudioQueue();
                } catch (e) {
                    console.error("Error processing audio data:", e);
                }
            }
        };

        socket.onerror = (err) => {
            console.error("WebSocket error:", err);
            setError("WebSocket connection failed");
        };

        socket.onclose = () => {
            setCallState((prev) => ({ ...prev, status: "ended" }));
            wsRef.current = null;
            cleanupAudio();
        };

        return socket;
    }, [initAudioPlayer, processAudioQueue, cleanupAudio, session]);

    const initiateCall = useCallback(
        async (targetUserId: number, roomName?: string) => {
            setIsLoading(true);
            setError(null);
            setTranscript("");

            try {
                const backendToken = await getBackendToken();
                if (!backendToken) throw new Error("Not authenticated");

                const response = await fetch(`${API_URL}/api/calls/initiate`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${backendToken}`,
                    },
                    body: JSON.stringify({ target_user_id: targetUserId, room_name: roomName }),
                });

                if (!response.ok) throw new Error("Failed to initiate call");

                const data = await response.json();

                await connectToWebSocket(data.call_id, data.room_name, backendToken);

            } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
            } finally {
                setIsLoading(false);
            }
        },
        [getBackendToken, connectToWebSocket]
    );

    const acceptIncomingCall = useCallback(
        async (callId: number, roomName: string) => {
            setIsLoading(true);
            setError(null);
            setTranscript("");

            try {
                const backendToken = await getBackendToken();
                if (!backendToken) throw new Error("Not authenticated");

                const socket = await connectToWebSocket(callId, roomName, backendToken);

                // Automatically answer the call
                if (socket) {
                    // Wait for connection open? connectToWebSocket sets handler. 
                    // But we need to verify if it is open before sending? 
                    // onopen handler in connectToWebSocket will run.
                    // But we want to trigger 'answer' API call too.

                    const response = await fetch(`${API_URL}/api/calls/${callId}/answer`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${backendToken}` },
                    });

                    if (!response.ok) throw new Error("Failed to answer call");

                    // Send start transcription when socket opens
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: "start_transcription" }));
                        setCallState((prev) => ({ ...prev, status: "answered" }));
                    } else {
                        const originalOnOpen = socket.onopen;
                        socket.onopen = (ev) => {
                            if (originalOnOpen) originalOnOpen.call(socket, ev);
                            socket.send(JSON.stringify({ type: "start_transcription" }));
                            setCallState((prev) => ({ ...prev, status: "answered" }));
                        };
                    }
                }

            } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
            } finally {
                setIsLoading(false);
            }
        },
        [getBackendToken, connectToWebSocket]
    );

    const answerCall = useCallback(async () => {
        // ... (existing implementation simplified for brevity but kept same logic)
        if (!callState.callId || !wsRef.current) return;
        setIsLoading(true);
        setError(null);
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) throw new Error("Not authenticated");
            const response = await fetch(`${API_URL}/api/calls/${callState.callId}/answer`, {
                method: "POST",
                headers: { Authorization: `Bearer ${backendToken}` },
            });
            if (!response.ok) throw new Error("Failed to answer call");
            wsRef.current.send(JSON.stringify({ type: "start_transcription" }));
            setCallState((prev) => ({ ...prev, status: "answered" }));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setIsLoading(false);
        }
    }, [callState.callId, getBackendToken]);

    const endCall = useCallback(async () => {
        // ... (existing implementation)
        if (!callState.callId) return;
        setIsLoading(true);
        setError(null);
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) throw new Error("Not authenticated");
            if (wsRef.current) {
                wsRef.current.send(JSON.stringify({ type: "stop_transcription" }));
                wsRef.current.close();
            }
            await fetch(`${API_URL}/api/calls/${callState.callId}/end`, {
                method: "POST",
                headers: { Authorization: `Bearer ${backendToken}` },
            });
            setCallState({ callId: callState.callId, roomName: null, status: "ended" });
            // Cleanup Audio handles in onclose
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setIsLoading(false);
        }
    }, [callState.callId, getBackendToken]);

    const sendAudio = useCallback((base64Audio: string) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "audio", data: base64Audio }));
        }
    }, []);

    return {
        callState,
        transcript,
        initiateCall,
        acceptIncomingCall,
        answerCall,
        endCall,
        sendAudio,
        isLoading,
        error,
    };
}
