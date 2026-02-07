import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

async function refreshAccessToken(token: any) {
    try {
        const url = "https://oauth2.googleapis.com/token";
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID!,
                client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                grant_type: "refresh_token",
                refresh_token: token.refreshToken,
            }),
        });

        const refreshedTokens = await response.json();

        if (!response.ok) {
            console.error("Failed to refresh token:", refreshedTokens);
            throw refreshedTokens;
        }

        return {
            ...token,
            idToken: refreshedTokens.id_token,
            accessToken: refreshedTokens.access_token,
            // Google returns expires_in as seconds
            idTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
            // Fall back to old refresh token if a new one wasn't provided
            refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
        };
    } catch (error) {
        console.error("Error refreshing access token:", error);
        return {
            ...token,
            error: "RefreshAccessTokenError",
        };
    }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    trustHost: true,
    providers: [
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            authorization: {
                params: {
                    // Request refresh token and offline access
                    prompt: "consent",
                    access_type: "offline",
                    response_type: "code",
                },
            },
        }),
    ],
    callbacks: {
        async jwt({ token, account }) {
            // Initial sign in - persist all tokens and expiry
            if (account) {
                return {
                    ...token,
                    idToken: account.id_token,
                    accessToken: account.access_token,
                    refreshToken: account.refresh_token,
                    // Google ID tokens expire in 1 hour (3600 seconds)
                    // We refresh 5 minutes early to be safe
                    idTokenExpires: Date.now() + (account.expires_in as number - 300) * 1000,
                };
            }

            // Return token if the ID token has not expired yet
            if (Date.now() < (token.idTokenExpires as number)) {
                return token;
            }

            // ID token has expired, try to refresh it
            console.log("ID token expired, refreshing...");
            return await refreshAccessToken(token);
        },
        async session({ session, token }) {
            // Attach the ID token to the session for backend auth
            session.idToken = token.idToken as string;
            // Pass error to client if refresh failed
            if (token.error) {
                session.error = token.error as string;
            }
            return session;
        },
    },
});
