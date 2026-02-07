"use client";

import { useState, useCallback, useRef } from "react";

interface UseAudioRecorderReturn {
    isRecording: boolean;
    stream: MediaStream | null;
    audioBlob: Blob | null;
    audioUrl: string | null;
    startRecording: () => Promise<MediaStream>;
    stopRecording: () => void;
    clearRecording: () => void;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
    const [isRecording, setIsRecording] = useState(false);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const startRecording = useCallback(async () => {
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            setStream(mediaStream);
            setIsRecording(true);
            return mediaStream;
        } catch (error) {
            console.error("Failed to start recording:", error);
            throw error;
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            setStream(null);
            setIsRecording(false);
        }
        // Note: We don't handle MediaRecorder here for the CALL recording anymore.
        // This hook is now primarily for getting the stream.
        // If we need standalone recording, we can add it back, but use-call handles the mixed recording.
    }, [stream]);

    const clearRecording = useCallback(() => {
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
        }
        setAudioBlob(null);
        setAudioUrl(null);
    }, [audioUrl]);

    return {
        isRecording,
        stream,
        audioBlob,
        audioUrl,
        startRecording,
        stopRecording,
        clearRecording,
    };
}
