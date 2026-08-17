"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback } from "react";
import { ScannerLiveStatus } from "@/components/ScannerLiveStatus";
import { dbService, supabase } from "@/lib/supabase";
import { memberCache } from "@/lib/member-cache";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { Activity, Dumbbell, Settings, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normalizeDeviceTimestamp } from "@/lib/utils";

type AccessChartPoint = {
  month: string;
  approved: number;
  blocked_unpaid: number;
};

const monthLabels = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const chartConfig = {
  approved: {
    label: "Access Granted",
    color: "#10b981", 
  },
  blocked_unpaid: {
    label: "Access Denied (Unpaid)",
    color: "#ef4444",
  },
} satisfies ChartConfig;

const formatRelativeTime = (value: unknown) => {
   if (!value) return "Unknown";

   // Normalize the timestamp to ensure it's treated as UTC if no TZ info is present
   const normalized = normalizeDeviceTimestamp(value);
   const date = new Date(String(normalized));
   
   if (Number.isNaN(date.getTime())) return "Unknown";

   try {
      return formatDistanceToNow(date, { addSuffix: true });
   } catch {
      return "Unknown";
   }
};

const formatCalendarDate = (value: unknown) => {
   if (!value) return "NEVER";

   const normalized = normalizeDeviceTimestamp(value);
   const date = new Date(String(normalized));
   
   if (Number.isNaN(date.getTime())) return "NEVER";

   return date.toLocaleDateString("en-GB");
};

export default function Dashboard() {
  const [logs, setLogs] = useState<any[]>([]);
  const [memberAnalytics, setMemberAnalytics] = useState<any[]>([]);
  
  // Modal States
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showSegmentationModal, setShowSegmentationModal] = useState(false);
  const [twentyFourHourSummary, setTwentyFourHourSummary] = useState<any[]>([]);
   const [accessData, setAccessData] = useState<AccessChartPoint[]>([]);
   const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
   const [searchQuery, setSearchQuery] = useState("");

  const fetchLogs = async () => {
    const recent = await dbService.getRecentLogs();
    // Enrich logs with member data from cache if the Supabase join didn't populate it
    const enriched = (recent || []).map((log: any) => {
      if (!log.members?.name && log.member_id) {
        const m = memberCache.getMemberById(log.member_id);
        if (m) {
          return { ...log, members: { name: m.name, phone: m.phone, photo_url: m.photo_url } };
        }
      }
      return log;
    });
    setLogs(enriched);
  };

  const fetchAnalytics = async () => {
    const data = await dbService.getMemberAnalytics();
    setMemberAnalytics(data || []);
  };

  const fetch24hSummary = async () => {
    // Use the local cache which already holds the last 24h/1000 logs
    const recentCached = memberCache.getRecentLogs(1000);
    
    // Group by unique identity
    const summaryMap: Record<string, any> = {};
    recentCached.forEach((log: any) => {
       const member = log.member_id ? memberCache.getMemberById(log.member_id) : null;
       let displayName = member?.name;
       let hardwareId = member?.zk_id;

       if (!hardwareId) {
          let payload = log.payload;
          if (typeof payload === 'string') {
             try { payload = JSON.parse(payload); } catch { payload = {}; }
          }
          hardwareId = payload?.user_id || payload?.uid || payload?.normalizedUserId || payload?.userId;
       }

       // Use the most unique key possible for grouping
       const groupKey = log.member_id || (hardwareId ? `hw-${hardwareId}` : `log-${log.id}`);

       if (!summaryMap[groupKey]) {
          if (!displayName) displayName = hardwareId ? `Unregistered (${hardwareId})` : `Unknown Scanner`;
          
          summaryMap[groupKey] = {
             id: groupKey,
             name: displayName,
             hardwareId: hardwareId || 'N/A',
             timestamp: log.timestamp,
             status: log.status,
             count: 0
          };
       }

       summaryMap[groupKey].count++;
       
       // Always keep the MOST RECENT timestamp
       if (new Date(log.timestamp) > new Date(summaryMap[groupKey].timestamp)) {
          summaryMap[groupKey].timestamp = log.timestamp;
       }
    });

    // Convert to array and sort by most recent scan time
    const finalSummary = Object.values(summaryMap).sort((a: any, b: any) => 
       new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    setTwentyFourHourSummary(finalSummary);
  };

  const fetchChartData = async () => {
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const rangeStart = new Date(currentYear, 0, 1, 0, 0, 0, 0).toISOString();
      const rangeEnd = new Date(currentYear, 11, 31, 23, 59, 59, 999).toISOString();

      const attendanceLogs = await dbService.getAttendanceByRange(rangeStart, rangeEnd);

      const accessByMonth: AccessChartPoint[] = monthLabels.map((label) => ({
        month: label,
        approved: 0,
        blocked_unpaid: 0,
      }));

      (attendanceLogs || []).forEach((log: any) => {
        const logDate = new Date(log.timestamp);
        if (Number.isNaN(logDate.getTime()) || logDate.getFullYear() !== currentYear) return;

        const monthIdx = logDate.getMonth();
        const status = String(log.status || "").toLowerCase();
        const hasPaymentNote = !!String(log.notes || "").trim();

        if (status === "granted") {
          accessByMonth[monthIdx].approved += 1;
        } else if (status === "denied" && hasPaymentNote) {
          accessByMonth[monthIdx].blocked_unpaid += 1;
        }
      });
      setAccessData(accessByMonth);
    } catch (e) {
      console.error(e);
    }
  };

  // Refresh all dashboard state from cache (instant, no network)
   const refreshFromCache = useCallback(() => {
     fetchLogs();
     fetchAnalytics();
     fetch24hSummary();
   }, []);

   useEffect(() => {
    // Initialize cache (one-time full fetch from Supabase)
    memberCache.initialize().then(() => {
      refreshFromCache();
      fetchChartData();
    });

    // Subscribe to cache changes (triggered by Realtime or local mutations)
    const unsub = memberCache.subscribe(refreshFromCache);

    // Subscribe to ledger_entries explicitly since memberCache doesn't track it
    const ledgerChannel = supabase
      ? supabase.channel('dashboard_ledger')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_entries' }, () => {
            console.log("Realtime: ledger_entries changed, fetching 24h summary...");
            fetch24hSummary();
          })
          .subscribe()
      : null;

    // Safety net: full refresh every 5 minutes
    const interval = setInterval(() => {
      memberCache.forceRefresh();
      fetchChartData();
    }, 300_000);

    return () => { 
      unsub(); 
      if (ledgerChannel) ledgerChannel.unsubscribe();
      clearInterval(interval); 
    };
   }, [refreshFromCache]);

  const filteredMembers = memberAnalytics.filter(m => {
      const nameMatch = String(m?.name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const phoneMatch = String(m?.phone || '').includes(searchQuery);
    const matchesSearch = nameMatch || phoneMatch;
    
    // date match: member.last_visit matches selectedDate
      const matchesDate = !selectedDate || String(m?.last_visit || '').startsWith(selectedDate);
    return matchesSearch && matchesDate;
  });

  const isDummy = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes("dummy-id");

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-700 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background">
      {isDummy && (
        <div className="bg-orange-500/10 border border-orange-500/30 p-4 rounded-xl flex items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="bg-orange-500/20 p-2 rounded-lg text-orange-500">
               <Settings className="w-5 h-5" />
            </div>
            <div>
               <p className="text-sm font-bold text-orange-500">Database Connection Missing</p>
               <p className="text-xs text-orange-500/80">The site is currently in DUMMY mode. Data will NOT be saved to the cloud and will be lost on refresh. Connect Supabase to fix this.</p>
            </div>
          </div>
        </div>
      )}

      {/* 24H ATTENDANCE MODAL */}
      {showAttendanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/90 backdrop-blur-xl animate-in fade-in duration-300">
           <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col border-border shadow-2xl overflow-hidden">
               <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-secondary/30">
                  <div>
                    <CardTitle className="text-2xl font-black text-white italic tracking-tighter">
                       DAILY <span className="text-primary">ATTENDANCE</span> SUMMARY
                    </CardTitle>
                    <CardDescription className="text-xs uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-2">
                       <Users className="w-3 h-3 text-primary" />
                       <span className="text-primary">{twentyFourHourSummary.length} UNIQUE MEMBERS</span> ATTENDED IN THE LAST 24 HOURS
                    </CardDescription>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowAttendanceModal(false)} 
                    className="bg-primary/10 hover:bg-primary text-primary hover:text-black border-primary/30 font-black italic uppercase tracking-tighter transition-all px-8 h-9"
                  >
                    CLOSE
                  </Button>
               </CardHeader>
               <CardContent className="overflow-y-auto p-0 scrollbar-hide">
                  <Table>
                     <TableHeader className="bg-transparent/10">
                        <TableRow>
                           <TableHead className="px-6 text-[10px] uppercase font-bold tracking-widest">Member Identity</TableHead>
                           <TableHead className="text-center text-[10px] uppercase font-bold tracking-widest">Hardware ID</TableHead>
                           <TableHead className="text-center text-[10px] uppercase font-bold tracking-widest">Scans</TableHead>
                           <TableHead className="text-right px-6 text-[10px] uppercase font-bold tracking-widest">Last Visit</TableHead>
                        </TableRow>
                     </TableHeader>
                     <TableBody>
                        {twentyFourHourSummary.length === 0 ? (
                           <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground italic">No scans recorded in the last 24 hours.</TableCell></TableRow>
                        ) : (
                           twentyFourHourSummary.map((item) => (
                              <TableRow key={item.id} className="hover:bg-primary/5 transition-colors border-border/20">
                                 <TableCell className="px-6">
                                    <div className="flex flex-col">
                                       <span className="font-bold text-white italic">{item.name}</span>
                                       <span className={`text-[8px] font-black uppercase w-fit px-1 rounded ${item.status === 'granted' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>{item.status}</span>
                                    </div>
                                 </TableCell>
                                 <TableCell className="text-center">
                                    <span className="text-[10px] font-mono text-muted-foreground">{item.hardwareId}</span>
                                 </TableCell>
                                 <TableCell className="text-center">
                                    <div className="flex justify-center">
                                       <span className="bg-primary text-black px-3 py-0.5 rounded-full text-[10px] font-black shadow-[0_0_15px_rgba(234,179,8,0.3)]">
                                          {item.count}
                                       </span>
                                    </div>
                                 </TableCell>
                                 <TableCell className="text-right px-6 font-mono">
                                    <span className="text-sm font-black text-white uppercase tracking-tight">
                                       {new Date(new Date(item.timestamp).getTime() - 5 * 60 * 60 * 1000).toLocaleTimeString("en-US", { hour: 'numeric', minute: '2-digit', hour12: true })}
                                    </span>
                                 </TableCell>
                              </TableRow>
                           ))
                        )}
                     </TableBody>
                 </Table>
              </CardContent>
           </Card>
        </div>
      )}

      {/* DETAILED SEGMENTATION MODAL */}
      {showSegmentationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/90 backdrop-blur-xl animate-in fade-in duration-300">
           <Card className="w-full max-w-5xl h-[90vh] flex flex-col border-border shadow-2xl overflow-hidden">
              <CardHeader className="flex flex-col gap-6 border-b border-border/50 bg-secondary/20">
                 <div className="flex items-center justify-between w-full">
                   <div>
                      <CardTitle className="text-2xl font-black text-white italic">MEMBER INSIGHTS & FILTERS</CardTitle>
                      <CardDescription className="text-xs uppercase tracking-widest font-bold text-primary">Full directory with date-based visit analysis</CardDescription>
                   </div>
                   <Button 
                     variant="outline" 
                     size="sm" 
                     onClick={() => setShowSegmentationModal(false)} 
                     className="bg-primary/10 hover:bg-primary text-primary hover:text-black border-primary/30 font-black italic uppercase tracking-tighter transition-all px-8 h-9"
                   >
                     CLOSE
                   </Button>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative">
                       <Activity className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                       <input 
                         type="text" 
                         placeholder="Search name or phone..." 
                         value={searchQuery}
                         onChange={(e) => setSearchQuery(e.target.value)}
                         className="w-full bg-background/50 border border-border rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-white"
                       />
                    </div>
                    <div className="flex items-center gap-3">
                       <div className="flex-1 relative">
                          <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                          <input 
                            type="date" 
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="w-full bg-background/50 border border-border rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-white"
                          />
                       </div>
                       <Button variant="secondary" onClick={() => setSelectedDate("")} className="text-[10px] font-black uppercase text-white h-full px-4">CLEAR</Button>
                    </div>
                 </div>
              </CardHeader>
              <CardContent className="overflow-y-auto p-0 scrollbar-hide">
                 <Table>
                    <TableHeader className="sticky top-0 bg-secondary/90 backdrop-blur z-10">
                       <TableRow className="border-border/50">
                          <TableHead className="px-6 text-[10px] uppercase font-black tracking-widest">Member Identity</TableHead>
                          <TableHead className="text-[10px] uppercase font-black tracking-widest">Health Category</TableHead>
                          <TableHead className="text-[10px] uppercase font-black tracking-widest">Financial Status</TableHead>
                          <TableHead className="text-right px-6 text-[10px] uppercase font-black tracking-widest">Last Activity</TableHead>
                       </TableRow>
                    </TableHeader>
                    <TableBody>
                       {filteredMembers.length === 0 ? (
                          <TableRow><TableCell colSpan={4} className="text-center py-24 text-muted-foreground italic">No members found matching your search or visit date.</TableCell></TableRow>
                       ) : (
                          filteredMembers.map((member) => (
                             <TableRow key={member.id} className="hover:bg-primary/5 transition-colors border-border/20">
                                <TableCell className="px-6 py-4">
                                   <p className="font-bold text-white italic">{member.name}</p>
                                   <p className="text-[10px] text-muted-foreground font-mono tracking-tighter">{member.phone || 'NO PHONE'}</p>
                                </TableCell>
                                <TableCell>
                                   <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter
                                      ${member.category === 'Active Payer' ? 'bg-emerald-500/20 text-emerald-500' : ''}
                                      ${member.category === 'Non-Paying (Active User)' ? 'bg-orange-500/20 text-orange-500' : ''}
                                      ${member.category === 'Inactive Payer (Not Visiting)' ? 'bg-blue-500/20 text-blue-500' : ''}
                                      ${member.category === 'Left / Long-Term Unpaid' ? 'bg-red-500/20 text-red-500' : ''}
                                   `}>
                                      {member.category}
                                   </span>
                                </TableCell>
                                <TableCell>
                                   <div className="space-y-1">
                                      <p className="text-[10px] font-bold text-muted-foreground uppercase">{member.package_type}</p>
                                      <p className={`text-[10px] font-black uppercase tracking-widest ${member.payment_status === 'due' ? 'text-red-500' : 'text-emerald-500'}`}>
                                         {member.payment_status || 'PENDING'}
                                      </p>
                                   </div>
                                </TableCell>
                                <TableCell className="text-right px-6 text-[10px] font-mono whitespace-nowrap text-muted-foreground">
                                   {formatCalendarDate(member.last_visit)}
                                </TableCell>
                             </TableRow>
                          ))
                       )}
                    </TableBody>
                 </Table>
              </CardContent>
           </Card>
        </div>
      )}

      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
        <div className="relative group">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-500 p-2 rounded-lg rotate-12 group-hover:rotate-0 transition-transform duration-500 shadow-[0_0_20px_rgba(234,179,8,0.4)]">
              <Dumbbell className="w-8 h-8 text-black" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-5xl font-[1000] tracking-tighter italic leading-none">
                <span className="text-white drop-shadow-[0_2px_10px_rgba(255,255,255,0.3)]">WORK</span>
                <span className="text-yellow-500 drop-shadow-[0_2px_10px_rgba(234,179,8,0.5)]">OUT</span>
                <span className="text-yellow-500 text-sm block font-bold tracking-[0.25em] mt-1 not-italic">CHAPTER 1</span>
              </h1>
              <div className="h-1 w-full bg-gradient-to-r from-yellow-500 to-transparent mt-1" />
              <p className="text-[10px] font-black uppercase tracking-[0.5em] text-yellow-500/80 mt-1">Live Attendance Command Center</p>
            </div>
          </div>
        </div>
        </div>
        <div className="flex gap-2">
           <Link href="/scanner-mapping">
              <Button variant="outline" size="sm" className="bg-background/50 backdrop-blur border-border/40 hover:bg-secondary transition-all">
                <Settings className="w-4 h-4 mr-2" /> ID Mapping
              </Button>
           </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* SEGMENT 1: HARDWARE STATUS */}
        <section className="space-y-4">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2 text-white">
            <Activity className="w-3 h-3 text-primary" /> Live Bridge Status
          </h2>
          <ScannerLiveStatus />
          
          <Card className="bg-primary/5 border-primary/20 backdrop-blur">
             <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-white italic">
                   <TrendingUp className="w-4 h-4 text-primary" /> System Health
                </CardTitle>
             </CardHeader>
             <CardContent>
                <div className="text-xs space-y-2 text-muted-foreground">
                   <div className="flex justify-between"><span>Database Mode:</span> <span className="font-bold text-foreground text-white">{isDummy ? 'DUMMY' : 'STRICT/SUPABASE'}</span></div>
                   <div className="flex justify-between"><span>Auto-Refresh:</span> <span className="font-bold text-emerald-500 underline decoration-dotted">Active (5s)</span></div>
                </div>
             </CardContent>
          </Card>
        </section>

        {/* SEGMENT 2: REAL-TIME LOGS (CLICKABLE) */}
        <Card 
          onClick={() => setShowAttendanceModal(true)}
          className="bg-card/50 backdrop-blur border-border h-[400px] flex flex-col cursor-pointer transition-all hover:border-primary/50 hover:bg-card/80 group scale-100 active:scale-[0.98] duration-300"
        >
           <CardHeader className="flex-none pb-2">
             <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-white italic group-hover:text-primary transition-colors">
                   <Activity className="w-5 h-5" /> Recent Entry Logs
                </CardTitle>
                <div className="text-[7px] font-black uppercase tracking-tighter bg-primary/20 text-primary px-2 py-1 rounded border border-primary/30 animate-pulse">
                   View 24h Summary
                </div>
             </div>
             <CardDescription className="text-[10px] uppercase font-bold text-muted-foreground">Biometric Activity Feed</CardDescription>
           </CardHeader>
           <CardContent className="flex-1 overflow-y-auto pt-0 scrollbar-hide">
              {logs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No recent activity.</p>
              ) : (
                <div className="space-y-2">
                  {logs.slice(0, 10).map((log) => (
                     <div key={log.id} className="flex items-center justify-between p-3 rounded-lg bg-background/40 border border-border/40 hover:border-primary/30 transition-all">
                        <div className="flex items-center gap-3">
                           <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden flex items-center justify-center border border-border/60">
                              {log.members?.photo_url ? (
                                 <Image src={log.members.photo_url} alt="Profile" width={40} height={40} className="w-full h-full object-cover" />
                              ) : (
                                 <Users className="w-5 h-5 text-muted-foreground/50" />
                              )}
                           </div>
                           <div>
                             <p className="text-sm font-bold text-white leading-tight italic">{log.members?.name || 'Unknown'}</p>
                             <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">
                                {formatRelativeTime(log.timestamp)}
                             </p>
                           </div>
                        </div>
                        <div>
                           <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest
                             ${log.status === 'granted' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : ''}
                             ${log.status === 'denied' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : ''}
                           `}>
                              {log.status}
                           </span>
                        </div>
                     </div>
                  ))}
                </div>
              )}
           </CardContent>
        </Card>

        {/* SEGMENT 3: ATTENDANCE CHART */}
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-white italic">
               <TrendingUp className="w-5 h-5 text-primary" /> Access Analytics
            </CardTitle>
            <CardDescription className="text-[10px] uppercase font-bold text-muted-foreground">Granted vs Denied trends</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="min-h-[220px] w-full">
              <BarChart accessibilityLayer data={accessData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tick={{ fontSize: 10, fontWeight: 700 }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="approved" fill="var(--color-approved)" radius={4} />
                <Bar dataKey="blocked_unpaid" fill="var(--color-blocked_unpaid)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* SEGMENT 4: MEMBERSHIP SEGMENTATION (CLICKABLE) */}
        <Card 
          onClick={() => setShowSegmentationModal(true)}
          className="bg-card/50 backdrop-blur border-border flex flex-col cursor-pointer transition-all hover:border-primary/50 hover:bg-card/80 group scale-100 active:scale-[0.98] duration-300"
        >
          <CardHeader className="flex-none pb-2">
             <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-white italic group-hover:text-primary transition-colors">
                   <Users className="w-5 h-5" /> Member Segmentation
                </CardTitle>
                <div className="text-[7px] font-black uppercase tracking-tighter bg-primary/20 text-primary px-2 py-1 rounded border border-primary/30 animate-pulse">
                   Deep Insights
                </div>
             </div>
             <CardDescription className="text-[10px] uppercase font-bold text-muted-foreground">Real-time health of member base</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden px-0 pt-0">
             <Table>
               <TableHeader className="bg-muted/10 border-b border-border/40">
                 <TableRow>
                   <TableHead className="text-[9px] uppercase font-black text-muted-foreground px-4">Member</TableHead>
                   <TableHead className="text-[9px] uppercase font-black text-muted-foreground">Category</TableHead>
                   <TableHead className="text-right text-[9px] uppercase font-black text-muted-foreground px-4">Visit</TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {memberAnalytics.slice(0, 8).map(member => (
                    <TableRow key={member.id} className="border-border/20 text-white">
                       <TableCell className="font-bold text-[11px] px-4 italic">{member.name}</TableCell>
                       <TableCell>
                          <span className={`px-2 py-0.5 rounded text-[7px] font-black uppercase
                             ${member.category === 'Active Payer' ? 'bg-emerald-500/20 text-emerald-500' : ''}
                             ${member.category === 'Non-Paying (Active User)' ? 'bg-orange-500/20 text-orange-500' : ''}
                             ${member.category === 'Inactive Payer (Not Visiting)' ? 'bg-blue-500/20 text-blue-500' : ''}
                             ${member.category === 'Left / Long-Term Unpaid' ? 'bg-red-500/20 text-red-500' : ''}
                          `}>
                             {member.category}
                          </span>
                       </TableCell>
                       <TableCell className="text-right text-muted-foreground text-[10px] font-mono px-4">
                          {member.daysSinceVisit === 0 ? 'TODAY' : `${member.daysSinceVisit}d`}
                       </TableCell>
                    </TableRow>
                 ))}
               </TableBody>
             </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
