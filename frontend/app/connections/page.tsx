"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectionList } from "@/components/connections/connection-list";
import { usePresence } from "@/hooks/use-presence";
import { Search, UserPlus } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Connection {
    id: number;
    user_id: number;
    connected_user_id: number;
    connected_user_name: string | null;
    connected_user_display_name: string | null;
    is_online: boolean;
    created_at: string;
}

interface SearchResult {
    id: number;
    name: string | null;
    display_name: string | null;
    email: string;
}

export default function ConnectionsPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const { isUserOnline } = usePresence();
    const [connections, setConnections] = useState<Connection[]>([]);
    const [searchCode, setSearchCode] = useState("");
    const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getBackendToken = async (): Promise<string | null> => {
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
    };

    useEffect(() => {
        if (!session) {
            router.push("/dashboard");
            return;
        }

        fetchConnections();
    }, [session, router]);

    // Update online status in real-time
    useEffect(() => {
        setConnections((prev) =>
            prev.map((conn) => ({
                ...conn,
                is_online: isUserOnline(conn.connected_user_id),
            }))
        );
    }, [isUserOnline]);

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

    const handleSearch = async () => {
        if (!searchCode.trim()) return;

        setIsSearching(true);
        setError(null);
        setSearchResult(null);

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(
                `http://localhost:8000/api/users/search?code=${searchCode.toUpperCase()}`,
                {
                    headers: {
                        Authorization: `Bearer ${backendToken}`,
                    },
                }
            );

            if (response.ok) {
                const data = await response.json();
                setSearchResult(data);
            } else {
                const errorData = await response.json();
                setError(errorData.detail || "User not found");
            }
        } catch (error) {
            setError("Error searching for user");
            console.error("Error searching:", error);
        } finally {
            setIsSearching(false);
        }
    };

    const handleAddConnection = async () => {
        if (!searchCode.trim()) return;

        setIsAdding(true);
        setError(null);

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch("http://localhost:8000/api/users/me/connections", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({ connection_code: searchCode.toUpperCase() }),
            });

            if (response.ok) {
                setSearchCode("");
                setSearchResult(null);
                fetchConnections();
            } else {
                const errorData = await response.json();
                setError(errorData.detail || "Failed to add connection");
            }
        } catch (error) {
            setError("Error adding connection");
            console.error("Error adding connection:", error);
        } finally {
            setIsAdding(false);
        }
    };

    const handleRemoveConnection = async (userId: number) => {
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(
                `http://localhost:8000/api/users/me/connections/${userId}`,
                {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${backendToken}`,
                    },
                }
            );

            if (response.ok) {
                fetchConnections();
            }
        } catch (error) {
            console.error("Error removing connection:", error);
        }
    };

    const handleCall = (userId: number) => {
        // Navigate to dashboard with the selected user
        router.push(`/dashboard?callUser=${userId}`);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                    <h1 className="text-3xl font-bold text-white">Connections</h1>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => router.push("/profile")}>
                            My Profile
                        </Button>
                        <Button variant="outline" onClick={() => router.push("/dashboard")}>
                            Dashboard
                        </Button>
                    </div>
                </div>

                {/* Search and Add Connection */}
                <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
                    <CardHeader>
                        <CardTitle className="text-white">Add New Connection</CardTitle>
                        <CardDescription className="text-slate-400">
                            Enter someone's connection code to add them
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex gap-2">
                            <Input
                                placeholder="Enter 8-character code"
                                value={searchCode}
                                onChange={(e) => setSearchCode(e.target.value.toUpperCase())}
                                maxLength={8}
                                className="bg-slate-800 border-slate-700 text-white font-mono text-lg"
                                onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                            />
                            <Button
                                onClick={handleSearch}
                                disabled={isSearching || searchCode.length !== 8}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                <Search className="h-4 w-4 mr-2" />
                                {isSearching ? "Searching..." : "Search"}
                            </Button>
                        </div>

                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500 rounded-lg">
                                <p className="text-red-400 text-sm">{error}</p>
                            </div>
                        )}

                        {searchResult && (
                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 flex items-center justify-between">
                                <div>
                                    <p className="text-white font-medium">
                                        {searchResult.display_name || searchResult.name || "Unknown User"}
                                    </p>
                                    <p className="text-sm text-slate-400">{searchResult.email}</p>
                                </div>
                                <Button
                                    onClick={handleAddConnection}
                                    disabled={isAdding}
                                    className="bg-green-600 hover:bg-green-700"
                                >
                                    <UserPlus className="h-4 w-4 mr-2" />
                                    {isAdding ? "Adding..." : "Add Connection"}
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Connections List */}
                <ConnectionList
                    connections={connections}
                    onCall={handleCall}
                    onRemove={handleRemoveConnection}
                />
            </div>
        </div>
    );
}
