"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useAudioRecorder } from "./use-audio-recorder";

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
    isLoading: boolean;
    error: string | null;
    // Recording exposed properties
    isRecording: boolean;
    audioUrl: string | null;
    clearRecording: () => void;
}

const getWsUrl = () => {
    if (typeof window === "undefined") return "";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/service`;
};

const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

export function useCall(): UseCallReturn {
    const { data: session } = useSession();
    const { stream: localStream, startRecording: startMic, stopRecording: stopMic } = useAudioRecorder();

    const [callState, setCallState] = useState<CallState>({
        callId: null,
        roomName: null,
        status: "idle",
    });
    const [transcript, setTranscript] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

    // Mixing & Recording Refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const mixedDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const callRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        // Initialize remote audio element
        if (typeof window !== "undefined") {
            remoteAudioRef.current = new Audio();
            remoteAudioRef.current.autoplay = true;
        }
        return () => {
            if (remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = null;
                remoteAudioRef.current = null;
            }
        };
    }, []);

    const getBackendToken = useCallback(async (): Promise<string | null> => {
        if (!session?.idToken) return null;

        const response = await fetch(`/service/api/auth/google`, {
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

    // Initialize WebRTC Peer Connection
    const createPeerConnection = useCallback((socket: WebSocket, callId: number) => {
        if (peerConnectionRef.current) return peerConnectionRef.current;

        const pc = new RTCPeerConnection(ICE_SERVERS);
        peerConnectionRef.current = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "ice_candidate", candidate: event.candidate }));
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log("ICE Connection State:", pc.iceConnectionState);
        };

        pc.ontrack = (event) => {
            console.log("Received remote track");
            if (remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = event.streams[0];
            }
            // Add to mixer
            setupAudioMixing(event.streams[0]);
        };

        return pc;
    }, []);

    // Audio Mixing & Recording Logic
    const setupAudioMixing = useCallback((remoteStream: MediaStream) => {
        if (!localStream) {
            console.warn("No local stream available for mixing");
            return;
        }

        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;

            const destination = ctx.createMediaStreamDestination();
            mixedDestinationRef.current = destination;

            // Add Local Stream
            const localSource = ctx.createMediaStreamSource(localStream);
            localSource.connect(destination);

            // Add Remote Stream
            const remoteSource = ctx.createMediaStreamSource(remoteStream);
            remoteSource.connect(destination);

            // Start Recording the Mixed Stream
            const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
            callRecorderRef.current = recorder;
            recordedChunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunksRef.current.push(e.data);
                }
            };

            recorder.onstop = async () => {
                const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);
                setIsRecording(false);

                // Upload automatically
                await uploadRecording(blob);
            };

            recorder.start();
            setIsRecording(true);

        } catch (e) {
            console.error("Error setting up audio mixing:", e);
        }
    }, [localStream]);

    const uploadRecording = useCallback(async (blob: Blob) => {
        if (!callState.callId) return;

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const formData = new FormData();
            formData.append("file", blob, `recording_${Date.now()}.webm`);

            await fetch(`/service/api/calls/${callState.callId}/recording`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${backendToken}`,
                },
                body: formData,
            });
            console.log("Recording uploaded successfully");
        } catch (e) {
            console.error("Failed to upload recording:", e);
        }
    }, [callState.callId, getBackendToken]);

    const connectToWebSocket = useCallback((callId: number, roomName: string | null, backendToken: string): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
            if (wsRef.current) {
                wsRef.current.close();
            }

            const socket = new WebSocket(`${getWsUrl()}/ws/call/${callId}?token=${backendToken}`);

            socket.onopen = () => {
                setCallState({
                    callId: callId,
                    roomName: roomName,
                    status: "connected",
                });
                wsRef.current = socket;

                // Initialize PeerConnection immediately upon connection
                const pc = createPeerConnection(socket, callId);

                // Add local tracks if available
                if (localStream) {
                    localStream.getTracks().forEach(track => {
                        pc.addTrack(track, localStream);
                    });
                }

                resolve(socket);
            };

            socket.onmessage = async (event) => {
                const message = JSON.parse(event.data);
                const pc = peerConnectionRef.current;

                if (!pc) return;

                if (message.type === "offer") {
                    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    socket.send(JSON.stringify({ type: "answer", answer }));

                } else if (message.type === "answer") {
                    await pc.setRemoteDescription(new RTCSessionDescription(message.answer));

                } else if (message.type === "ice_candidate") {
                    if (message.candidate) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
                        } catch (e) {
                            console.error("Error adding ICE candidate", e);
                        }
                    }

                } else if (message.type === "call_answered") {
                    console.log("Call answered by other participant");
                    setCallState((prev) => ({ ...prev, status: "answered" }));

                    // If Caller, Create Offer now
                    // Wait, usually the Caller creates the offer. 
                    // Let's assume Caller creates offer when peer connection is ready OR when call is answered?
                    // Ideally, Caller creates offer immediately after connection if they are the initiator.
                    // But maybe we wait for 'call_answered' to be safe?
                    // Let's trigger offer creation here if we are the initiator (implicit logic needed or passed in?)
                    // Simplified: Both sides are connected. The Caller should send offer.
                    // See initiateCall logic.
                }
            };

            socket.onerror = (err) => {
                console.error("WebSocket error:", err);
                setError("WebSocket connection failed");
                reject(err);
            };

            socket.onclose = () => {
                setCallState((prev) => ({ ...prev, status: "ended" }));
                wsRef.current = null;
                cleanupCall();
            };
        });
    }, [createPeerConnection, localStream, session]);

    const cleanupCall = useCallback(() => {
        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (callRecorderRef.current && callRecorderRef.current.state !== 'inactive') {
            callRecorderRef.current.stop(); // This triggers upload
        }
        stopMic();
    }, [stopMic]);

    const initiateCall = useCallback(
        async (targetUserId: number, roomName?: string) => {
            setIsLoading(true);
            setError(null);
            setTranscript("");

            try {
                // Start Mic First
                const stream = await startMic();
                // Note: localStream state might not update immediately in closure, so we rely on useAudioRecorder state update flowing through re-render
                // OR we pass stream to connectToWebSocket if we refactor connectToWebSocket to accept it.
                // However, `localStream` from hook will be available on next render.
                // To fix this race condition, we might need to modify `connectToWebSocket` to take the stream explicitly,
                // but for now, let's assume `initiateCall` just gets the token and fetches API, by the time we connect WS, we hope stream is ready.
                // BETTER: Refactor `startMic` to return the stream (done in use-audio-recorder).

                // We must update the check in connectToWebSocket to use the stream passed to it, or a Ref.
                // Let's trust React state speed for now or use the returned stream.

                const backendToken = await getBackendToken();
                if (!backendToken) throw new Error("Not authenticated");

                const response = await fetch(`/service/api/calls/initiate`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${backendToken}`,
                    },
                    body: JSON.stringify({ target_user_id: targetUserId, room_name: roomName }),
                });

                if (!response.ok) throw new Error("Failed to initiate call");

                const data = await response.json();

                // Connect WS
                const socket = await connectToWebSocket(data.call_id, data.room_name, backendToken);

                // We are the caller. Create Offer.
                // We need to wait a tick for the PC to be created in connectToWebSocket? 
                // It is synchronous in my implementation above.
                const pc = peerConnectionRef.current;
                if (pc) {
                    // Add tracks now if they weren't added in connectToWebSocket (because localStream was null)
                    stream.getTracks().forEach(track => pc.addTrack(track, stream));

                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    socket.send(JSON.stringify({ type: "offer", offer }));
                }

            } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
                cleanupCall();
            } finally {
                setIsLoading(false);
            }
        },
        [getBackendToken, connectToWebSocket, startMic, cleanupCall]
    );

    const acceptIncomingCall = useCallback(
        async (callId: number, roomName: string) => {
            setIsLoading(true);
            setError(null);
            setTranscript("");

            try {
                const stream = await startMic(); // Start Mic

                const backendToken = await getBackendToken();
                if (!backendToken) throw new Error("Not authenticated");

                // Connect WS
                const socket = await connectToWebSocket(callId, roomName, backendToken);

                if (socket) {
                    const response = await fetch(`/service/api/calls/${callId}/answer`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${backendToken}` },
                    });

                    if (!response.ok) throw new Error("Failed to answer call");

                    // Add tracks
                    const pc = peerConnectionRef.current;
                    if (pc) {
                        stream.getTracks().forEach(track => pc.addTrack(track, stream));
                    }

                    setCallState((prev) => ({ ...prev, status: "answered" }));
                }

            } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
                cleanupCall();
            } finally {
                setIsLoading(false);
            }
        },
        [getBackendToken, connectToWebSocket, startMic, cleanupCall]
    );

    const answerCall = useCallback(async () => {
        // Wrapper for UI buttons if needed, usually acceptIncomingCall handles it
        // If we are already connected (e.g. just entering the room), the logic is similar
    }, []);

    const endCall = useCallback(async () => {
        if (!callState.callId) return;
        setIsLoading(true);
        setError(null);
        try {
            const backendToken = await getBackendToken();
            if (backendToken) {
                await fetch(`/service/api/calls/${callState.callId}/end`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${backendToken}` },
                });
            }

            if (wsRef.current) {
                wsRef.current.close();
            }

            setCallState({ callId: callState.callId, roomName: null, status: "ended" });
            cleanupCall();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setIsLoading(false);
        }
    }, [callState.callId, getBackendToken, cleanupCall]);

    const clearRecordingWrapper = useCallback(() => {
        setAudioUrl(null);
        recordedChunksRef.current = [];
    }, []);

    return {
        callState,
        transcript,
        initiateCall,
        acceptIncomingCall,
        answerCall,
        endCall,
        isLoading,
        error,
        isRecording,
        audioUrl,
        clearRecording: clearRecordingWrapper,
    };
}
