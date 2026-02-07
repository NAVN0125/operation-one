'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ElectronSource, MeetingData } from '@/types/electron';

export interface RecorderState {
    isRecording: boolean;
    isPaused: boolean;
    duration: number;
    error: string | null;
}

export interface UseRecorderReturn {
    state: RecorderState;
    sources: ElectronSource[];
    selectedSource: ElectronSource | null;
    detectedMeeting: MeetingData | null;
    isElectron: boolean;
    refreshSources: () => Promise<void>;
    selectSource: (source: ElectronSource) => void;
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<Blob | null>;
    pauseRecording: () => void;
    resumeRecording: () => void;
}

export function useRecorder(): UseRecorderReturn {
    const [state, setState] = useState<RecorderState>({
        isRecording: false,
        isPaused: false,
        duration: 0,
        error: null,
    });

    const [sources, setSources] = useState<ElectronSource[]>([]);
    const [selectedSource, setSelectedSource] = useState<ElectronSource | null>(null);
    const [detectedMeeting, setDetectedMeeting] = useState<MeetingData | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

    // Listen for meeting detection
    useEffect(() => {
        if (!isElectron) return;

        window.electronAPI!.onMeetingDetected((data) => {
            setDetectedMeeting(data);
        });

        return () => {
            window.electronAPI!.removeMeetingListener();
        };
    }, [isElectron]);

    const refreshSources = useCallback(async () => {
        if (!isElectron) {
            setState(s => ({ ...s, error: 'Not running in Electron' }));
            return;
        }

        try {
            const availableSources = await window.electronAPI!.getSources();
            setSources(availableSources);
        } catch (err) {
            setState(s => ({ ...s, error: 'Failed to get sources' }));
        }
    }, [isElectron]);

    const selectSource = useCallback((source: ElectronSource) => {
        setSelectedSource(source);
    }, []);

    const startRecording = useCallback(async () => {
        if (!selectedSource) {
            setState(s => ({ ...s, error: 'No source selected' }));
            return;
        }

        try {
            // Use getDisplayMedia with the selected source
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    // @ts-expect-error - Electron-specific constraint
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: selectedSource.id,
                    },
                },
            });

            // Try to add audio
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false,
                });
                audioStream.getAudioTracks().forEach(track => stream.addTrack(track));
            } catch {
                console.warn('Could not capture audio');
            }

            streamRef.current = stream;
            chunksRef.current = [];

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp9',
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.start(1000); // Collect data every second
            mediaRecorderRef.current = mediaRecorder;

            // Start duration timer
            const startTime = Date.now();
            durationIntervalRef.current = setInterval(() => {
                setState(s => ({
                    ...s,
                    duration: Math.floor((Date.now() - startTime) / 1000),
                }));
            }, 1000);

            setState(s => ({
                ...s,
                isRecording: true,
                isPaused: false,
                error: null,
            }));
        } catch (err) {
            setState(s => ({
                ...s,
                error: `Failed to start recording: ${err}`,
            }));
        }
    }, [selectedSource]);

    const stopRecording = useCallback(async (): Promise<Blob | null> => {
        return new Promise((resolve) => {
            if (!mediaRecorderRef.current) {
                resolve(null);
                return;
            }

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'video/webm' });

                // Stop all tracks
                streamRef.current?.getTracks().forEach(track => track.stop());

                // Clear interval
                if (durationIntervalRef.current) {
                    clearInterval(durationIntervalRef.current);
                }

                setState({
                    isRecording: false,
                    isPaused: false,
                    duration: 0,
                    error: null,
                });

                resolve(blob);
            };

            mediaRecorderRef.current.stop();
        });
    }, []);

    const pauseRecording = useCallback(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.pause();
            setState(s => ({ ...s, isPaused: true }));
        }
    }, []);

    const resumeRecording = useCallback(() => {
        if (mediaRecorderRef.current?.state === 'paused') {
            mediaRecorderRef.current.resume();
            setState(s => ({ ...s, isPaused: false }));
        }
    }, []);

    return {
        state,
        sources,
        selectedSource,
        detectedMeeting,
        isElectron,
        refreshSources,
        selectSource,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
    };
}
