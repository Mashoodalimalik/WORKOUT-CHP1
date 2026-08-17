"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { dbService, getMemberPaymentSnapshot } from "@/lib/supabase";
import { memberCache } from "@/lib/member-cache";
import { hardwareApi } from "@/lib/hardware-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Activity, 
  CheckCircle2, 
  Download, 
  Dumbbell, 
  Pencil, 
  Trash2, 
  UserCog, 
  Banknote, 
  PlusCircle, 
  Search, 
  Users, 
  X, 
  Phone, 
  Clock, 
  Calendar, 
  DollarSign,
  Briefcase
} from "lucide-react";

const toDisplaySerial = (value: number) => String(Math.max(1, value)).padStart(3, "0");

export default function MembersAndPaymentsPage() {
  const cacheVersion = useSyncExternalStore(
    memberCache.subscribe,
    memberCache.getSnapshot,
    () => 0
  );

  const members = useMemo(() => memberCache.getAllMembers(), [cacheVersion]);
  const trainers = useMemo(() => memberCache.getAllTrainers(), [cacheVersion]);
  const packages = useMemo(() => dbService.getCachedPackages() || [], [cacheVersion]);
  const addons = useMemo(() => dbService.getCachedAddons() || [], [cacheVersion]);
  const ptPackages = useMemo(() => dbService.getCachedPTPackages() || [], [cacheVersion]);

  // Search and filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "member" | "employee">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "paid" | "due">("all");

  // Selected Member Console Modal State
  const [consoleMemberId, setConsoleMemberId] = useState<string | null>(null);
  const consoleMember = useMemo(() => 
    consoleMemberId ? memberCache.getMemberById(consoleMemberId) : null
  , [consoleMemberId, cacheVersion]);

  // Edits inside the Console Modal
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({
    name: "",
    phone: "",
    gender: "",
    zk_id: "",
    trainer_name: ""
  });

  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState({
    package_type: "Basic",
    custom_package_duration: "3",
    custom_package_price: "12000",
    trainer_package_type: "none",
    has_cardio: false,
    trainer_commission: "0",
    reset_start_date: false
  });

  // Cash collection inside the Console Modal
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Upgrade Payment Gate Modal Overlay
  const [paymentGateInfo, setPaymentGateInfo] = useState<{
    isOpen: boolean;
    oldTotalRequired: number;
    newTotalRequired: number;
    upgradeCost: number;
    outstandingBalance: number;
    totalDueToday: number;
    paymentInput: string;
    creditApplied: number;
    newCycleCost: number;
  } | null>(null);

  const [isSavingPackage, setIsSavingPackage] = useState(false);

  // Resolve Serials
  const membersWithResolvedSerials = useMemo(() => {
    const usedSerials = new Set<string>();
    let nextSerial = 1;

    return members.map((member) => {
      const rawSerial = String(member.serial_number || "").trim();
      const parsedSerial = /^\d+$/.test(rawSerial) ? Number.parseInt(rawSerial, 10) : null;
      const canonicalSerial = parsedSerial && parsedSerial > 0 ? toDisplaySerial(parsedSerial) : null;

      if (canonicalSerial && !usedSerials.has(canonicalSerial)) {
        usedSerials.add(canonicalSerial);
        if (parsedSerial !== null && parsedSerial >= nextSerial) {
          nextSerial = parsedSerial + 1;
        }
        return { ...member, resolved_serial_number: canonicalSerial };
      }

      while (usedSerials.has(toDisplaySerial(nextSerial))) {
        nextSerial += 1;
      }

      const fallbackSerial = toDisplaySerial(nextSerial);
      usedSerials.add(fallbackSerial);
      nextSerial += 1;

      return { ...member, resolved_serial_number: fallbackSerial };
    });
  }, [members]);

  useEffect(() => {
    memberCache.initialize();
  }, []);

  // Sync edits draft with loaded member info when console opens
  useEffect(() => {
    if (consoleMember) {
      setInfoDraft({
        name: consoleMember.name || "",
        phone: consoleMember.phone || "",
        gender: consoleMember.gender || "Not specified",
        zk_id: consoleMember.zk_id || "",
        trainer_name: consoleMember.trainer_name || "Unassigned"
      });

      const isCustom = String(consoleMember.package_type || "").toLowerCase().startsWith("custom");
      let durationStr = "3";
      let priceStr = "12000";
      let basePkgType = consoleMember.package_type || "Basic";

      if (isCustom) {
        basePkgType = "custom";
        const match = String(consoleMember.package_type || "").match(/custom\s*\((\d+)\s*month/i);
        if (match) durationStr = match[1];
        priceStr = String(consoleMember.gym_fees || 12000);
      }

      setPlanDraft({
        package_type: basePkgType,
        custom_package_duration: durationStr,
        custom_package_price: priceStr,
        trainer_package_type: consoleMember.trainer_package_type || "none",
        has_cardio: !!consoleMember.has_cardio,
        trainer_commission: String(consoleMember.trainer_commission || 0),
        reset_start_date: false
      });

      // Reset payment amounts
      setPaymentAmount("");
      setPaymentDate(new Date().toISOString().split('T')[0]);
      setIsEditingInfo(false);
      setIsEditingPlan(false);
      setPaymentGateInfo(null);
    }
  }, [consoleMemberId, cacheVersion]);

  // Helper to identify custom drafts
  const isCustomDraft = planDraft.package_type === "custom";

  // Handle client info updates
  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consoleMember) return;
    try {
      await dbService.updateMember(consoleMember.id, {
        name: infoDraft.name,
        phone: infoDraft.phone,
        gender: infoDraft.gender,
        zk_id: infoDraft.zk_id,
        trainer_name: infoDraft.trainer_name === "Unassigned" ? "" : infoDraft.trainer_name
      });
      setIsEditingInfo(false);
    } catch (err: any) {
      alert("Failed to update member details: " + err.message);
    }
  };

  // Handle plan and package updates
  const handleSavePlan = async () => {
    if (!consoleMember) return;
    setIsSavingPackage(true);
    try {
      const isCustom = planDraft.package_type === "custom";
      const finalPackageType = isCustom
        ? `Custom (${planDraft.custom_package_duration} Months)`
        : planDraft.package_type;
      
      const customPrice = isCustom ? Number(planDraft.custom_package_price) || 0 : undefined;
      const isCardioOnlyPackage = finalPackageType === "Cardio Only" || finalPackageType === "pkg_cardio";

      const payload = {
        package_type: finalPackageType,
        trainer_package_type: planDraft.trainer_package_type,
        has_cardio: isCardioOnlyPackage ? false : planDraft.has_cardio,
        trainer_commission: Number(planDraft.trainer_commission) || 0,
        reset_start_date: !!planDraft.reset_start_date,
        custom_gym_fees: customPrice,
        amount_paid: paymentGateInfo?.isOpen ? (Number(paymentGateInfo.paymentInput) || 0) : undefined
      };

      if (!paymentGateInfo?.isOpen) {
        const oldSnapshot = getMemberPaymentSnapshot(consoleMember);
        const simulationResult = dbService.simulatePackageUpdate(consoleMember, payload);
        const newSnapshot = simulationResult.snapshot;

        const upgradeCost = newSnapshot.totalRequired - oldSnapshot.totalRequired;
        const rawTotalDue = newSnapshot.totalRequired - oldSnapshot.totalPaid;
        const totalDueToday = rawTotalDue > 0 ? rawTotalDue : 0;
        const outstandingBalance = oldSnapshot.cycleDue > 0 ? oldSnapshot.cycleDue : 0;

        const isPackageChanged = 
          finalPackageType !== consoleMember.package_type ||
          payload.trainer_package_type !== consoleMember.trainer_package_type ||
          payload.has_cardio !== consoleMember.has_cardio ||
          payload.trainer_commission !== consoleMember.trainer_commission ||
          payload.reset_start_date;

        if (isPackageChanged) {
          setPaymentGateInfo({
            isOpen: true,
            oldTotalRequired: oldSnapshot.totalRequired,
            newTotalRequired: newSnapshot.totalRequired,
            upgradeCost: upgradeCost,
            outstandingBalance: outstandingBalance,
            totalDueToday: totalDueToday,
            paymentInput: String(totalDueToday),
            creditApplied: simulationResult.metrics.creditApplied,
            newCycleCost: simulationResult.metrics.newCycleCost
          });
          setIsSavingPackage(false);
          return;
        }
      }

      await dbService.updateMemberPackage(consoleMember.id, payload);
      setPaymentGateInfo(null);
      setIsEditingPlan(false);
    } catch (error: any) {
      alert("Failed to update plan: " + (error?.message || "Unknown error"));
    } finally {
      setIsSavingPackage(false);
    }
  };

  // Handle cash payment logging
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consoleMember || !paymentAmount || isSubmittingPayment) return;
    setIsSubmittingPayment(true);
    try {
      await dbService.updateMemberPayment(consoleMember.id, Number(paymentAmount), paymentDate);
      setPaymentAmount("");
      setPaymentDate(new Date().toISOString().split('T')[0]);
    } catch (err: any) {
      alert("Failed to record deposit: " + err.message);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Handle delete member
  const handleRemoveMember = async (member: any) => {
    if (!window.confirm(`Are you sure you want to completely remove ${member.name} from the registry? This will also delete scanner data from the device.`)) {
      return;
    }

    const scannerId = String(member.zk_id || "").trim();

    try {
      if (scannerId) {
        try {
          const deletePayload: { uid?: number; user_id?: string } = {};
          if (/^\d+$/.test(scannerId)) {
            deletePayload.uid = Number.parseInt(scannerId, 10);
            deletePayload.user_id = scannerId;
          } else {
            deletePayload.user_id = scannerId;
          }
          await hardwareApi.deleteUser(deletePayload);
        } catch (hwError: any) {
          console.warn("Hardware deletion failed:", hwError);
          const forceDelete = window.confirm(
            `Scanner Sync Issue: ${hwError?.message || "Device offline"}\n\nThe system could not confirm deletion from the physical scanner. Proceed to delete from database anyway?`
          );
          if (!forceDelete) return;
        }
      }

      await dbService.deleteMember(member.id);
      setConsoleMemberId(null);
    } catch (error: any) {
      alert(`Failed to delete member: ${error?.message || "Unknown error"}`);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (filteredMembers.length === 0) return;

    const headers = [
      "Serial Number", "Member Name", "Phone", "Gender", "Trainer", "Device ID", "Plan Type", "Gym Fees", "Trainer Fees", "Total Paid", "Balance Status", "Last Payment Date"
    ];

    const csvRows = filteredMembers.map(m => {
      const paymentSnapshot = getMemberPaymentSnapshot(m);
      const balance = paymentSnapshot.cycleDue > 0 ? `-${paymentSnapshot.cycleDue}` : paymentSnapshot.remainingBalance;
      const lastPayment = m.payment_date ? new Date(m.payment_date).toLocaleDateString("en-GB") : "N/A";
      const isEmployee = m.package_type === "Employee";

      return [
        `"${m.resolved_serial_number}"`, 
        `"${m.name}"`, 
        `"${m.phone}"`, 
        `"${m.gender}"`, 
        `"${m.trainer_name || 'Unassigned'}"`,
        `"${m.zk_id || 'N/A'}"`,
        `"${m.package_type}"`,
        isEmployee ? 0 : paymentSnapshot.recurringGymFees,
        isEmployee ? 0 : paymentSnapshot.recurringTrainerFees,
        isEmployee ? 0 : paymentSnapshot.totalPaid,
        isEmployee ? "Staff" : balance,
        lastPayment
      ].join(',');
    });

    const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Members_Payments_Export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // Filtered members list
  const filteredMembers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    
    return membersWithResolvedSerials.filter((m) => {
      // 1. Query Filter
      if (normalizedQuery) {
        const matchesQuery = [
          m.resolved_serial_number,
          m.name,
          m.phone,
          m.gender,
          m.trainer_name,
          m.zk_id,
          m.package_type
        ].some(field => String(field || "").toLowerCase().includes(normalizedQuery));

        if (!matchesQuery) return false;
      }

      // 2. Type Filter
      const isEmployee = m.package_type === "Employee";
      if (filterType === "member" && isEmployee) return false;
      if (filterType === "employee" && !isEmployee) return false;

      // 3. Financial Status Filter
      if (!isEmployee) {
        const paymentSnapshot = getMemberPaymentSnapshot(m);
        if (filterStatus === "paid" && paymentSnapshot.isDue) return false;
        if (filterStatus === "due" && !paymentSnapshot.isDue) return false;
      } else if (filterStatus !== "all") {
        // Employees are exempt from financial cycle status, only keep in 'all' status filter
        return false;
      }

      return true;
    });
  }, [membersWithResolvedSerials, searchQuery, filterType, filterStatus]);

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500 relative">
      <header className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-yellow-500 p-2 rounded-lg rotate-12 shadow-[0_0_20px_rgba(234,179,8,0.4)]">
            <Dumbbell className="w-8 h-8 text-black" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-4xl font-[1000] tracking-tighter italic leading-none flex items-center">
              <span className="text-white">WORK</span><span className="text-yellow-500">OUT</span>
              <span className="text-yellow-500 text-xs font-bold tracking-wider ml-2 bg-yellow-500/10 px-1.5 py-0.5 rounded border border-yellow-500/20">CH. 1</span>
              <span className="mx-3 text-muted-foreground/30 font-light not-italic">|</span>
              <span className="text-white/40 text-2xl uppercase tracking-tighter">Members & Payments</span>
            </h1>
            <p className="text-[10px] font-black uppercase tracking-[0.5em] text-yellow-500/60 mt-1">Unified Personnel Registry & Ledger Management</p>
          </div>
        </div>
        <Button 
          variant="outline" 
          onClick={handleExportCSV}
          className="gap-2 border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10"
        >
          <Download className="w-4 h-4" /> Export Registry (CSV)
        </Button>
      </header>

      {/* Main Grid List */}
      <div className="grid grid-cols-1 gap-8">
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-yellow-500" /> Member Accounts & Financials</CardTitle>
                <CardDescription>Click any member account to view full profile details, update packages, or record monthly cash deposits.</CardDescription>
              </div>
              
              {/* Search & Filter Controls */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search name, phone, serial..." 
                    className="pl-9 h-9" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                
                <select 
                  value={filterType} 
                  onChange={(e) => setFilterType(e.target.value as any)} 
                  className="bg-[#0f172a] border border-border rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer h-9"
                >
                  <option value="all">All Accounts</option>
                  <option value="member">Members Only</option>
                  <option value="employee">Staff Only</option>
                </select>

                <select 
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value as any)} 
                  className="bg-[#0f172a] border border-border rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer h-9"
                >
                  <option value="all">All Payment Statuses</option>
                  <option value="paid">Paid/Completed</option>
                  <option value="due">Overdue/Unpaid</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>Serial No</TableHead>
                    <TableHead>Member Name</TableHead>
                    <TableHead>Contact Info</TableHead>
                    <TableHead>Current Plan</TableHead>
                    <TableHead>Trainer</TableHead>
                    <TableHead>Status / Balance</TableHead>
                    <TableHead>ZKTeco ID</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member) => {
                    const isEmployee = member.package_type === "Employee";
                    const paymentSnapshot = !isEmployee ? getMemberPaymentSnapshot(member) : null;
                    const due = paymentSnapshot ? paymentSnapshot.cycleDue : 0;
                    const remaining = paymentSnapshot ? paymentSnapshot.remainingBalance : 0;

                    return (
                      <TableRow 
                        key={member.id} 
                        className="border-border hover:bg-yellow-500/5 transition-colors cursor-pointer group"
                        onClick={() => setConsoleMemberId(member.id)}
                      >
                        <TableCell className="font-mono text-muted-foreground">{member.resolved_serial_number || '---'}</TableCell>
                        <TableCell className="font-bold text-white italic group-hover:text-yellow-500 transition-colors">{member.name}</TableCell>
                        <TableCell className="text-sm">
                          <div className="flex flex-col text-xs">
                            <span className="text-white">{member.phone || 'NO PHONE'}</span>
                            <span className="text-muted-foreground">{member.gender || 'Not specified'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {isEmployee ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-bold uppercase tracking-wider text-[9px]">Staff</span>
                          ) : (
                            <div className="flex flex-col font-medium">
                              <span>{member.package_type}</span>
                              <span className="text-[10px] text-muted-foreground">Gym: PKR {paymentSnapshot?.recurringGymFees} {member.has_cardio ? "(+Cardio)" : ""}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {isEmployee ? "N/A" : (
                            <div className="flex flex-col">
                              <span>{member.trainer_name || 'Unassigned'}</span>
                              {member.trainer_package_type !== 'none' && (
                                <span className="text-[10px] text-muted-foreground">PT: PKR {paymentSnapshot?.recurringTrainerFees}</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {isEmployee ? (
                            <span className="text-emerald-500 font-semibold uppercase tracking-wider text-[10px]">Free Access</span>
                          ) : (
                            <span className={`px-2 py-1 rounded text-xs font-bold ${due > 0 ? 'bg-red-500/15 text-red-500' : 'bg-emerald-500/15 text-emerald-500'}`}>
                              {due > 0 ? `Overdue (PKR -${due})` : `Paid (PKR ${remaining})`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{member.zk_id || 'N/A'}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button 
                            onClick={() => setConsoleMemberId(member.id)} 
                            variant="outline" 
                            size="sm" 
                            className="h-8 gap-1.5 border-yellow-500/30 hover:bg-yellow-500 hover:text-black font-black uppercase text-[10px] italic"
                          >
                            <UserCog className="w-3.5 h-3.5" /> View Console
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredMembers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground italic">
                        {members.length === 0 ? "No records found." : "No accounts match your filter criteria."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DETAILED MEMBER CONSOLE MODAL */}
      {consoleMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/90 backdrop-blur-xl animate-in fade-in duration-300">
          <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col border-border shadow-2xl overflow-hidden relative bg-card">
            {/* Top Header Banner */}
            <CardHeader className="flex-none flex flex-row items-start justify-between border-b border-border/50 bg-secondary/30 pb-6 p-6">
              <div className="flex items-center gap-4">
                <div className="bg-yellow-500 p-3 rounded-xl rotate-6 shadow-[0_0_20px_rgba(234,179,8,0.3)]">
                  <UserCog className="w-8 h-8 text-black" />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-3xl font-[1000] text-white italic tracking-tighter uppercase leading-none">
                      {consoleMember.name}
                    </CardTitle>
                    <span className="text-xs font-black uppercase font-mono px-2 py-0.5 rounded border border-border bg-background">
                      Serial: {consoleMember.resolved_serial_number || toDisplaySerial(Number(consoleMember.serial_number) || 1)}
                    </span>
                  </div>
                  <CardDescription className="text-[10px] uppercase tracking-widest font-black text-yellow-500 mt-1.5 flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5" />
                    <span>Client Database Management Console</span>
                  </CardDescription>
                </div>
              </div>
              
              <button 
                onClick={() => setConsoleMemberId(null)}
                className="p-1.5 hover:bg-red-500/10 hover:text-red-500 rounded-lg border border-border/50 text-muted-foreground transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </CardHeader>

            {/* Modal Body Contents */}
            <CardContent className="flex-1 overflow-y-auto p-6 scrollbar-hide grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Pane: Quick Profile Edit & General Settings */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* General Info Card */}
                <Card className="bg-secondary/10 border-border/50 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500" />
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5 text-yellow-500" /> Account Profile Info
                    </CardTitle>
                    {!isEditingInfo ? (
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => setIsEditingInfo(true)}
                        className="h-7 text-[10px] font-black uppercase text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500"
                      >
                        <Pencil className="w-3 h-3 mr-1" /> Edit Profile
                      </Button>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    {!isEditingInfo ? (
                      <div className="space-y-3">
                        <div className="flex justify-between border-b border-border/30 pb-2">
                          <span className="text-muted-foreground font-semibold">Contact Phone:</span>
                          <span className="font-bold text-white font-mono">{consoleMember.phone || 'NO PHONE'}</span>
                        </div>
                        <div className="flex justify-between border-b border-border/30 pb-2">
                          <span className="text-muted-foreground font-semibold">Gender Identity:</span>
                          <span className="font-bold text-white">{consoleMember.gender || 'Not specified'}</span>
                        </div>
                        <div className="flex justify-between border-b border-border/30 pb-2">
                          <span className="text-muted-foreground font-semibold">Device ID Mapping:</span>
                          <span className="font-bold text-white font-mono">{consoleMember.zk_id || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between border-b border-border/30 pb-2">
                          <span className="text-muted-foreground font-semibold">Trainer Registry:</span>
                          <span className="font-bold text-white">{consoleMember.trainer_name || 'Unassigned'}</span>
                        </div>
                        <div className="flex justify-between pb-1">
                          <span className="text-muted-foreground font-semibold">Profile Added:</span>
                          <span className="font-bold text-white text-xs">{consoleMember.created_at ? new Date(consoleMember.created_at).toLocaleDateString("en-GB") : '---'}</span>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleSaveInfo} className="space-y-3">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">Full Name</Label>
                          <Input 
                            value={infoDraft.name}
                            onChange={(e) => setInfoDraft(prev => ({ ...prev, name: e.target.value }))}
                            className="h-9 font-bold"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">Phone Number</Label>
                          <Input 
                            value={infoDraft.phone}
                            onChange={(e) => setInfoDraft(prev => ({ ...prev, phone: e.target.value }))}
                            className="h-9 font-mono"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">Gender</Label>
                          <select 
                            value={infoDraft.gender}
                            onChange={(e) => setInfoDraft(prev => ({ ...prev, gender: e.target.value }))}
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer"
                          >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                            <option value="Not specified">Not specified</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">Device biometric ID</Label>
                          <Input 
                            value={infoDraft.zk_id}
                            onChange={(e) => setInfoDraft(prev => ({ ...prev, zk_id: e.target.value }))}
                            className="h-9 font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-black uppercase text-muted-foreground">Assigned Trainer</Label>
                          <select 
                            value={infoDraft.trainer_name || "Unassigned"}
                            onChange={(e) => setInfoDraft(prev => ({ ...prev, trainer_name: e.target.value }))}
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer"
                          >
                            <option value="Unassigned">Unassigned</option>
                            {trainers.map(t => (
                              <option key={t.id} value={t.name}>{t.name}</option>
                            ))}
                          </select>
                        </div>
                        
                        <div className="flex gap-2 pt-2">
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm"
                            className="flex-1 text-[10px] font-black uppercase"
                            onClick={() => setIsEditingInfo(false)}
                          >
                            Cancel
                          </Button>
                          <Button 
                            type="submit" 
                            size="sm"
                            className="flex-1 text-[10px] font-black uppercase bg-yellow-500 hover:bg-yellow-500/80 text-black"
                          >
                            Save Profile
                          </Button>
                        </div>
                      </form>
                    )}
                  </CardContent>
                </Card>
                
                {/* Device and Hardware actions */}
                <Card className="bg-secondary/10 border-border/50 p-4 space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-yellow-500" /> Database Management Actions</h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    You can remove this account permanently. If the scanner bridge is online, it will also try to sync and purge biometric keys on the device.
                  </p>
                  <Button 
                    variant="outline" 
                    onClick={() => handleRemoveMember(consoleMember)}
                    className="w-full h-9 border-red-500/30 text-red-500 hover:bg-red-500/10 gap-2 font-black uppercase tracking-wider text-[10px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Purge Client Profile
                  </Button>
                </Card>
              </div>

              {/* Right Pane: Plan Modification, Dues Ledger & Payment logging */}
              <div className="lg:col-span-7 space-y-6">
                
                {/* Financial Overview Card */}
                {consoleMember.package_type !== 'Employee' && (
                  <Card className="bg-emerald-500/[0.03] border-emerald-500/20 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                    <CardHeader className="pb-3">
                      <CardTitle className="text-xs font-black uppercase tracking-widest text-emerald-500 flex items-center gap-1.5">
                        <Banknote className="w-3.5 h-3.5" /> Billing Ledger Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {(() => {
                        const paymentSnapshot = getMemberPaymentSnapshot(consoleMember);
                        const balance = paymentSnapshot.cycleDue;
                        const remaining = paymentSnapshot.remainingBalance;
                        const isOverdue = paymentSnapshot.isDue;

                        return (
                          <div className="space-y-4">
                            {/* Billing Statistics */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <div className="bg-background/40 p-3 rounded-lg border border-border/50 text-center">
                                <span className="text-[9px] font-black text-muted-foreground uppercase">Gym Cycle</span>
                                <span className="block text-sm font-black text-white mt-1">PKR {paymentSnapshot.recurringGymFees}</span>
                              </div>
                              <div className="bg-background/40 p-3 rounded-lg border border-border/50 text-center">
                                <span className="text-[9px] font-black text-muted-foreground uppercase">Trainer Cycle</span>
                                <span className="block text-sm font-black text-white mt-1">PKR {paymentSnapshot.recurringTrainerFees}</span>
                              </div>
                              <div className="bg-background/40 p-3 rounded-lg border border-border/50 text-center">
                                <span className="text-[9px] font-black text-muted-foreground uppercase">Total Paid</span>
                                <span className="block text-sm font-black text-emerald-500 mt-1">PKR {paymentSnapshot.totalPaid}</span>
                              </div>
                              <div className="bg-background/40 p-3 rounded-lg border border-border/50 text-center">
                                <span className="text-[9px] font-black text-muted-foreground uppercase">Status</span>
                                <span className={`block text-xs font-black uppercase mt-1.5 ${isOverdue ? 'text-red-500' : 'text-emerald-500'}`}>
                                  {isOverdue ? `Due: ${balance}` : `Paid: ${remaining}`}
                                </span>
                              </div>
                            </div>

                            {/* Cycle Dates */}
                            <div className="bg-background/25 border border-border/30 rounded-lg p-3 grid grid-cols-2 gap-4 text-xs font-medium">
                              <div className="flex flex-col gap-1">
                                <span className="text-muted-foreground flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-emerald-500" /> Start Date:</span>
                                <span className="text-white font-mono">{consoleMember.package_start_date ? new Date(consoleMember.package_start_date).toLocaleDateString("en-GB") : 'Never'}</span>
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-emerald-500" /> Billing clock:</span>
                                <span className="text-white">{paymentSnapshot.daysSincePayment} Days in cycle ({paymentSnapshot.gymCycleDays} Days plan)</span>
                              </div>
                            </div>

                            {/* Payment Cash Logging form inline */}
                            <form onSubmit={handleRecordPayment} className="pt-4 border-t border-emerald-500/20 space-y-3">
                              <h4 className="text-[10px] font-black uppercase tracking-wider text-emerald-500 flex items-center gap-1">
                                <PlusCircle className="w-3.5 h-3.5" /> Log Client Deposit Payment
                              </h4>
                              
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-[9px] font-black uppercase text-muted-foreground">Deposit Cash amount (PKR)</Label>
                                  <Input 
                                    type="number"
                                    required
                                    value={paymentAmount}
                                    onChange={(e) => setPaymentAmount(e.target.value)}
                                    placeholder="e.g. 5000"
                                    className="h-9 font-bold bg-background/50 border-emerald-500/30 text-emerald-500 focus-visible:ring-emerald-500"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[9px] font-black uppercase text-muted-foreground">Deposit Date</Label>
                                  <Input 
                                    type="date"
                                    required
                                    value={paymentDate}
                                    onChange={(e) => setPaymentDate(e.target.value)}
                                    className="h-9 font-mono bg-background/50 border-emerald-500/30 text-emerald-500 focus-visible:ring-emerald-500"
                                  />
                                </div>
                              </div>
                              
                              <Button 
                                type="submit"
                                disabled={isSubmittingPayment}
                                className="w-full h-9 bg-emerald-500 hover:bg-emerald-600 text-black font-black uppercase italic tracking-wider text-[10px]"
                              >
                                {isSubmittingPayment ? "PROCESSING..." : "CONFIRM LEDGER DEPOSIT"}
                              </Button>
                            </form>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}

                {/* Plan Modification Card */}
                {consoleMember.package_type !== 'Employee' && (
                  <Card className="bg-yellow-500/[0.02] border-yellow-500/10 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500" />
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-xs font-black uppercase tracking-widest text-yellow-500 flex items-center gap-1.5">
                        <Dumbbell className="w-3.5 h-3.5" /> Plan Cycles & Packages
                      </CardTitle>
                      {!isEditingPlan ? (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => setIsEditingPlan(true)}
                          className="h-7 text-[10px] font-black uppercase text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500"
                        >
                          <Pencil className="w-3 h-3 mr-1" /> Change Plan
                        </Button>
                      ) : null}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!isEditingPlan ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm font-medium">
                          <div>
                            <span className="text-muted-foreground text-xs block">Membership Type:</span>
                            <span className="text-white font-bold">{consoleMember.package_type}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs block">Cardio Facility:</span>
                            <span className="text-white font-bold">{consoleMember.has_cardio ? "Enabled (Full Cardio)" : "Disabled"}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs block">Trainer Plan:</span>
                            <span className="text-white font-bold">{consoleMember.trainer_package_type === "none" ? "No Private Trainer" : consoleMember.trainer_package_type}</span>
                          </div>
                          {consoleMember.trainer_package_type === "Commissioned" && (
                            <div>
                              <span className="text-muted-foreground text-xs block">Custom Commission:</span>
                              <span className="text-white font-bold font-mono">PKR {consoleMember.trainer_commission}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <Label className="text-[10px] font-black uppercase text-muted-foreground">Gym Membership Plan</Label>
                              <select 
                                value={planDraft.package_type}
                                onChange={(e) => setPlanDraft(prev => ({
                                  ...prev,
                                  package_type: e.target.value,
                                  ...(e.target.value === 'Cardio Only' || e.target.value === 'pkg_cardio' ? { has_cardio: false } : {}),
                                }))}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer"
                              >
                                {packages.map(p => (
                                  <option key={p.id} value={p.id}>{p.name} ({p.price})</option>
                                ))}
                                <option value="custom">Custom Package...</option>
                              </select>
                            </div>
                            
                            <div className="space-y-1">
                              <Label className="text-[10px] font-black uppercase text-muted-foreground">Trainer Cycle Plan</Label>
                              <select 
                                value={planDraft.trainer_package_type}
                                onChange={(e) => setPlanDraft(prev => ({ ...prev, trainer_package_type: e.target.value }))}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer"
                              >
                                <option value="none">No Private Trainer</option>
                                {ptPackages.map(pt => (
                                  <option key={pt.id} value={pt.id}>{pt.name} ({pt.price})</option>
                                ))}
                                <option value="Commissioned">Custom Commission</option>
                              </select>
                            </div>
                          </div>

                          {/* Custom Package Options */}
                          {isCustomDraft && (
                            <div className="grid grid-cols-2 gap-4 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg animate-in slide-in-from-top-2 duration-300">
                              <div className="space-y-1">
                                <Label className="text-[9px] font-black uppercase text-yellow-500">Duration (Months)</Label>
                                <select 
                                  value={planDraft.custom_package_duration}
                                  onChange={(e) => setPlanDraft(prev => ({ ...prev, custom_package_duration: e.target.value }))}
                                  className="flex h-9 w-full rounded-md border border-yellow-500/20 bg-background/50 px-2 py-1 text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-yellow-500 cursor-pointer"
                                >
                                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24].map(m => (
                                    <option key={m} value={String(m)} className="bg-[#0f172a]">{m} Month{m > 1 ? 's' : ''}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[9px] font-black uppercase text-yellow-500">Cycle Amount (PKR)</Label>
                                <Input 
                                  type="number"
                                  value={planDraft.custom_package_price}
                                  onChange={(e) => setPlanDraft(prev => ({ ...prev, custom_package_price: e.target.value }))}
                                  className="h-9 border-yellow-500/20 bg-background/50 font-bold"
                                />
                              </div>
                            </div>
                          )}

                          {planDraft.trainer_package_type === 'Commissioned' && (
                            <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg animate-in slide-in-from-top-2 duration-300 space-y-1">
                              <Label className="text-[9px] font-black uppercase text-yellow-500">Trainer Commission (PKR)</Label>
                              <Input 
                                type="number"
                                value={planDraft.trainer_commission}
                                onChange={(e) => setPlanDraft(prev => ({ ...prev, trainer_commission: e.target.value }))}
                                className="h-9 border-yellow-500/20 bg-background/50 font-bold"
                              />
                            </div>
                          )}

                          {/* Cardio Addon & Reset Options */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {planDraft.package_type !== 'Cardio Only' && planDraft.package_type !== 'pkg_cardio' && (
                              <div 
                                onClick={() => setPlanDraft(prev => ({ ...prev, has_cardio: !prev.has_cardio }))}
                                className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-colors ${planDraft.has_cardio ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-background border-border hover:border-emerald-500/30'}`}
                              >
                                <div className="flex flex-col text-left">
                                  <span className="text-xs font-bold text-white uppercase tracking-tight">Cardio Addon</span>
                                  <span className="text-[9px] text-muted-foreground uppercase">+ PKR 2,500 / Month</span>
                                </div>
                                <div className={`w-5 h-5 rounded border transition-all flex items-center justify-center ${planDraft.has_cardio ? 'bg-emerald-500 border-emerald-500' : 'border-border'}`}>
                                  {planDraft.has_cardio && <CheckCircle2 className="w-3.5 h-3.5 text-black font-black" />}
                                </div>
                              </div>
                            )}
                            
                            <div 
                              onClick={() => setPlanDraft(prev => ({ ...prev, reset_start_date: !prev.reset_start_date }))}
                              className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-colors ${planDraft.reset_start_date ? 'bg-yellow-500/10 border-yellow-500/40' : 'bg-background border-border hover:border-yellow-500/30'}`}
                            >
                              <div className="flex flex-col text-left">
                                <span className="text-xs font-bold text-white uppercase tracking-tight">Reset Cycle Clock</span>
                                <span className="text-[9px] text-muted-foreground uppercase">Start fresh billing from today</span>
                              </div>
                              <div className={`w-5 h-5 rounded border transition-all flex items-center justify-center ${planDraft.reset_start_date ? 'bg-yellow-500 border-yellow-500' : 'border-border'}`}>
                                {planDraft.reset_start_date && <CheckCircle2 className="w-3.5 h-3.5 text-black font-black" />}
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="sm"
                              className="flex-1 text-[10px] font-black uppercase border border-border"
                              onClick={() => { setIsEditingPlan(false); setPaymentGateInfo(null); }}
                            >
                              Discard
                            </Button>
                            <Button 
                              type="button" 
                              size="sm"
                              className="flex-1 text-[10px] font-black uppercase bg-yellow-500 hover:bg-yellow-500/80 text-black shadow-lg"
                              onClick={handleSavePlan}
                            >
                              Confirm Plan change
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* DYNAMIC UPGRADE PAYMENT GATEWAY MODAL OVERLAY */}
      {paymentGateInfo?.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/95 backdrop-blur-2xl animate-in fade-in duration-300">
          <Card className="w-full max-w-md border-primary/50 shadow-2xl bg-card">
            <CardHeader className="border-b border-border/40 bg-yellow-500/10 pb-6 text-center">
              <CardTitle className="text-2xl font-black text-yellow-500 italic tracking-tight uppercase">
                {paymentGateInfo.totalDueToday > 0 ? "PAYMENT REQUIRED" : "CONFIRM PACKAGE CHANGE"}
              </CardTitle>
              <CardDescription className="text-xs uppercase font-bold tracking-widest text-muted-foreground mt-2">
                {paymentGateInfo.totalDueToday > 0 ? "Please log the payment for this package change" : "Review the new balance and confirm changes"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2 p-4 rounded-xl bg-background border border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground font-bold">New Package Cost</span>
                  <span className="font-black text-white">PKR {paymentGateInfo.newCycleCost.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground font-bold">Unused Days Credit</span>
                  <span className="font-black text-green-400">- PKR {paymentGateInfo.creditApplied.toLocaleString()}</span>
                </div>
                <div className="h-px bg-border my-2"></div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground font-bold">{paymentGateInfo.upgradeCost >= 0 ? "Upgrade Cost" : "Prorated Credit"}</span>
                  <span className={`font-black ${paymentGateInfo.upgradeCost >= 0 ? 'text-white' : 'text-green-400'}`}>
                    {paymentGateInfo.upgradeCost >= 0 ? `PKR ${paymentGateInfo.upgradeCost.toLocaleString()}` : `- PKR ${Math.abs(paymentGateInfo.upgradeCost).toLocaleString()}`}
                  </span>
                </div>
                {paymentGateInfo.outstandingBalance > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground font-bold">Previous Unpaid Balance</span>
                    <span className="font-black text-red-500">PKR {paymentGateInfo.outstandingBalance.toLocaleString()}</span>
                  </div>
                )}
                <div className="h-px bg-border my-2"></div>
                <div className="flex justify-between text-lg">
                  <span className="text-yellow-500 font-black">Total Due Today</span>
                  <span className="font-black text-yellow-500">PKR {paymentGateInfo.totalDueToday.toLocaleString()}</span>
                </div>
              </div>
              
              {paymentGateInfo.totalDueToday > 0 ? (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Amount Paid (PKR)</label>
                  <input
                    type="number"
                    min="0"
                    value={paymentGateInfo.paymentInput}
                    onChange={(e) => setPaymentGateInfo(prev => prev ? {...prev, paymentInput: e.target.value} : null)}
                    className="flex h-12 w-full rounded-lg border-2 border-yellow-500/30 bg-background px-4 text-lg font-black focus:border-yellow-500 outline-none transition-all text-white"
                  />
                </div>
              ) : (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-center">
                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">No payment required</p>
                </div>
              )}
              
              <div className="flex gap-3 pt-4">
                <Button
                  onClick={() => setPaymentGateInfo(null)}
                  variant="ghost"
                  className="flex-1 rounded-xl h-12 font-black tracking-widest uppercase"
                >
                  CANCEL
                </Button>
                <Button
                  onClick={handleSavePlan}
                  disabled={isSavingPackage}
                  className="flex-1 rounded-xl h-12 font-black tracking-widest bg-yellow-500 text-black hover:bg-yellow-600 uppercase"
                >
                  {isSavingPackage ? "PROCESSING..." : (paymentGateInfo.totalDueToday > 0 ? "CONFIRM & PAY" : "CONFIRM CHANGE")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
