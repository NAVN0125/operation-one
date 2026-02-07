'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRecorder } from '@/hooks/useRecorder';
import type { ElectronSource } from '@/types/electron';

interface RecordingAnalysis {
    id: number;
    filename: string;
    status: string;
    transcript?: string;
    analysis_result?: string;
}

export function WindowSelector() {
    const { data: session } = useSession();
    const {
        sources,
        selectedSource,
        detectedMeeting,
        isElectron,
        refreshSources,
        selectSource,
        state,
        startRecording,
        stopRecording,
    } = useRecorder();

    const [savedFilePath, setSavedFilePath] = useState<string | null>(null);
    const [savedBlob, setSavedBlob] = useState<Blob | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [recording, setRecording] = useState<RecordingAnalysis | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [interpretation, setInterpretation] = useState('');
    const [showAnalysisForm, setShowAnalysisForm] = useState(false);

    useEffect(() => {
        if (isElectron) {
            refreshSources();
        }
    }, [isElectron, refreshSources]);

    // Auto-select detected meeting window
    useEffect(() => {
        if (detectedMeeting && sources.length > 0) {
            const meetingSource = sources.find(s => s.id === detectedMeeting.id);
            if (meetingSource) {
                selectSource(meetingSource);
            }
        }
    }, [detectedMeeting, sources, selectSource]);

    const getBackendToken = async (): Promise<string | null> => {
        if (!session?.idToken) return null;

        try {
            const response = await fetch(`/service/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_token: session.idToken }),
            });

            if (!response.ok) return null;
            const data = await response.json();
            return data.access_token;
        } catch (error) {
            console.error('Error getting backend token:', error);
            return null;
        }
    };

    if (!isElectron) {
        return (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-yellow-800">
                    This feature requires the desktop app. Please run with `npm run electron:dev`.
                </p>
            </div>
        );
    }

    const handleSourceClick = (source: ElectronSource) => {
        selectSource(source);
    };

    const handleRecordToggle = async () => {
        if (state.isRecording) {
            setIsSaving(true);
            setSavedFilePath(null);
            setSavedBlob(null);
            setRecording(null);
            setAnalysisError(null);

            const blob = await stopRecording();
            if (blob && window.electronAPI) {
                try {
                    // Convert blob to ArrayBuffer for IPC transfer
                    const arrayBuffer = await blob.arrayBuffer();
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const filename = `meeting-${timestamp}.webm`;

                    const result = await window.electronAPI.saveRecording(arrayBuffer, filename);
                    if (result.success) {
                        setSavedFilePath(result.filePath);
                        setSavedBlob(blob);
                    }
                } catch (error) {
                    console.error('Failed to save recording:', error);
                }
            }
            setIsSaving(false);
        } else {
            setSavedFilePath(null);
            setSavedBlob(null);
            setRecording(null);
            setAnalysisError(null);
            await startRecording();
        }
    };

    const handleUploadAndAnalyze = async () => {
        if (!savedBlob || !savedFilePath) return;

        setIsUploading(true);
        setAnalysisError(null);

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) {
                setAnalysisError('Authentication failed. Please log in again.');
                setIsUploading(false);
                return;
            }

            // Upload the recording
            const formData = new FormData();
            const filename = savedFilePath.split('/').pop() || 'recording.webm';
            formData.append('file', savedBlob, filename);

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

            // Show analysis form
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

            // First transcribe
            const transcribeResponse = await fetch(`/service/api/recordings/${recording.id}/transcribe`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${backendToken}`,
                },
            });

            if (!transcribeResponse.ok) {
                const error = await transcribeResponse.json();
                throw new Error(error.detail || 'Transcription failed');
            }

            const transcribedRecording = await transcribeResponse.json();
            setRecording(transcribedRecording);

            // Then analyze with user interpretation
            const analyzeResponse = await fetch(`/service/api/recordings/${recording.id}/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({
                    user_interpretation: interpretation || 'Please provide a general analysis of this meeting.',
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

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="space-y-6">
            {/* Meeting Detection Banner */}
            {detectedMeeting && (
                <div className="p-4 bg-green-900/50 border border-green-700 rounded-lg flex items-center justify-between">
                    <div>
                        <p className="text-green-400 font-medium">Meeting Detected!</p>
                        <p className="text-green-300 text-sm">{detectedMeeting.name}</p>
                    </div>
                    {!state.isRecording && (
                        <button
                            onClick={handleRecordToggle}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors"
                        >
                            Start Recording
                        </button>
                    )}
                </div>
            )}

            {/* Recording Status */}
            {state.isRecording && (
                <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-red-400 font-medium">Recording</span>
                        <span className="text-red-300">{formatDuration(state.duration)}</span>
                    </div>
                    <button
                        onClick={handleRecordToggle}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors"
                    >
                        Stop Recording
                    </button>
                </div>
            )}

            {/* Saving Indicator */}
            {isSaving && (
                <div className="p-4 bg-blue-900/50 border border-blue-700 rounded-lg flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-blue-300 font-medium">Saving recording...</span>
                </div>
            )}

            {/* Save Success with Analyze Button */}
            {savedFilePath && !isSaving && !recording && (
                <div className="p-4 bg-green-900/50 border border-green-700 rounded-lg space-y-3">
                    <div>
                        <p className="text-green-400 font-medium mb-1">✓ Recording saved successfully!</p>
                        <p className="text-green-300 text-sm font-mono break-all">{savedFilePath}</p>
                    </div>
                    <button
                        onClick={handleUploadAndAnalyze}
                        disabled={isUploading}
                        className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isUploading ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Uploading...
                            </>
                        ) : (
                            '🔍 Upload & Analyze Recording'
                        )}
                    </button>
                </div>
            )}

            {/* Analysis Form */}
            {showAnalysisForm && recording && (
                <div className="p-4 bg-purple-900/50 border border-purple-700 rounded-lg space-y-4">
                    <div>
                        <h4 className="text-purple-300 font-medium mb-2">Analyze Recording</h4>
                        <p className="text-purple-400 text-sm mb-3">
                            Provide context or specific questions for the AI analysis:
                        </p>
                        <textarea
                            value={interpretation}
                            onChange={(e) => setInterpretation(e.target.value)}
                            placeholder="e.g., 'Focus on action items and deadlines' or 'Summarize the key decisions made'"
                            className="w-full p-3 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 resize-none"
                            rows={3}
                        />
                    </div>
                    <button
                        onClick={handleTranscribeAndAnalyze}
                        disabled={isAnalyzing}
                        className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isAnalyzing ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Transcribing & Analyzing...
                            </>
                        ) : (
                            '🚀 Start Analysis'
                        )}
                    </button>
                </div>
            )}

            {/* Analysis Results */}
            {recording?.analysis_result && (
                <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg space-y-4">
                    <h4 className="text-white font-medium flex items-center gap-2">
                        📊 Analysis Results
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
                </div>
            )}

            {/* Error Display */}
            {(state.error || analysisError) && (
                <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg">
                    <p className="text-red-400">{state.error || analysisError}</p>
                </div>
            )}

            {/* Source Selection */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">Available Windows</h3>
                    <button
                        onClick={refreshSources}
                        className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    >
                        Refresh
                    </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {sources.map((source) => (
                        <div
                            key={source.id}
                            onClick={() => handleSourceClick(source)}
                            className={`p-2 border-2 rounded-lg cursor-pointer transition-all ${selectedSource?.id === source.id
                                ? 'border-blue-500 bg-blue-900/30'
                                : 'border-slate-600 hover:border-slate-500 bg-slate-800'
                                }`}
                        >
                            <img
                                src={source.thumbnail}
                                alt={source.name}
                                className="w-full aspect-video object-cover rounded mb-2"
                            />
                            <p className="text-sm truncate text-white">{source.name}</p>
                        </div>
                    ))}
                </div>

                {sources.length === 0 && (
                    <p className="text-slate-400 text-center py-8">
                        No windows found. Click Refresh to scan.
                    </p>
                )}
            </div>

            {/* Manual Record Button */}
            {selectedSource && !state.isRecording && (
                <button
                    onClick={handleRecordToggle}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-medium"
                >
                    Start Recording: {selectedSource.name}
                </button>
            )}
        </div>
    );
}
