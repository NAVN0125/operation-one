"use client";

import { useEffect, useState, Suspense } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CallRoom } from "@/components/call/call-room";
import { AnalysisModal, AnalysisResult } from "@/components/analysis/analysis-modal";
import { ConnectionList } from "@/components/connections/connection-list";
import { useCall } from "@/hooks/use-call";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { usePresence } from "@/hooks/use-presence";
import { NoteRecorder } from "@/components/NoteRecorder";
import { User, Users, Phone, LogOut, Mic } from "lucide-react";

interface Connection {
    id: number;
    connected_user_id: number;
    connected_user_name: string | null;
    connected_user_display_name: string | null;
    is_online: boolean;
    created_at: string;
}

const DashboardContent = () => {
    const { data: session, status } = useSession();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isUserOnline, incomingCall, clearIncomingCall } = usePresence();
    const {
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
        clearRecording,
        isSharingScreen,
        startScreenShare,
        stopScreenShare,
    } = useCall();

    const [connections, setConnections] = useState<Connection[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [showAnalysisModal, setShowAnalysisModal] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<string | null>(null);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [isCaller, setIsCaller] = useState(false);
    const [activeParticipants, setActiveParticipants] = useState<{ id: number; displayName: string; isOnline: boolean }[]>([]);

    useEffect(() => {
        const callUser = searchParams?.get('callUser');
        if (callUser) {
            setSelectedUserId(parseInt(callUser));
        }
    }, [searchParams]);

    // Handle token refresh errors
    useEffect(() => {
        if (session?.error === "RefreshAccessTokenError") {
            // Token refresh failed, sign out to force re-authentication
            signOut();
        }
    }, [session?.error]);

    useEffect(() => {
        if (session?.idToken) {
            fetchConnections();
        }
    }, [session]);

    useEffect(() => {
        setConnections((prev) =>
            prev.map((conn) => ({
                ...conn,
                is_online: isUserOnline(conn.connected_user_id),
            }))
        );
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
            const response = await fetch(`/service/api/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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
            console.error("Error getting backend token:", error);
            return null;
        }
    };

    const fetchConnections = async () => {
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(`/service/api/users/me/connections`, {
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
    };

    const handleAcceptCall = async () => {
        if (!incomingCall) return;
        setIsCaller(false);
        setActiveParticipants([{
            id: incomingCall.caller_id,
            displayName: incomingCall.caller_display_name || incomingCall.caller_name || "Unknown",
            isOnline: true
        }]);
        await acceptIncomingCall(incomingCall.call_id, incomingCall.room_name);
        clearIncomingCall();
    };

    const handleDeclineCall = () => {
        clearIncomingCall();
    };

    const handleAnswerCall = async () => {
        await answerCall();
    };

    const handleEndCall = async () => {
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

            const response = await fetch(`/service/api/calls/${callState.callId}/invite`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({ user_id: userId }),
            });

            if (response.ok) {
                setShowInviteModal(false);
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
            }
        } catch (error) {
            console.error("Error inviting user:", error);
        }
    };

    const handleAnalyze = async (interpretation: string) => {
        if (!callState.callId) return;

        setShowAnalysisModal(false);
        setAnalysisResult("Analyzing call data... please wait.");

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) {
                setAnalysisResult("Error: Authentication failed.");
                return;
            }

            const response = await fetch(`/service/api/analysis/${callState.callId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({ user_interpretation: interpretation }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || "Analysis failed");
            }

            const data = await response.json();
            setAnalysisResult(data.result);
        } catch (error) {
            console.error("Analysis error:", error);
            setAnalysisResult(`Error analyzing call: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    };

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/login");
        }
    }, [status, router]);

    if (status === "loading") {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="text-slate-400">Loading...</div>
            </div>
        );
    }

    if (!session) {
        return null;
    }

    return (
        <div className="min-h-screen bg-slate-950 text-white selection:bg-blue-500/30">
            {/* Background Gradients */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]" />
            </div>

            <div className="relative z-10 min-h-screen">
                {/* Header */}
                <header className="px-6 py-4 border-b border-slate-800/50 backdrop-blur-sm bg-slate-950/50">
                    <div className="max-w-7xl mx-auto flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-2">
                            <div className="p-2 bg-blue-600 rounded-lg">
                                <Phone className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                                Operation One
                            </span>
                        </Link>

                        <div className="flex items-center gap-3">
                            <span className="text-sm text-slate-400 hidden sm:block">
                                {session.user?.name}
                            </span>
                            <Link href="/profile">
                                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-slate-800">
                                    <User className="w-4 h-4" />
                                </Button>
                            </Link>
                            <Link href="/connections">
                                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-slate-800">
                                    <Users className="w-4 h-4" />
                                </Button>
                            </Link>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => signOut()}
                                className="text-slate-400 hover:text-white hover:bg-slate-800"
                            >
                                <LogOut className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </header>

                {/* Main Content */}
                <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
                    {/* Page Title */}
                    <div>
                        <h1 className="text-2xl font-bold">Dashboard</h1>
                        <p className="text-slate-400 text-sm">Manage your calls and connections</p>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                            <p className="text-red-400">{error}</p>
                        </div>
                    )}

                    {/* Voice Notes Section */}
                    <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm">
                        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                            <Mic className="w-5 h-5 text-purple-400" />
                            Voice Notes
                        </h2>
                        <p className="text-slate-400 mb-4 text-sm">
                            Record voice notes and get AI-powered transcription and analysis.
                        </p>
                        <NoteRecorder />
                    </div>

                    {/* Call Interface */}
                    {callState.status === "idle" || callState.status === "ended" ? (
                        selectedUserId ? (
                            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm">
                                <h2 className="text-lg font-semibold mb-2">Ready to Call</h2>
                                <p className="text-slate-400 mb-4">
                                    {connections.find(c => c.connected_user_id === selectedUserId)?.connected_user_display_name || "Selected User"}
                                </p>
                                <div className="flex gap-3">
                                    <Button
                                        onClick={() => handleStartCall(selectedUserId)}
                                        disabled={isLoading}
                                        className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20"
                                    >
                                        {isLoading ? "Starting..." : "Start Call"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => setSelectedUserId(null)}
                                        className="border-slate-700 bg-slate-900/50 hover:bg-slate-800"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm">
                                <h2 className="text-lg font-semibold mb-4">Your Connections</h2>
                                <ConnectionList
                                    connections={connections}
                                    onCall={(userId) => setSelectedUserId(userId)}
                                    onRemove={async (userId) => {
                                        try {
                                            const backendToken = await getBackendToken();
                                            if (!backendToken) return;

                                            await fetch(`/service/api/users/me/connections/${userId}`, {
                                                method: "DELETE",
                                                headers: { Authorization: `Bearer ${backendToken}` },
                                            });
                                            fetchConnections();
                                        } catch (error) {
                                            console.error("Error removing connection:", error);
                                        }
                                    }}
                                />
                            </div>
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
                            isSharingScreen={isSharingScreen}
                            onStartScreenShare={startScreenShare}
                            onStopScreenShare={stopScreenShare}
                        />
                    )}

                    {/* Recording Status */}
                    {isRecording && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
                            <span className="h-3 w-3 bg-red-500 rounded-full animate-pulse" />
                            <span className="text-red-400">Recording Call (Uploading on End)...</span>
                        </div>
                    )}

                    {/* Audio Playback */}
                    {audioUrl && !isRecording && (
                        <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm space-y-4">
                            <h2 className="text-lg font-semibold">Call Recording (Saved to Server)</h2>
                            <audio src={audioUrl} controls className="w-full" />
                            <Button
                                variant="outline"
                                onClick={clearRecording}
                                className="border-slate-700 bg-slate-900/50 hover:bg-slate-800"
                            >
                                Clear Preview
                            </Button>
                        </div>
                    )}

                    {/* Transcript Display */}
                    {transcript && (
                        <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm">
                            <h2 className="text-lg font-semibold mb-4">Live Transcript</h2>
                            <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800 min-h-[100px]">
                                <p className="whitespace-pre-wrap text-slate-300">{transcript}</p>
                            </div>
                        </div>
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
                            <div className="w-full max-w-md p-8 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-sm text-center">
                                <div className="inline-flex p-4 bg-green-600/20 rounded-full mb-4">
                                    <Phone className="w-8 h-8 text-green-400 animate-pulse" />
                                </div>
                                <h2 className="text-2xl font-bold mb-2">Incoming Call</h2>
                                <p className="text-slate-400 mb-6">
                                    {incomingCall.caller_display_name || incomingCall.caller_name || "Unknown User"} is calling...
                                </p>
                                <div className="flex justify-center gap-4">
                                    <Button
                                        onClick={handleDeclineCall}
                                        variant="outline"
                                        className="w-32 border-red-500/50 text-red-400 hover:bg-red-500/10"
                                    >
                                        Decline
                                    </Button>
                                    <Button
                                        onClick={handleAcceptCall}
                                        className="w-32 bg-green-600 hover:bg-green-500"
                                    >
                                        Accept
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Invite Modal */}
                    {showInviteModal && (
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
                            <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-sm">
                                <h2 className="text-xl font-bold mb-2">Invite to Call</h2>
                                <p className="text-slate-400 text-sm mb-4">Select a connection to invite</p>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                    {connections.map((conn) => (
                                        <div key={conn.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-800/50 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className={`h-2 w-2 rounded-full ${conn.is_online ? "bg-green-500" : "bg-slate-500"}`} />
                                                <span>{conn.connected_user_display_name || conn.connected_user_name}</span>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleInviteUser(conn.connected_user_id)}
                                                disabled={activeParticipants.some(p => p.id === conn.connected_user_id)}
                                                className="border-slate-700 bg-slate-900/50 hover:bg-slate-800"
                                            >
                                                {activeParticipants.some(p => p.id === conn.connected_user_id) ? "In Call" : "Invite"}
                                            </Button>
                                        </div>
                                    ))}
                                    {connections.length === 0 && (
                                        <p className="text-slate-500 text-center py-4">No connections found</p>
                                    )}
                                </div>
                                <div className="flex justify-end mt-4">
                                    <Button
                                        variant="ghost"
                                        onClick={() => setShowInviteModal(false)}
                                        className="text-slate-400 hover:text-white"
                                    >
                                        Close
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default function DashboardPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">Loading...</div>}>
            <DashboardContent />
        </Suspense>
    );
}
