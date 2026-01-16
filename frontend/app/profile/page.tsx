"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, RefreshCw, Check } from "lucide-react";

interface UserProfile {
    id: number;
    email: string;
    name: string | null;
    display_name: string | null;
    connection_code: string | null;
    connection_code_expires_at: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ProfilePage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [displayName, setDisplayName] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [copied, setCopied] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState<string>("");

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

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/dashboard");
            return;
        }

        if (status === "authenticated") {
            fetchProfile();
        }
    }, [status, router]);

    useEffect(() => {
        if (!profile?.connection_code_expires_at) return;

        const interval = setInterval(() => {
            const expiresAt = new Date(profile.connection_code_expires_at!);
            const now = new Date();
            const diff = expiresAt.getTime() - now.getTime();

            if (diff <= 0) {
                if (!isFetching && !isRefreshing) {
                    setTimeRemaining("Refreshing...");
                    fetchProfile();
                }
            } else {
                const totalSeconds = Math.floor(diff / 1000);
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, "0")}`);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [profile?.connection_code_expires_at, isFetching, isRefreshing]);

    const fetchProfile = async () => {
        if (isFetching) return;
        setIsFetching(true);
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(`${API_URL}/api/users/me/profile`, {
                headers: {
                    Authorization: `Bearer ${backendToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                setProfile(data);
                setDisplayName(data.display_name || data.name || "");
            }
        } catch (error) {
            console.error("Error fetching profile:", error);
        } finally {
            setIsFetching(false);
        }
    };

    const handleSaveDisplayName = async () => {
        setIsSaving(true);
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(`${API_URL}/api/users/me/profile`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${backendToken}`,
                },
                body: JSON.stringify({ display_name: displayName }),
            });

            if (response.ok) {
                const data = await response.json();
                setProfile(data);
                setIsEditing(false);
            }
        } catch (error) {
            console.error("Error updating profile:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleRefreshCode = async () => {
        setIsRefreshing(true);
        try {
            const backendToken = await getBackendToken();
            if (!backendToken) return;

            const response = await fetch(`${API_URL}/api/users/me/refresh-code`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${backendToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                setProfile(data);
            }
        } catch (error) {
            console.error("Error refreshing code:", error);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleCopyCode = () => {
        if (profile?.connection_code) {
            navigator.clipboard.writeText(profile.connection_code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    if (!profile) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8 flex flex-col items-center justify-center space-y-4">
                <p className="text-slate-400">Loading profile...</p>
                <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-slate-500">Stuck? Your session might have expired.</p>
                    <Button variant="outline" size="sm" onClick={() => signOut()}>
                        Sign Out & Re-login
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
            <div className="max-w-2xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                    <h1 className="text-3xl font-bold text-white">Profile</h1>
                    <Button variant="outline" onClick={() => router.push("/dashboard")}>
                        Back to Dashboard
                    </Button>
                </div>

                {/* Connection Code Card */}
                <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
                    <CardHeader>
                        <CardTitle className="text-white">Your Connection Code</CardTitle>
                        <CardDescription className="text-slate-400">
                            Share this code with others to connect. It expires in 5 minutes.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 bg-slate-800 p-4 rounded-lg border border-slate-700">
                                <p className="text-3xl font-mono font-bold text-white tracking-wider text-center">
                                    {profile.connection_code || "LOADING"}
                                </p>
                            </div>
                            <Button
                                size="icon"
                                onClick={handleCopyCode}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                            </Button>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="text-sm">
                                <span className="text-slate-400">Expires in: </span>
                                <span className={`font-mono font-semibold ${timeRemaining === "Expired" ? "text-red-400" : "text-green-400"
                                    }`}>
                                    {timeRemaining}
                                </span>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRefreshCode}
                                disabled={isRefreshing}
                                className="border-slate-600 text-white hover:bg-slate-800"
                            >
                                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                                Refresh Code
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Profile Info Card */}
                <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-700">
                    <CardHeader>
                        <CardTitle className="text-white">Profile Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <label className="text-sm text-slate-400">Email</label>
                            <p className="text-white">{profile.email}</p>
                        </div>

                        <div>
                            <label className="text-sm text-slate-400">Display Name</label>
                            {isEditing ? (
                                <div className="flex gap-2 mt-1">
                                    <Input
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        className="bg-slate-800 border-slate-700 text-white"
                                        placeholder="Enter display name"
                                    />
                                    <Button onClick={handleSaveDisplayName} disabled={isSaving}>
                                        {isSaving ? "Saving..." : "Save"}
                                    </Button>
                                    <Button variant="outline" onClick={() => setIsEditing(false)}>
                                        Cancel
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between mt-1">
                                    <p className="text-white">
                                        {profile.display_name || profile.name || "Not set"}
                                    </p>
                                    <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                                        Edit
                                    </Button>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
