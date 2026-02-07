import "next-auth";
import { JWT } from "next-auth/jwt";

declare module "next-auth" {
    interface Session {
        idToken?: string;
        error?: string;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        idToken?: string;
        accessToken?: string;
        refreshToken?: string;
        idTokenExpires?: number;
        error?: string;
    }
}

