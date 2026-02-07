"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, RefreshCw, Check, Phone, ArrowLeft, LogOut } from "lucide-react";

interface UserProfile {
    id: number;
    email: string;
    name: string | null;
    display_name: string | null;
    connection_code: string | null;
    connection_code_expires_at: string | null;
}

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

        // Handle token refresh errors
        if (session?.error === "RefreshAccessTokenError") {
            signOut();
            return;
        }

        if (status === "authenticated") {
            fetchProfile();
        }
    }, [status, router, session?.error]);

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

            const response = await fetch(`/service/api/users/me/profile`, {
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

            const response = await fetch(`/service/api/users/me/profile`, {
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

            const response = await fetch(`/service/api/users/me/refresh-code`, {
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
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
                <p className="text-slate-400">Loading profile...</p>
                <Button variant="outline" size="sm" onClick={() => signOut()} className="border-slate-700 text-slate-300">
                    Sign Out & Re-login
                </Button>
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
                        <h1 className="text-2xl font-bold">Profile</h1>
                        <p className="text-slate-400 text-sm">Manage your account settings</p>
                    </div>

                    {/* Connection Code Card */}
                    <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold mb-1">Your Connection Code</h2>
                        <p className="text-slate-400 text-sm mb-4">
                            Share this code with others to connect. It expires in 5 minutes.
                        </p>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex-1 bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                                <p className="text-3xl font-mono font-bold text-center tracking-wider">
                                    {profile.connection_code || "LOADING"}
                                </p>
                            </div>
                            <Button
                                size="icon"
                                onClick={handleCopyCode}
                                className="h-12 w-12 bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20"
                            >
                                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                            </Button>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="text-sm">
                                <span className="text-slate-400">Expires in: </span>
                                <span className={`font-mono font-semibold ${timeRemaining === "Expired" ? "text-red-400" : "text-green-400"}`}>
                                    {timeRemaining}
                                </span>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRefreshCode}
                                disabled={isRefreshing}
                                className="border-slate-700 bg-slate-900/50 hover:bg-slate-800"
                            >
                                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                                Refresh Code
                            </Button>
                        </div>
                    </div>

                    {/* Profile Info Card */}
                    <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 backdrop-blur-sm space-y-4">
                        <h2 className="text-lg font-semibold">Profile Information</h2>

                        <div>
                            <label className="text-sm text-slate-400">Email</label>
                            <p className="text-white mt-1">{profile.email}</p>
                        </div>

                        <div>
                            <label className="text-sm text-slate-400">Display Name</label>
                            {isEditing ? (
                                <div className="flex gap-2 mt-1">
                                    <Input
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        className="bg-slate-950/50 border-slate-700 text-white focus:border-blue-500"
                                        placeholder="Enter display name"
                                    />
                                    <Button
                                        onClick={handleSaveDisplayName}
                                        disabled={isSaving}
                                        className="bg-blue-600 hover:bg-blue-500"
                                    >
                                        {isSaving ? "Saving..." : "Save"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => setIsEditing(false)}
                                        className="border-slate-700 hover:bg-slate-800"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between mt-1">
                                    <p className="text-white">
                                        {profile.display_name || profile.name || "Not set"}
                                    </p>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setIsEditing(true)}
                                        className="border-slate-700 bg-slate-900/50 hover:bg-slate-800"
                                    >
                                        Edit
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
