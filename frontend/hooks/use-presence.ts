"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";

interface PresenceUpdate {
    type: "presence_update";
    user_id: number;
    is_online: boolean;
}

interface HeartbeatMessage {
    type: "heartbeat";
}

interface IncomingCallMessage {
    type: "incoming_call";
    call_id: number;
    caller_id: number;
    caller_name: string | null;
    caller_display_name?: string | null;
    room_name: string;
}

type PresenceMessage = PresenceUpdate | HeartbeatMessage | IncomingCallMessage;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API_URL.replace("http", "ws");

export function usePresence() {
    const { data: session } = useSession();
    const [isConnected, setIsConnected] = useState(false);
    const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
    const [incomingCall, setIncomingCall] = useState<IncomingCallMessage | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const getBackendToken = useCallback(async (): Promise<string | null> => {
        if (!session?.idToken) return null;

        try {
            const response = await fetch(`${API_URL}/api/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_token: session.idToken }),
            });

            if (!response.ok) return null;
            const data = await response.json();
            return data.access_token;
        } catch (error) {
            console.error("Error getting backend token:", error);
            return null;
        }
    }, [session?.idToken]);

    const isConnectingRef = useRef(false);

    const connect = useCallback(async () => {
        if (!session?.idToken || isConnectingRef.current) return;

        // If already connected or connecting, don't do anything
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            return;
        }

        isConnectingRef.current = true;
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) {
                isConnectingRef.current = false;
                return;
            }

            // Close existing stagnant connection if any
            if (wsRef.current) {
                wsRef.current.onclose = null; // Prevent reconnect loop from old instance
                wsRef.current.close();
            }

            const ws = new WebSocket(
                `${WS_URL}/ws/presence?token=${backendToken}`
            );

            ws.onopen = () => {
                console.log("Presence WebSocket connected");
                setIsConnected(true);
                isConnectingRef.current = false;

                // Start heartbeat
                heartbeatIntervalRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "heartbeat_response" }));
                    }
                }, 30000); // Send heartbeat every 30 seconds
            };

            ws.onmessage = (event) => {
                try {
                    const message: PresenceMessage = JSON.parse(event.data);

                    if (message.type === "presence_update") {
                        setOnlineUsers((prev) => {
                            const newSet = new Set(prev);
                            if (message.is_online) {
                                newSet.add(message.user_id);
                            } else {
                                newSet.delete(message.user_id);
                            }
                            return newSet;
                        });
                    } else if (message.type === "heartbeat") {
                        // Server sent heartbeat, respond
                        ws.send(JSON.stringify({ type: "heartbeat_response" }));
                    } else if (message.type === "incoming_call") {
                        setIncomingCall(message);
                    }
                } catch (error) {
                    console.error("Error parsing presence message:", error);
                }
            };

            ws.onerror = (error) => {
                console.error("Presence WebSocket error:", error);
                isConnectingRef.current = false;
            };

            ws.onclose = () => {
                console.log("Presence WebSocket disconnected");
                setIsConnected(false);
                isConnectingRef.current = false;
                wsRef.current = null;

                // Clear heartbeat interval
                if (heartbeatIntervalRef.current) {
                    clearInterval(heartbeatIntervalRef.current);
                }

                // Attempt to reconnect after 3 seconds
                reconnectTimeoutRef.current = setTimeout(() => {
                    console.log("Attempting to reconnect presence WebSocket...");
                    connect();
                }, 3000);
            };

            wsRef.current = ws;
        } catch (error) {
            console.error("Failed to connect to presence WebSocket:", error);
            isConnectingRef.current = false;
        }
    }, [session?.idToken, getBackendToken]);

    useEffect(() => {
        if (session?.idToken) {
            connect();
        }

        return () => {
            // Cleanup on unmount
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (heartbeatIntervalRef.current) {
                clearInterval(heartbeatIntervalRef.current);
            }
            if (wsRef.current) {
                wsRef.current.onclose = null; // IMPORTANT: prevent reconnect from cleanup
                wsRef.current.close();
                wsRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.idToken]);

    const isUserOnline = useCallback(
        (userId: number) => {
            return onlineUsers.has(userId);
        },
        [onlineUsers]
    );

    return {
        isConnected,
        onlineUsers,
        isUserOnline,
        incomingCall,
        clearIncomingCall: () => setIncomingCall(null),
    };
}
