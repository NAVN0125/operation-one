'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Monitor, MonitorOff, Mic, Loader2, FileAudio, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RecordingAnalysis {
    id: number;
    filename: string;
    status: string;
    transcript?: string;
    analysis_result?: string;
}

interface RecorderState {
    isCapturing: boolean;
    duration: number;
    error: string | null;
}

export function MeetingRecorder() {
    const { data: session } = useSession();
    const [state, setState] = useState<RecorderState>({
        isCapturing: false,
        duration: 0,
        error: null,
    });

    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [recording, setRecording] = useState<RecordingAnalysis | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [interpretation, setInterpretation] = useState('');
    const [showAnalysisForm, setShowAnalysisForm] = useState(false);

    // Audio refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const mixedDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
            if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
            if (audioContextRef.current) audioContextRef.current.close();
            if (audioUrl) URL.revokeObjectURL(audioUrl);
        };
    }, [audioUrl]);

    const getBackendToken = async (): Promise<string | null> => {
        if (!session?.idToken) return null;

        try {
            const response = await fetch(`/service/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_token: session.idToken }),
            });

            if (response.status === 401) {
                signOut();
                return null;
            }

            if (!response.ok) return null;
            const data = await response.json();
            return data.access_token;
        } catch (error) {
            console.error('Error getting backend token:', error);
            return null;
        }
    };

    const startCapture = useCallback(async () => {
        try {
            // Reset state
            setAudioBlob(null);
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
                setAudioUrl(null);
            }
            setRecording(null);
            setAnalysisError(null);
            setShowAnalysisForm(false);
            chunksRef.current = [];

            // 1. Request tab/screen audio via getDisplayMedia
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                audio: true,
                video: true, // Required by spec
            });

            // Check if we got an audio track
            const screenAudioTracks = screenStream.getAudioTracks();
            if (screenAudioTracks.length === 0) {
                screenStream.getTracks().forEach(t => t.stop());
                setState(prev => ({
                    ...prev,
                    error: "No audio was shared. Please check 'Share tab audio' when selecting a tab.",
                }));
                return;
            }
            screenStreamRef.current = screenStream;

            // 2. Request microphone
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            micStreamRef.current = micStream;

            // 3. Mix both streams using AudioContext
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;

            const destination = ctx.createMediaStreamDestination();
            mixedDestinationRef.current = destination;

            // Connect mic audio
            const micSource = ctx.createMediaStreamSource(micStream);
            micSource.connect(destination);

            // Connect tab audio
            const screenSource = ctx.createMediaStreamSource(screenStream);
            screenSource.connect(destination);

            // 4. Record the mixed stream
            const mediaRecorder = new MediaRecorder(destination.stream, {
                mimeType: 'audio/webm;codecs=opus',
            });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                setAudioBlob(blob);
                setAudioUrl(URL.createObjectURL(blob));
            };

            mediaRecorder.start(1000);
            setState(prev => ({ ...prev, isCapturing: true, duration: 0, error: null }));

            // Start duration timer
            timerRef.current = setInterval(() => {
                setState(prev => ({ ...prev, duration: prev.duration + 1 }));
            }, 1000);

            // Listen for user stopping via browser UI ("Stop sharing")
            const videoTrack = screenStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.addEventListener('ended', () => {
                    stopCapture();
                });
            }

        } catch (error) {
            console.error('Failed to start capture:', error);
            // Cleanup any partial streams
            if (micStreamRef.current) {
                micStreamRef.current.getTracks().forEach(t => t.stop());
                micStreamRef.current = null;
            }
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(t => t.stop());
                screenStreamRef.current = null;
            }
            if ((error as DOMException).name === 'NotAllowedError') {
                setState(prev => ({ ...prev, error: 'Screen share was cancelled.' }));
            } else {
                setState(prev => ({
                    ...prev,
                    error: error instanceof Error ? error.message : 'Failed to start capture',
                }));
            }
        }
    }, [audioUrl]);

    const stopCapture = useCallback(() => {
        if (mediaRecorderRef.current && state.isCapturing) {
            mediaRecorderRef.current.stop();
        }

        // Stop all tracks
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(t => t.stop());
            micStreamRef.current = null;
        }
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        setState(prev => ({ ...prev, isCapturing: false }));

        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, [state.isCapturing]);

    const handleToggle = () => {
        if (state.isCapturing) {
            stopCapture();
        } else {
            startCapture();
        }
    };

    const handleUploadAndAnalyze = async () => {
        if (!audioBlob) return;

        setIsUploading(true);
        setAnalysisError(null);

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) {
                setAnalysisError('Authentication failed. Please log in again.');
                setIsUploading(false);
                return;
            }

            const formData = new FormData();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `meeting-${timestamp}.webm`;
            formData.append('file', audioBlob, filename);

            const uploadResponse = await fetch('/service/api/recordings/upload', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${backendToken}`,
                },
                body: formData,
            });

            if (!uploadResponse.ok) {
                const error = await uploadResponse.json();
                throw new Error(error.detail || 'Upload failed');
            }

            const uploadedRecording = await uploadResponse.json();
            setRecording(uploadedRecording);
            setIsUploading(false);
            setShowAnalysisForm(true);
        } catch (error) {
            console.error('Upload failed:', error);
            setAnalysisError(error instanceof Error ? error.message : 'Upload failed');
            setIsUploading(false);
        }
    };

    const handleTranscribeAndAnalyze = async () => {
        if (!recording) return;

        setIsAnalyzing(true);
        setAnalysisError(null);

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) {
                setAnalysisError('Authentication failed');
                setIsAnalyzing(false);
                return;
            }

            // Transcribe
            const transcribeResponse = await fetch(`/service/api/recordings/${recording.id}/transcribe`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${backendToken}` },
            });

            if (!transcribeResponse.ok) {
                const error = await transcribeResponse.json();
                throw new Error(error.detail || 'Transcription failed');
            }

            const transcribedRecording = await transcribeResponse.json();
            setRecording(transcribedRecording);

            // Analyze
            const analyzeResponse = await fetch(`/service/api/recordings/${recording.id}/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({
                    user_interpretation: interpretation || 'Please provide meeting notes, key discussion points, action items, and decisions made.',
                }),
            });

            if (!analyzeResponse.ok) {
                const error = await analyzeResponse.json();
                throw new Error(error.detail || 'Analysis failed');
            }

            const analyzedRecording = await analyzeResponse.json();
            setRecording(analyzedRecording);
            setShowAnalysisForm(false);
        } catch (error) {
            console.error('Analysis failed:', error);
            setAnalysisError(error instanceof Error ? error.message : 'Analysis failed');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleClearRecording = () => {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioBlob(null);
        setAudioUrl(null);
        setRecording(null);
        setShowAnalysisForm(false);
        setInterpretation('');
        setAnalysisError(null);
        setState(prev => ({ ...prev, duration: 0 }));
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="space-y-4">
            {/* Capture Control */}
            <div className="flex items-center justify-center gap-4">
                <Button
                    onClick={handleToggle}
                    size="lg"
                    className={`rounded-full w-16 h-16 ${state.isCapturing
                        ? 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/30'
                        : 'bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/30'
                        }`}
                >
                    {state.isCapturing ? (
                        <MonitorOff className="w-6 h-6" />
                    ) : (
                        <Monitor className="w-6 h-6" />
                    )}
                </Button>

                {state.isCapturing && (
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-lg font-mono text-red-400">{formatDuration(state.duration)}</span>
                    </div>
                )}
            </div>

            <p className="text-center text-sm text-slate-400">
                {state.isCapturing
                    ? 'Recording tab audio + microphone... Click to stop'
                    : 'Select a browser tab to capture its audio along with your microphone'}
            </p>

            {state.isCapturing && (
                <div className="flex items-center justify-center gap-2 text-xs text-indigo-400">
                    <Mic className="w-3 h-3" />
                    <span>Mic + Tab audio are being mixed</span>
                </div>
            )}

            {/* Error Display */}
            {(state.error || analysisError) && (
                <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg">
                    <p className="text-red-400">{state.error || analysisError}</p>
                </div>
            )}

            {/* Audio Preview */}
            {audioUrl && !state.isCapturing && (
                <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-lg space-y-4">
                    <div className="flex items-center gap-2 text-slate-300">
                        <FileAudio className="w-5 h-5" />
                        <span className="font-medium">Meeting Recording ({formatDuration(state.duration)})</span>
                    </div>

                    <audio src={audioUrl} controls className="w-full" />

                    <div className="flex gap-2">
                        <Button
                            onClick={handleUploadAndAnalyze}
                            disabled={isUploading || !!recording}
                            className="flex-1 bg-purple-600 hover:bg-purple-500"
                        >
                            {isUploading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Uploading...
                                </>
                            ) : recording ? (
                                <>
                                    <Sparkles className="w-4 h-4 mr-2" />
                                    Uploaded
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-4 h-4 mr-2" />
                                    Upload & Analyze
                                </>
                            )}
                        </Button>
                        <Button
                            onClick={handleClearRecording}
                            variant="outline"
                            className="border-slate-600 hover:bg-slate-700"
                        >
                            Clear
                        </Button>
                    </div>
                </div>
            )}

            {/* Analysis Form */}
            {showAnalysisForm && recording && (
                <div className="p-4 bg-purple-900/30 border border-purple-700 rounded-lg space-y-4">
                    <div>
                        <h4 className="text-purple-300 font-medium mb-2">Analyze Meeting</h4>
                        <p className="text-purple-400 text-sm mb-3">
                            What would you like to extract from this meeting recording?
                        </p>
                        <textarea
                            value={interpretation}
                            onChange={(e) => setInterpretation(e.target.value)}
                            placeholder="e.g., 'Extract action items and decisions' or 'Summarize key discussion points' or 'Create meeting minutes'"
                            className="w-full p-3 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 resize-none focus:border-purple-500 focus:outline-none"
                            rows={2}
                        />
                    </div>
                    <Button
                        onClick={handleTranscribeAndAnalyze}
                        disabled={isAnalyzing}
                        className="w-full bg-purple-600 hover:bg-purple-500"
                    >
                        {isAnalyzing ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Transcribing & Analyzing...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Start Analysis
                            </>
                        )}
                    </Button>
                </div>
            )}

            {/* Analysis Results */}
            {recording?.analysis_result && (
                <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg space-y-4">
                    <h4 className="text-white font-medium flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        Meeting Analysis
                    </h4>

                    {recording.transcript && (
                        <details className="group">
                            <summary className="cursor-pointer text-slate-400 hover:text-white transition-colors text-sm">
                                View Transcript
                            </summary>
                            <div className="mt-2 p-3 bg-slate-900 rounded-lg text-slate-300 text-sm max-h-40 overflow-y-auto">
                                {recording.transcript}
                            </div>
                        </details>
                    )}

                    <div className="prose prose-invert prose-sm max-w-none">
                        <div className="whitespace-pre-wrap text-slate-300">
                            {recording.analysis_result}
                        </div>
                    </div>

                    <Button
                        onClick={handleClearRecording}
                        variant="outline"
                        className="w-full border-slate-600 hover:bg-slate-700"
                    >
                        Record New Meeting
                    </Button>
                </div>
            )}
        </div>
    );
}
