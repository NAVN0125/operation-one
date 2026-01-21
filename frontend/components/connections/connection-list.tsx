"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, UserMinus } from "lucide-react";

interface Connection {
    id: number;
    connected_user_id: number;
    connected_user_name: string | null;
    connected_user_display_name: string | null;
    is_online: boolean;
    created_at: string;
}

interface ConnectionListProps {
    connections: Connection[];
    onCall: (userId: number) => void;
    onRemove: (userId: number) => void;
    isLoading?: boolean;
}

export function ConnectionList({
    connections,
    onCall,
    onRemove,
    isLoading = false,
}: ConnectionListProps) {
    if (isLoading) {
        return (
            <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
                <CardContent className="pt-6">
                    <p className="text-slate-400 text-center">Loading connections...</p>
                </CardContent>
            </Card>
        );
    }

    if (connections.length === 0) {
        return (
            <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
                <CardContent className="pt-6">
                    <p className="text-slate-400 text-center">
                        No connections yet. Add someone using their connection code!
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
            <CardContent>
                <div className="space-y-3">
                    {connections.map((connection) => (
                        <div
                            key={connection.id}
                            className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                {/* Online status indicator */}
                                <div className="relative">
                                    <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-white font-semibold">
                                        {(connection.connected_user_display_name ||
                                            connection.connected_user_name ||
                                            "?")[0].toUpperCase()}
                                    </div>
                                    <span
                                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-800 ${connection.is_online ? "bg-green-500" : "bg-gray-500"
                                            }`}
                                    />
                                </div>

                                <div>
                                    <p className="text-white font-medium">
                                        {connection.connected_user_display_name ||
                                            connection.connected_user_name ||
                                            "Unknown User"}
                                    </p>
                                    <p className="text-sm text-slate-400">
                                        {connection.is_online ? "Online" : "Offline"}
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    onClick={() => onCall(connection.connected_user_id)}
                                    disabled={!connection.is_online}
                                    className="bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500"
                                >
                                    <Phone className="h-4 w-4 mr-1" />
                                    Call
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => onRemove(connection.connected_user_id)}
                                    className="border-red-500 text-red-500 hover:bg-red-500/10"
                                >
                                    <UserMinus className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
