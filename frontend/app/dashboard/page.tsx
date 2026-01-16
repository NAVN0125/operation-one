"use client";

import { useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CallRoom } from "@/components/call/call-room";
import { AnalysisModal, AnalysisResult } from "@/components/analysis/analysis-modal";
import { ConnectionList } from "@/components/connections/connection-list";
import { useCall } from "@/hooks/use-call";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { usePresence } from "@/hooks/use-presence";
import { User, Users } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Connection {
    id: number;
    connected_user_id: number;
    connected_user_name: string | null;
    connected_user_display_name: string | null;
    is_online: boolean;
    created_at: string;
}

export default function DashboardPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isUserOnline, incomingCall, clearIncomingCall } = usePresence();
    const { callState, transcript, initiateCall, acceptIncomingCall, answerCall, endCall, sendAudio, isLoading, error } = useCall();
    const { isRecording, audioUrl, startRecording, stopRecording, clearRecording } = useAudioRecorder();

    const [connections, setConnections] = useState<Connection[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [showAnalysisModal, setShowAnalysisModal] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<string | null>(null);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [isCaller, setIsCaller] = useState(false);
    const [activeParticipants, setActiveParticipants] = useState<{ id: number; displayName: string; isOnline: boolean }[]>([]);

    // Check if we should auto-select a user from URL params
    useEffect(() => {
        const callUser = searchParams?.get('callUser');
        if (callUser) {
            setSelectedUserId(parseInt(callUser));
        }
    }, [searchParams]);

    // Fetch connections
    useEffect(() => {
        if (session?.idToken) {
            fetchConnections();
        }
    }, [session]);

    // Update online status in real-time
    useEffect(() => {
        setConnections((prev) =>
            prev.map((conn) => ({
                ...conn,
                is_online: isUserOnline(conn.connected_user_id),
            }))
        );
        // Also update participants online status
        setActiveParticipants((prev) =>
            prev.map(p => ({
                ...p,
                isOnline: isUserOnline(p.id)
            }))
        );
    }, [isUserOnline]);

    const getBackendToken = async (): Promise<string | null> => {
        if (!session?.idToken) return null;

        try {
            const response = await fetch(`${API_URL}/api/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_token: session.idToken }),
            });

            if (response.status === 401) {
                console.error("Backend token verification failed. Session might be expired.");
                signOut();
                return null;
            }

            if (!response.ok) return null;
            const data = await response.json();
            return data.access_token;
        } catch (error) {
            console.error("Error getting backend token:", error);
            return null;
        }
    };

    const fetchConnections = async () => {
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(`${API_URL}/api/users/me/connections`, {
                headers: {
                    Authorization: `Bearer ${backendToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                setConnections(data);
            }
        } catch (error) {
            console.error("Error fetching connections:", error);
        }
    };

    const handleStartCall = async (targetUserId: number) => {
        setIsCaller(true);
        const connection = connections.find(c => c.connected_user_id === targetUserId);
        if (connection) {
            setActiveParticipants([{
                id: targetUserId,
                displayName: connection.connected_user_display_name || connection.connected_user_name || "Unknown",
                isOnline: connection.is_online
            }]);
        }
        await initiateCall(targetUserId);
        // After initiation, we are connected, start recording
        await startRecording(sendAudio);
    };

    const handleAcceptCall = async () => {
        if (!incomingCall) return;
        setIsCaller(false);
        setActiveParticipants([{
            id: incomingCall.caller_id,
            displayName: incomingCall.caller_display_name || incomingCall.caller_name || "Unknown",
            isOnline: true // Presume caller is online
        }]);
        await acceptIncomingCall(incomingCall.call_id, incomingCall.room_name);
        clearIncomingCall();
        // Start recording after accepting
        await startRecording(sendAudio);
    };

    const handleDeclineCall = () => {
        clearIncomingCall();
    };

    const handleAnswerCall = async () => {
        await answerCall();
        await startRecording(sendAudio);
    };

    const handleEndCall = async () => {
        stopRecording();
        await endCall();
        setShowAnalysisModal(true);
        setActiveParticipants([]);
        setIsCaller(false);
    };

    const handleInviteUser = async (userId: number) => {
        if (!callState.callId) return;

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(`${API_URL}/api/calls/${callState.callId}/invite`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({ user_id: userId }),
            });

            if (response.ok) {
                setShowInviteModal(false);
                // Add to participants list optimistically
                const connection = connections.find(c => c.connected_user_id === userId);
                if (connection) {
                    setActiveParticipants(prev => {
                        if (prev.find(p => p.id === userId)) return prev;
                        return [...prev, {
                            id: userId,
                            displayName: connection.connected_user_display_name || connection.connected_user_name || "Unknown",
                            isOnline: connection.is_online
                        }];
                    });
                }
            } else {
                console.error("Failed to invite user");
            }
        } catch (error) {
            console.error("Error inviting user:", error);
        }
    };

    const handleAnalyze = async (interpretation: string) => {
        if (!callState.callId) return;

        // Keep modal open or show loading state? 
        // For better UX, let's close modal and show a loading indicator in the result area
        setShowAnalysisModal(false);
        setAnalysisResult("Analyzing call data... please wait.");

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) {
                setAnalysisResult("Error: Authentication failed.");
                return;
            }

            const response = await fetch(`${API_URL}/api/analysis/${callState.callId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({ user_interpretation: interpretation }),
            });

            if (!response.ok) {
                const errorData = await response.json(); // Attempt to get error details
                throw new Error(errorData.detail || "Analysis failed");
            }

            const data = await response.json();
            setAnalysisResult(data.result);
        } catch (error) {
            console.error("Analysis error:", error);
            setAnalysisResult(`Error analyzing call: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    };

    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">Loading...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle className="text-2xl">System Call Analysis</CardTitle>
                        <CardDescription>Sign in to start analyzing your calls</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                        <Button onClick={() => signIn("google")} size="lg">
                            Sign in with Google
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold text-white">Call Dashboard</h1>
                        <p className="text-slate-400">Welcome, {session.user?.name}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => router.push("/profile")}>
                            <User className="h-4 w-4 mr-2" />
                            Profile
                        </Button>
                        <Button variant="outline" onClick={() => router.push("/connections")}>
                            <Users className="h-4 w-4 mr-2" />
                            Connections
                        </Button>
                        <Button variant="outline" onClick={() => signOut()}>
                            Sign Out
                        </Button>
                    </div>
                </div>

                {/* Error Display */}
                {error && (
                    <Card className="border-red-500 bg-red-500/10">
                        <CardContent className="pt-4">
                            <p className="text-red-400">{error}</p>
                        </CardContent>
                    </Card>
                )}

                {/* Call Interface */}
                {callState.status === "idle" || callState.status === "ended" ? (
                    selectedUserId ? (
                        <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
                            <CardHeader>
                                <CardTitle className="text-white">Ready to Call</CardTitle>
                                <CardDescription className="text-slate-400">
                                    {connections.find(c => c.connected_user_id === selectedUserId)?.connected_user_display_name || "Selected User"}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex gap-2">
                                <Button onClick={() => handleStartCall(selectedUserId)} disabled={isLoading} size="lg">
                                    {isLoading ? "Starting..." : "Start Call"}
                                </Button>
                                <Button variant="outline" onClick={() => setSelectedUserId(null)}>
                                    Cancel
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <ConnectionList
                            connections={connections}
                            onCall={(userId) => setSelectedUserId(userId)}
                            onRemove={async (userId) => {
                                // Remove connection logic
                                try {
                                    const backendToken = await getBackendToken();
                                    if (!backendToken) return;

                                    await fetch(`http://localhost:8000/api/users/me/connections/${userId}`, {
                                        method: "DELETE",
                                        headers: { Authorization: `Bearer ${backendToken}` },
                                    });
                                    fetchConnections();
                                } catch (error) {
                                    console.error("Error removing connection:", error);
                                }
                            }}
                        />
                    )
                ) : (
                    <CallRoom
                        roomName={callState.roomName || "Unknown"}
                        status={callState.status as "connected" | "answered" | "ended"}
                        participants={activeParticipants}
                        isCaller={isCaller}
                        onCallAnswered={handleAnswerCall}
                        onCallEnd={handleEndCall}
                        onInviteParticipant={() => setShowInviteModal(true)}
                        onAudioData={sendAudio}
                    />
                )}

                {/* Recording Status */}
                {isRecording && (
                    <Card className="border-red-500 bg-red-500/10">
                        <CardContent className="pt-4 flex items-center gap-2">
                            <span className="h-3 w-3 bg-red-500 rounded-full animate-pulse" />
                            <span className="text-red-400">Streaming audio to server...</span>
                        </CardContent>
                    </Card>
                )}

                {/* Audio Playback */}
                {audioUrl && !isRecording && (
                    <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
                        <CardHeader>
                            <CardTitle className="text-white">Call Recording</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <audio src={audioUrl} controls className="w-full" />
                            <Button variant="outline" onClick={clearRecording} className="text-white border-slate-700 hover:bg-slate-800">
                                Clear Recording
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* Transcript Display */}
                {transcript && (
                    <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
                        <CardHeader>
                            <CardTitle className="text-white">Live Transcript</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-slate-950/50 p-4 rounded-md border border-slate-800 min-h-[100px]">
                                <p className="whitespace-pre-wrap text-slate-300">{transcript}</p>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Analysis Result */}
                {analysisResult && <AnalysisResult result={analysisResult} />}

                {/* Analysis Modal */}
                <AnalysisModal
                    isOpen={showAnalysisModal}
                    onClose={() => setShowAnalysisModal(false)}
                    onSubmit={handleAnalyze}
                />

                {/* Incoming Call Modal */}
                {incomingCall && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
                        <Card className="w-full max-w-md bg-slate-900 border-slate-700 animate-in fade-in zoom-in-95 duration-200">
                            <CardHeader className="text-center">
                                <CardTitle className="text-2xl text-white">Incoming Call</CardTitle>
                                <CardDescription className="text-slate-400">
                                    {incomingCall.caller_display_name || incomingCall.caller_name || "Unknown User"} is calling...
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex justify-center gap-4">
                                <Button
                                    onClick={handleDeclineCall}
                                    variant="destructive"
                                    className="w-32"
                                >
                                    Decline
                                </Button>
                                <Button
                                    onClick={handleAcceptCall}
                                    className="w-32 bg-green-600 hover:bg-green-700 text-white"
                                >
                                    Accept
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Invite Modal */}
                {showInviteModal && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
                        <Card className="w-full max-w-md bg-slate-900 border-slate-700 animate-in fade-in zoom-in-95 duration-200">
                            <CardHeader>
                                <CardTitle className="text-white">Invite to Call</CardTitle>
                                <CardDescription className="text-slate-400">Select a connection to invite</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                    {connections.map((conn) => (
                                        <div key={conn.id} className="flex items-center justify-between p-2 rounded hover:bg-slate-800">
                                            <div className="flex items-center gap-2 text-white">
                                                <div className={`h-2 w-2 rounded-full ${conn.is_online ? "bg-green-500" : "bg-slate-500"}`} />
                                                <span>{conn.connected_user_display_name || conn.connected_user_name}</span>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleInviteUser(conn.connected_user_id)}
                                                disabled={activeParticipants.some(p => p.id === conn.connected_user_id)}
                                            >
                                                {activeParticipants.some(p => p.id === conn.connected_user_id) ? "In Call" : "Invite"}
                                            </Button>
                                        </div>
                                    ))}
                                    {connections.length === 0 && (
                                        <p className="text-slate-500 text-center py-4">No connections found</p>
                                    )}
                                </div>
                                <div className="flex justify-end">
                                    <Button variant="ghost" onClick={() => setShowInviteModal(false)}>Close</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
}
