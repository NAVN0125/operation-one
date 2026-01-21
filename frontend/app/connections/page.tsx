"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePresence } from "@/hooks/use-presence";
import { Search, UserPlus, Phone, ArrowLeft, LogOut, Trash2 } from "lucide-react";

interface Connection {
    id: number;
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
}

export default function ConnectionsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { isUserOnline } = usePresence();
    const [connections, setConnections] = useState<Connection[]>([]);
    const [searchCode, setSearchCode] = useState("");
    const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

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

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/login");
            return;
        }

        if (status === "authenticated") {
            fetchConnections();
        }
    }, [status, router]);

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

    const handleSearch = async () => {
        if (!searchCode.trim()) return;

        setIsSearching(true);
        setSearchError(null);
        setSearchResult(null);

        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(
                `/service/api/users/search?code=${searchCode.toUpperCase()}`,
                {
                    headers: {
                        Authorization: `Bearer ${backendToken}`,
                    },
                }
            );

            if (response.ok) {
                const data = await response.json();
                setSearchResult(data);
            } else if (response.status === 404) {
                setSearchError("No user found with that code");
            } else {
                setSearchError("Search failed");
            }
        } catch (error) {
            console.error("Error searching:", error);
            setSearchError("Search failed");
        } finally {
            setIsSearching(false);
        }
    };

    const handleAddConnection = async () => {
        if (!searchResult) return;

        setIsAdding(true);
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch("/service/api/users/me/connections", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({ user_id: searchResult.id }),
            });

            if (response.ok) {
                setSearchResult(null);
                setSearchCode("");
                fetchConnections();
            }
        } catch (error) {
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
                `/service/api/users/me/connections/${userId}`,
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

    if (status === "loading") {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <p className="text-slate-400">Loading...</p>
            </div>
        );
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
                            <Link href="/dashboard">
                                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-slate-800">
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Dashboard
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
                <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
                    {/* Page Title */}
                    <div>
                        <h1 className="text-2xl font-bold">Connections</h1>
                        <p className="text-slate-400 text-sm">Manage your contacts and call history</p>
                    </div>

                    {/* Add Connection Card */}
                    <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold mb-1">Add Connection</h2>
                        <p className="text-slate-400 text-sm mb-4">
                            Enter a connection code to add someone
                        </p>

                        <div className="flex gap-3">
                            <Input
                                value={searchCode}
                                onChange={(e) => setSearchCode(e.target.value.toUpperCase())}
                                placeholder="Enter code (e.g., ABC12345)"
                                className="bg-slate-950/50 border-slate-700 text-white focus:border-blue-500 font-mono tracking-wider"
                                maxLength={8}
                            />
                            <Button
                                onClick={handleSearch}
                                disabled={isSearching || !searchCode.trim()}
                                className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20"
                            >
                                <Search className="w-4 h-4 mr-2" />
                                {isSearching ? "..." : "Search"}
                            </Button>
                        </div>

                        {searchError && (
                            <p className="text-red-400 text-sm mt-3">{searchError}</p>
                        )}

                        {searchResult && (
                            <div className="mt-4 p-4 rounded-xl bg-slate-950/50 border border-slate-700 flex items-center justify-between">
                                <div>
                                    <p className="font-medium">
                                        {searchResult.display_name || searchResult.name || "Unknown User"}
                                    </p>
                                    <p className="text-sm text-slate-400">Found user</p>
                                </div>
                                <Button
                                    onClick={handleAddConnection}
                                    disabled={isAdding}
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-500"
                                >
                                    <UserPlus className="w-4 h-4 mr-2" />
                                    {isAdding ? "Adding..." : "Add"}
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Connections List */}
                    <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold mb-4">Your Connections</h2>

                        {connections.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-slate-400">No connections yet</p>
                                <p className="text-slate-500 text-sm mt-1">
                                    Add a connection using their code above
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {connections.map((connection) => (
                                    <div
                                        key={connection.id}
                                        className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 flex items-center justify-between hover:bg-slate-900/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`h-3 w-3 rounded-full ${connection.is_online ? "bg-green-500" : "bg-slate-600"}`} />
                                            <div>
                                                <p className="font-medium">
                                                    {connection.connected_user_display_name || connection.connected_user_name || "Unknown"}
                                                </p>
                                                <p className="text-sm text-slate-500">
                                                    {connection.is_online ? "Online" : "Offline"}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                onClick={() => router.push(`/dashboard?callUser=${connection.connected_user_id}`)}
                                                disabled={!connection.is_online}
                                                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Phone className="w-4 h-4 mr-2" />
                                                Call
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleRemoveConnection(connection.connected_user_id)}
                                                className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}
