"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Lock, Loader2 } from "lucide-react";
import { dbService } from "@/lib/supabase";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const [isLoadingCredentials, setIsLoadingCredentials] = useState(true);

  useEffect(() => {
    const init = async () => {
      setIsMounted(true);

      // Check if already logged in first
      const auth = sessionStorage.getItem("iron_ledger_auth_v2");
      if (auth === "true") {
        setIsAuthenticated(true);
        setIsLoadingCredentials(false);
        return;
      }

      // Always fetch credentials from Supabase (source of truth),
      // so all devices see the same password.
      try {
        await dbService.loadSettingsAndPackages();
      } catch {
        // Silently fall back to in-memory defaults on error
      } finally {
        setIsLoadingCredentials(false);
      }
    };
    init();
  }, []);

  if (!isMounted) return null; // Avoid hydration mismatch

  if (isAuthenticated) {
    return <>{children}</>;
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();

    // Read credentials from the freshly-loaded cached settings (populated above)
    const settings = dbService.getCachedSettings();
    const expectedUser = settings?.adminUser || "Admin";
    const expectedPass = settings?.adminPass;

    // If no password is configured at all, block access entirely
    if (!expectedPass) {
      setError("Could not load credentials. Please check your connection and refresh.");
      return;
    }

    if (username === expectedUser && password === expectedPass) {
      sessionStorage.setItem("iron_ledger_auth_v2", "true");
      setIsAuthenticated(true);
      setError("");
    } else {
      setError("Invalid credentials. Try again.");
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 via-background to-background"></div>
      <Card className="w-full max-w-md relative z-10 bg-card/50 backdrop-blur-xl border-border shadow-2xl animate-in fade-in zoom-in duration-500 pt-6">
         <CardHeader className="text-center space-y-2">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20 shadow-[0_0_20px_1px_rgba(16,185,129,0.3)]">
               <Lock className="w-8 h-8" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">WORKOUT CHAPTER 1</CardTitle>
            <CardDescription>Authentication required for Workout Chapter 1</CardDescription>
         </CardHeader>
         <CardContent>
            {isLoadingCredentials ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                <p className="text-xs uppercase tracking-widest font-bold">Verifying credentials...</p>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-6">
                 <div className="space-y-2">
                    <Label htmlFor="username">Admin Username</Label>
                    <Input 
                       id="username" 
                       type="text" 
                       placeholder="e.g. Admin" 
                       value={username} 
                       onChange={e => setUsername(e.target.value)} 
                       required 
                       className="bg-background/80" 
                    />
                 </div>
                 <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input 
                       id="password" 
                       type="password" 
                       placeholder="••••••••" 
                       value={password} 
                       onChange={e => setPassword(e.target.value)} 
                       required 
                       className="bg-background/80" 
                    />
                 </div>
                 {error && (
                    <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-md text-center">
                       <p className="text-sm font-medium text-red-500">{error}</p>
                    </div>
                 )}
                 <Button type="submit" className="w-full text-base py-5 font-semibold transition-all hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:scale-[1.02]">
                   Unlock Dashboard
                 </Button>
              </form>
            )}
         </CardContent>
      </Card>
    </div>
  );
}
