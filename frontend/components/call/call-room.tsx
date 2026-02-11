"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Monitor, MonitorOff } from "lucide-react";

interface Participant {
    id: number;
    displayName: string;
    isOnline: boolean;
}

interface CallRoomProps {
    roomName: string;
    status: "connected" | "answered" | "ended";
    participants?: Participant[];
    isCaller?: boolean;
    onCallEnd: () => void;
    onCallAnswered: () => void;
    onInviteParticipant?: () => void;
    onTranscriptReceived?: (text: string, isFinal: boolean) => void;
    // Screen sharing
    isSharingScreen?: boolean;
    onStartScreenShare?: () => void;
    onStopScreenShare?: () => void;
}

export function CallRoom({
    roomName,
    status,
    participants = [],
    isCaller = false,
    onCallEnd,
    onCallAnswered,
    onInviteParticipant,
    onTranscriptReceived,
    isSharingScreen = false,
    onStartScreenShare,
    onStopScreenShare,
}: CallRoomProps) {
    const [isAnswered, setIsAnswered] = useState(status === "answered");

    useEffect(() => {
        setIsAnswered(status === "answered");
    }, [status]);

    const handleAnswer = useCallback(() => {
        onCallAnswered();
    }, [onCallAnswered]);

    const handleEnd = useCallback(() => {
        onCallEnd();
    }, [onCallEnd]);

    return (
        <Card className="w-full max-w-lg mx-auto bg-slate-900/50 backdrop-blur-sm border-slate-700">
            <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle className="text-white">Call: {roomName}</CardTitle>
                {status === "connected" && onInviteParticipant && (
                    <Button variant="outline" size="sm" onClick={onInviteParticipant}>
                        + Add
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex flex-col items-center justify-center py-4">
                    <div className={`h-20 w-20 rounded-full flex items-center justify-center animate-pulse ${isAnswered ? "bg-green-500/20 text-green-500" : "bg-blue-500/20 text-blue-500"
                        }`}>
                        <span className="text-3xl">📞</span>
                    </div>
                    <p className="mt-4 text-slate-300 font-medium text-lg">
                        {isAnswered ? "Call Active" : (isCaller ? "Calling..." : "Incoming Call")}
                    </p>
                </div>

                {/* Participants List */}
                {participants.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-slate-400">Participants</h3>
                        <div className="flex items-center gap-2 flex-wrap">
                            {participants.map((p) => (
                                <div key={p.id} className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
                                    <div className={`h-2 w-2 rounded-full ${p.isOnline ? "bg-green-500" : "bg-slate-500"}`} />
                                    <span className="text-sm text-white">{p.displayName}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex gap-4 justify-center">
                    {!isAnswered && !isCaller && (
                        <Button
                            onClick={handleAnswer}
                            variant="default"
                            className="bg-green-600 hover:bg-green-700 text-white w-full"
                        >
                            Answer
                        </Button>
                    )}
                    {isAnswered && onStartScreenShare && onStopScreenShare && (
                        <Button
                            onClick={isSharingScreen ? onStopScreenShare : onStartScreenShare}
                            variant="outline"
                            className={`flex items-center gap-2 ${isSharingScreen
                                    ? "border-purple-500/50 text-purple-400 bg-purple-500/10 hover:bg-purple-500/20"
                                    : "border-slate-700 bg-slate-900/50 hover:bg-slate-800"
                                }`}
                        >
                            {isSharingScreen ? (
                                <><MonitorOff className="w-4 h-4" /> Stop Sharing</>
                            ) : (
                                <><Monitor className="w-4 h-4" /> Share Tab Audio</>
                            )}
                        </Button>
                    )}
                    <Button
                        onClick={handleEnd}
                        variant="destructive"
                        className="w-full"
                    >
                        End Call
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
