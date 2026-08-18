"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { useHardwareSync } from "@/hooks/useHardwareSync";
import { useZKTeco } from "@/hooks/useZKTeco";

type AlertPayload = {
  key: string;
  memberName: string;
  duesAmount?: number;
  daysSincePayment?: number;
  reason: string;
};

const playTripleBeep = () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const beep = (delay: number) => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime + delay); // High pitch

      // Full volume with longer sustain (dash instead of dot)
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime + delay);
      gainNode.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + delay + 0.05); // Full 1.0 volume
      gainNode.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + delay + 0.4); // Hold for 400ms
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + delay + 0.6);   // Fade out

      oscillator.start(audioCtx.currentTime + delay);
      oscillator.stop(audioCtx.currentTime + delay + 0.6);
    };

    // Play 3 longer "dash" beeps
    beep(0);
    beep(0.8);
    beep(1.6);
  } catch {
    // Ignore audio failures
  }
};

export function GlobalPaymentAlert() {
  // Keep scanner sync active globally so events are processed on every page.
  useHardwareSync();
  const { lastEvent } = useZKTeco();

  useEffect(() => {
    if (lastEvent) console.log('[GlobalPaymentAlert] lastEvent changed:', lastEvent.status, lastEvent.member?.name);
  }, [lastEvent]);

  const [activeAlert, setActiveAlert] = useState<AlertPayload | null>(null);
  const lastHandledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lastEvent || lastEvent.status !== "denied") return;

    const memberId = lastEvent.member?.id || "unknown";
    const key = `${memberId}-${lastEvent.timestamp}`;
    
    if (key === lastHandledKeyRef.current) return;
    lastHandledKeyRef.current = key;

    console.log('[GlobalPaymentAlert] 🚨 Denied scan detected! Triggering alert for:', lastEvent.member?.name);

    const isUnregistered = lastEvent.duesInfo == null && lastEvent.member?.id == null;
    const defaultReason = isUnregistered ? "Unregistered Scanner ID" : (lastEvent.duesInfo ? "Outstanding Balance" : "Cycle Expired / Insufficient Balance");

    setActiveAlert({
      key,
      memberName: lastEvent.member?.name || "Unknown Identity",
      duesAmount: lastEvent.duesInfo?.balance,
      daysSincePayment: lastEvent.duesInfo?.days,
      reason: lastEvent.notes || defaultReason,
    });

    playTripleBeep();
  }, [lastEvent]);

  if (!activeAlert) return null;

  const isUnregisteredAlert = activeAlert.duesAmount == null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/90 backdrop-blur-md animate-in fade-in duration-300">
      <Card className="w-full max-w-md border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.5)] animate-in zoom-in duration-300">
        <CardHeader className="bg-red-600 text-white rounded-t-xl border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <CardTitle className="text-xl italic font-black">ACCESS DENIED</CardTitle>
              <CardDescription className="text-red-100 uppercase text-[10px] font-bold tracking-[0.2em]">
                Security Alert - {isUnregisteredAlert ? "Unregistered Scanner ID" : activeAlert.reason}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-8 text-center space-y-6">
          <div>
            <h3 className="text-3xl font-black text-foreground italic">{activeAlert.memberName}</h3>
            <p className="text-red-500 font-bold uppercase tracking-[0.3em] text-xs mt-2 italic shadow-red-500">
              {isUnregisteredAlert ? "Unregistered Scanner ID" : activeAlert.reason}
            </p>
          </div>

          {activeAlert.duesAmount != null ? (
            <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20 text-left space-y-1">
               <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Unpaid Amount</p>
                    <p className="text-2xl font-black text-red-500 italic">PKR {activeAlert.duesAmount}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Billing Delay</p>
                    <p className="text-sm font-bold text-foreground">{activeAlert.daysSincePayment} Days</p>
                  </div>
               </div>
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-red-500/5 border border-red-500/20">
               <p className="text-sm text-red-400 font-bold italic tracking-wider">
                 THIS SCANNER ID IS NOT MAPPED TO ANY MEMBER IN THE SYSTEM. PLEASE ASSIGN THIS ID IN ID MAPPING / EDIT PROFILE.
               </p>
            </div>
          )}

          <div className="flex gap-3">
             <Button
               onClick={() => setActiveAlert(null)}
               className="flex-1 h-12 bg-red-600 hover:bg-red-700 text-white font-black italic tracking-wider shadow-lg shadow-red-600/20 transition-all active:scale-95"
             >
               ACKNOWLEDGE
             </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
