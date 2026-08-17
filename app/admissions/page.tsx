"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { dbService } from "@/lib/supabase";
import { memberCache } from "@/lib/member-cache";
import { hardwareApi, ZKAddUserResult, ZKEnrollResult } from "@/lib/hardware-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Banknote, Briefcase, CheckCircle2, Dumbbell, Fingerprint, Loader2, UserPlus } from "lucide-react";

const getTodayLocalDate = () => {
   const now = new Date();
   const year = now.getFullYear();
   const month = String(now.getMonth() + 1).padStart(2, '0');
   const day = String(now.getDate()).padStart(2, '0');
   return `${year}-${month}-${day}`;
};

const CARDIO_FEE = 2500;
const CARDIO_ONLY_PACKAGE = "Cardio Only";

type AdmissionMode = 'member' | 'employee';

/**
 * Two-step enrollment state machine:
 * IDLE → STEP1_SENDING → STEP1_DONE → STEP2_SCANNING → STEP2_DONE
 *         ↓ error                      ↓ error
 *         FAILED                        FAILED
 */
type EnrollState =
   | 'IDLE'
   | 'STEP1_SENDING'
   | 'STEP1_DONE'
   | 'STEP2_SCANNING'
   | 'STEP2_DONE'
   | 'FAILED';

const getDefaultFormData = (mode: AdmissionMode, zkId: string = "") => ({
   name: "",
   phone: "",
   gender: mode === 'employee' ? "Not specified" : "",
   trainer_name: mode === 'employee' ? "Unassigned" : "",
   package_type: mode === 'employee' ? "Employee" : "Basic",
   trainer_package_type: "none",
   membership_fee: mode === 'employee' ? "0" : "2500",
   admission_fee: mode === 'employee' ? "0" : "2000",
   trainer_fees: "0",
   amount_paid: mode === 'employee' ? "0" : "",
   zk_id: zkId,
   is_premium: mode === 'employee',
   has_cardio: false,
   trainer_commission: "0",
   package_start_date: getTodayLocalDate(),
   custom_package_duration: "3",
   custom_package_price: "12000"
});

export default function AdmissionsPage() {
  const cacheVersion = useSyncExternalStore(
    memberCache.subscribe,
    memberCache.getSnapshot,
    () => 0
  );

   const trainers = useMemo(() => memberCache.getAllTrainers(), [cacheVersion]);
   const [admissionMode, setAdmissionMode] = useState<AdmissionMode>('member');
   
   const [packages, setPackages] = useState<any[]>([]);
   const [addons, setAddons] = useState<any[]>([]);
   const [ptPackages, setPtPackages] = useState<any[]>([]);
   const [settings, setSettings] = useState<any>(null);

   useEffect(() => {
      const pkgs = dbService.getCachedPackages() || [];
      const adds = dbService.getCachedAddons() || [];
      const pts = dbService.getCachedPTPackages() || [];
      const sets = dbService.getCachedSettings() || null;

      setPackages(pkgs);
      setAddons(adds);
      setPtPackages(pts);
      setSettings(sets);

      if (pkgs.length > 0) {
         setFormData(prev => {
            if (prev.package_type === 'Basic' || !pkgs.some(p => p.id === prev.package_type || p.name === prev.package_type)) {
               return { ...prev, package_type: pkgs[0].id };
            }
            return prev;
         });
      }
   }, [cacheVersion]);

   const [formData, setFormData] = useState(getDefaultFormData('member'));
   const [employeeId, setEmployeeId] = useState("001");
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
   const [bridgeNotice, setBridgeNotice] = useState<string | null>(null);
   const [isBridgeActive, setIsBridgeActive] = useState(false);

  // Two-step enrollment state
  const [enrollState, setEnrollState] = useState<EnrollState>('IDLE');
   const [step1Result, setStep1Result] = useState<ZKAddUserResult | null>(null);
   const [step2Result, setStep2Result] = useState<ZKEnrollResult | null>(null);

   const switchAdmissionMode = (mode: AdmissionMode) => {
      setAdmissionMode(mode);
      setError(null);
      setBridgeNotice(null);
      setSuccess(false);
      setEnrollState('IDLE');
      setStep1Result(null);
      setStep2Result(null);

      if (mode === 'employee') {
         dbService.getNextEmployeeId().then(setEmployeeId).catch(() => setEmployeeId("001"));
      }

      setFormData(prev => getDefaultFormData(mode, prev.zk_id));
   };

  useEffect(() => {
    const initPage = async () => {
          memberCache.initialize();
          const [nextId, nextEmployeeId] = await Promise.all([
             dbService.getNextZkId(),
             dbService.getNextEmployeeId(),
          ]);

          // Auto-suggest next Scanner ID
          setFormData(prev => ({ ...prev, zk_id: nextId }));
          setEmployeeId(nextEmployeeId);

          // Check if the hardware bridge is reachable
          try {
            const status = await hardwareApi.getStatus();
            setIsBridgeActive(!!status?.online);
          } catch {
            setIsBridgeActive(false);
          }
    };
    initPage();
  }, []);

  // Dynamic Fee Calculation
  useEffect(() => {
      if (admissionMode !== 'member') {
         return;
      }

      let mFee = 5000;
      if (formData.package_type === 'custom') {
         mFee = Number(formData.custom_package_price) || 0;
      } else {
         const selectedPkg = packages.find(p => p.id === formData.package_type || p.name === formData.package_type);
         mFee = selectedPkg ? selectedPkg.price : 5000;
      }

      // Cardio Add-on Price
      const cardioAddonPkg = addons.find(a => a.name.toLowerCase().includes('cardio') || a.id === 'add_cardio');
      const cardioFee = cardioAddonPkg ? cardioAddonPkg.price : 2500;

      const isCardioOnlyPackage = formData.package_type === CARDIO_ONLY_PACKAGE || formData.package_type === "pkg_cardio";
      if (!isCardioOnlyPackage && formData.has_cardio) {
         mFee += cardioFee;
      }

      let tFee = 0;
      const selectedPt = ptPackages.find(pt => pt.id === formData.trainer_package_type || pt.name === formData.trainer_package_type);
      if (selectedPt) {
         tFee = selectedPt.price;
      } else if (formData.trainer_package_type === "Commissioned") {
         tFee = Number(formData.trainer_commission) || 0;
      }

       const standardAdmissionFee = settings ? settings.admissionFee : 2000;
       let aFee = formData.is_premium ? 0 : Number(formData.admission_fee);
       if (Number.isNaN(aFee)) {
          aFee = standardAdmissionFee;
       }

      setFormData(prev => ({ 
        ...prev, 
        membership_fee: String(mFee),
        trainer_fees: String(tFee),
        admission_fee: String(aFee),
        amount_paid: String(mFee + tFee + aFee)
      }));
   }, [admissionMode, formData.package_type, formData.trainer_package_type, formData.is_premium, formData.has_cardio, formData.trainer_commission, formData.custom_package_price, formData.admission_fee, packages, addons, ptPackages, settings]);

  /**
   * Dynamic button handler — dispatches to Step 1 or Step 2
   * based on current enrollment state.
   */
  const handleEnrollmentAction = async () => {
      if (!formData.name) {
         setError("Please enter a Name before triggering hardware enrollment.");
         return;
      }

      if (!formData.zk_id) {
         setError("Please enter a Scanner ID first.");
         return;
      }

      const scannerIdInput = formData.zk_id.trim();
      if (!/^\d+$/.test(scannerIdInput)) {
         setError("Scanner ID must be numeric. uid and user_id must match.");
         return;
      }

      const normalizedScannerId = String(Number.parseInt(scannerIdInput, 10));
      const normalizedUid = Number.parseInt(normalizedScannerId, 10);
      if (normalizedScannerId !== formData.zk_id) {
         setFormData(prev => ({ ...prev, zk_id: normalizedScannerId }));
      }

      setError(null);
      setBridgeNotice(null);

      // Validation: Check if this Scanner ID is already registered to someone else
      try {
         const existingMember = await dbService.getMemberByFingerprint(normalizedScannerId);
         if (existingMember) {
            setError(`Scanner ID ${normalizedScannerId} is already assigned to ${existingMember.name}. Please use a different ID.`);
            return;
         }
      } catch (e) {
         console.warn("Uniqueness check skipped:", e);
      }

      // Route to the correct step
      if (enrollState === 'IDLE' || enrollState === 'FAILED') {
         await executeStep1(normalizedUid, normalizedScannerId);
      } else if (enrollState === 'STEP1_DONE') {
         await executeStep2(normalizedUid, normalizedScannerId);
      }
  };

  /**
   * Step 1: Push user data to the device.
   */
  const executeStep1 = async (uid: number, scannerId: string) => {
      setEnrollState('STEP1_SENDING');
      setStep1Result(null);
      setStep2Result(null);

      try {
         const result = await hardwareApi.addUser({
            uid,
            user_id: scannerId,
            name: formData.name.trim(),
            finger_index: 0,
         });

         console.log("Step 1 result:", result);

         setStep1Result(result);
         setFormData(prev => ({
            ...prev,
            zk_id: result.user?.user_id || scannerId,
         }));
         setEnrollState('STEP1_DONE');
         setBridgeNotice("User data sent to device. Now scan fingerprint.");
      } catch (err: any) {
         console.error("Step 1 error:", err);
         const message = err.message || "Could not communicate with the scanner bridge.";

         // Handle conflict (user already exists on device)
         if (err.status === 500 && /already|exist|duplicate/i.test(message)) {
            const suggested = String(uid + 1);
            setFormData(prev => ({ ...prev, zk_id: suggested }));
            setError(`${message}. Suggested next Scanner ID: ${suggested}`);
         } else {
            setError(message);
         }
         setEnrollState('FAILED');
      }
  };

  /**
   * Step 2: Start fingerprint enrollment on the device.
   */
  const executeStep2 = async (uid: number, scannerId: string) => {
      setEnrollState('STEP2_SCANNING');
      setStep2Result(null);

      try {
         const result = await hardwareApi.enrollFinger({
            uid,
            user_id: scannerId,
            finger_index: 0,
         });

         console.log("Step 2 result:", result);

         if (result.success) {
            setStep2Result(result);
            setEnrollState('STEP2_DONE');
            setBridgeNotice("Fingerprint enrolled successfully!");
         } else {
            // Enrollment returned but wasn't successful
            setError(result.message || "Fingerprint enrollment failed. Please try again.");
            setEnrollState('STEP1_DONE'); // Allow retrying Step 2
         }
      } catch (err: any) {
         console.error("Step 2 error:", err);
         const message = err.message || "Fingerprint enrollment failed.";

         // Handle 409 conflict (finger already has template)
         if (err.status === 409) {
            setStep2Result({ success: true, message: "Existing fingerprint accepted." });
            setEnrollState('STEP2_DONE');
            setBridgeNotice("Existing fingerprint template found — enrollment accepted.");
            return;
         }

         // Handle 404 (user not found on device — need to redo Step 1)
         if (err.status === 404) {
            setError("User not found on device. Please re-register user data first.");
            setEnrollState('FAILED');
            setStep1Result(null);
            return;
         }

         setError(message);
         // Stay at STEP1_DONE so user can retry fingerprint
         setEnrollState('STEP1_DONE');
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 1. Basic Name Validation
    if (!formData.name || formData.name.trim().length < 3) {
      setError("Please enter a valid full name (at least 3 characters).");
      return;
    }

    // 2. Strict Phone Validation (11 characters, numeric only)
    const phoneClean = formData.phone.trim();
    if (phoneClean.length !== 11 || !/^\d+$/.test(phoneClean)) {
      setError("Phone number must be exactly 11 digits (e.g., 03001234567).");
      return;
    }

    // 3. Scanner Enrollment Check
    // If the bridge is online: full 2-step enrollment (fingerprint) is required.
    // If the bridge is offline: allow saving with just the zk_id (enrollment can be done later).
    const enrollmentStarted = enrollState !== 'IDLE' && enrollState !== 'FAILED';
    if (isBridgeActive && enrollmentStarted && enrollState !== 'STEP2_DONE') {
      setError("Fingerprint enrollment started but not completed. Finish scanning or reset enrollment.");
      return;
    }
    if (isBridgeActive && !enrollmentStarted) {
      setError("Bridge is online — please complete biometric enrollment before saving.");
      return;
    }

    // 4. Scanner ID Validation (required in all cases)
    if (!formData.zk_id || !/^\d+$/.test(formData.zk_id.trim())) {
      setError("Scanner ID is required and must be numeric (e.g. 1, 2, 3...).");
      return;
    }

    const cardioOnlySelected = formData.package_type === CARDIO_ONLY_PACKAGE;

    try {
      setError(null);
      setIsSubmitting(true);

      if (admissionMode === 'employee') {
         await dbService.createMember({
                serial_number: employeeId,
           name: formData.name,
           phone: formData.phone,
           gender: 'Not specified',
           trainer_name: 'Unassigned',
           package_type: 'Employee',
           trainer_package_type: 'none',
           membership_fee: '0',
           admission_fee: '0',
           trainer_fees: '0',
           amount_paid: '0',
           is_premium: true,
           has_cardio: false,
           trainer_commission: '0',
           package_start_date: getTodayLocalDate(),
           zk_id: formData.zk_id,
           gym_fees: 0,
         });
      } else {
         // Keep one-time admission separate from recurring gym_fees.
         const isCustom = formData.package_type === "custom";
         const finalPackageType = isCustom 
            ? `Custom (${formData.custom_package_duration} Months)` 
            : formData.package_type;

         await dbService.createMember({
            ...formData,
            package_type: finalPackageType,
            has_cardio: cardioOnlySelected ? false : formData.has_cardio,
            gym_fees: Number(formData.membership_fee)
         });
      }

      setSuccess(true);
      setBridgeNotice(null);
      setTimeout(async () => {
         setSuccess(false);
         setEnrollState('IDLE');
         setStep1Result(null);
         setStep2Result(null);
         setBridgeNotice(null);
         
         // Fetch next IDs again for the next user
         const [nextId, nextEmployeeId] = await Promise.all([
           dbService.getNextZkId(),
           dbService.getNextEmployeeId(),
         ]);
         setFormData(getDefaultFormData(admissionMode, nextId));
         setEmployeeId(nextEmployeeId);
      }, 3000);
    } catch (err: any) {
      console.error(err);
         setBridgeNotice(null);
      setError(err.message || "Failed to admit member. Check your database tables.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
     const { id, value } = e.target;
     setFormData(prev => ({
        ...prev,
        [id]: value,
        ...(id === 'package_type' && value === CARDIO_ONLY_PACKAGE ? { has_cardio: false } : {}),
     }));
  };

  const isCardioOnlyPackage = formData.package_type === CARDIO_ONLY_PACKAGE;

  const isNameValid = formData.name.trim().length >= 3;
  const isPhoneValid = formData.phone.trim().length === 11 && /^\d+$/.test(formData.phone.trim());
  const isFormValid = isNameValid && isPhoneValid;

  /* ─── Dynamic button label / icon / state ─── */
  const getEnrollButtonConfig = () => {
     switch (enrollState) {
        case 'IDLE':
        case 'FAILED':
           return {
              label: "Register on Device",
              icon: <UserPlus className="w-4 h-4 mr-2" />,
              disabled: !formData.zk_id || !isFormValid,
              variant: "outline" as const,
           };
        case 'STEP1_SENDING':
           return {
              label: "Pushing Data...",
              icon: <Loader2 className="w-4 h-4 mr-2 animate-spin" />,
              disabled: true,
              variant: "outline" as const,
           };
        case 'STEP1_DONE':
           return {
              label: "Scan Fingerprint",
              icon: <Fingerprint className="w-4 h-4 mr-2" />,
              disabled: false,
              variant: "default" as const,
           };
        case 'STEP2_SCANNING':
           return {
              label: "Place Finger on Device...",
              icon: <Loader2 className="w-4 h-4 mr-2 animate-spin" />,
              disabled: true,
              variant: "default" as const,
           };
        case 'STEP2_DONE':
           return {
              label: "",
              icon: <CheckCircle2 className="text-emerald-500 w-5 h-5" />,
              disabled: true,
              variant: "ghost" as const,
           };
     }
  };

  const btnConfig = getEnrollButtonConfig();

  /* ─── Status panel text + styles ─── */
  const getStatusPanelConfig = () => {
     switch (enrollState) {
        case 'IDLE':
           return {
              text: "Waiting for enrollment command...",
              className: "bg-secondary/20 border border-border/40",
              textClass: "text-muted-foreground",
           };
        case 'STEP1_SENDING':
           return {
              text: "Sending user data to the device...",
              className: "bg-blue-500/20 animate-pulse border border-blue-500/40",
              textClass: "text-blue-400 italic",
           };
        case 'STEP1_DONE':
           return {
              text: "✓ User registered on device — Now click \"Scan Fingerprint\" and place finger on scanner",
              className: "bg-amber-500/10 border border-amber-500/30",
              textClass: "text-amber-400",
           };
        case 'STEP2_SCANNING':
           return {
              text: "Scanner active: Place finger on the device to enroll biometric template",
              className: "bg-primary/20 animate-pulse border border-primary/40",
              textClass: "text-primary italic",
           };
        case 'STEP2_DONE':
           return {
              text: "Biometric registration complete!",
              className: "bg-emerald-500/20 border border-emerald-500/40",
              textClass: "text-emerald-500",
           };
        case 'FAILED':
           return {
              text: "Enrollment failed — fix the error and retry",
              className: "bg-red-500/10 border border-red-500/30",
              textClass: "text-red-500",
           };
     }
  };

  const statusConfig = getStatusPanelConfig();

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center gap-4">
        <div className="bg-yellow-500 p-2 rounded-lg rotate-12 shadow-[0_0_20px_rgba(234,179,8,0.4)]">
          <Dumbbell className="w-8 h-8 text-black" />
        </div>
        <div className="flex flex-col">
           <h1 className="text-4xl font-[1000] tracking-tighter italic leading-none flex items-center">
             <span className="text-white">WORK</span><span className="text-yellow-500">OUT</span>
             <span className="text-yellow-500 text-xs font-bold tracking-wider ml-2 bg-yellow-500/10 px-1.5 py-0.5 rounded border border-yellow-500/20">CH. 1</span>
             <span className="mx-3 text-muted-foreground/30 font-light not-italic">|</span>
             <span className="text-white/40 text-2xl uppercase tracking-tighter transition-all">New Admissions</span>
           </h1>
          <p className="text-[10px] font-black uppercase tracking-[0.5em] text-yellow-500/60 mt-1">Biometric Enrollment Registry</p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4">
        {success ? (
          <Card className="bg-card/50 backdrop-blur border-border max-w-2xl mx-auto p-8 shadow-2xl animate-in zoom-in-95 duration-300">
            <CardContent className="flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center animate-bounce">
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-black tracking-tighter text-emerald-500 uppercase">
                  {admissionMode === 'member' ? 'Member Admitted!' : 'Employee Enrolled!'}
                </h2>
                <p className="text-muted-foreground text-lg">
                  {admissionMode === 'member'
                    ? 'Successfully registered and payment logged. Access granted.'
                    : 'Staff profile and biometric data synchronized successfully.'}
                </p>
              </div>
              <Button onClick={() => setSuccess(false)} variant="outline" className="mt-4">
                Admit Another
              </Button>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Personal & Membership Details */}
            <div className="lg:col-span-7 space-y-6">
              <Card className="bg-card/50 backdrop-blur border-border shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500" />
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <div className="space-y-1">
                      <CardTitle className="text-2xl font-black uppercase tracking-tighter italic">
                        Registration Details
                      </CardTitle>
                      <CardDescription>Enter personal information and select membership plans</CardDescription>
                    </div>
                    <div className="flex p-1 rounded-lg bg-secondary/30 border border-border/50">
                      <Button
                        type="button"
                        size="sm"
                        variant={admissionMode === 'member' ? 'default' : 'ghost'}
                        onClick={() => switchAdmissionMode('member')}
                        className="text-[10px] font-bold uppercase tracking-wider h-8 px-4"
                      >
                        Member
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={admissionMode === 'employee' ? 'default' : 'ghost'}
                        onClick={() => switchAdmissionMode('employee')}
                        className="text-[10px] font-bold uppercase tracking-wider h-8 px-4"
                      >
                        Employee
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-8">
                  {/* Basic Info Group */}
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-yellow-500/80 mb-2">Personal Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-xs font-bold uppercase text-muted-foreground">Full Name</Label>
                        <Input id="name" placeholder="e.g. Liam Sterling" value={formData.name} onChange={handleChange} required className={`h-12 text-base transition-all ${!isNameValid && formData.name.length > 0 ? "border-red-500 bg-red-500/5 focus-visible:ring-red-500" : "bg-background/50 backdrop-blur-sm focus:bg-background"}`} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="text-xs font-bold uppercase text-muted-foreground">Phone Number</Label>
                        <Input id="phone" type="tel" placeholder="0300 0000000" value={formData.phone} onChange={handleChange} required className={`h-12 text-base font-mono transition-all ${!isPhoneValid && formData.phone.length > 0 ? "border-red-500 bg-red-500/5 focus-visible:ring-red-500" : "bg-background/50 backdrop-blur-sm focus:bg-background"}`} />
                      </div>
                    </div>
                  </div>

                  {admissionMode === 'member' ? (
                    <>
                      {/* Membership Details Group */}
                      <div className="space-y-6 pt-6 border-t border-border/50">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-yellow-500/80 mb-2">Membership & Package</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <Label htmlFor="gender" className="text-xs font-bold uppercase text-muted-foreground">Gender Selection</Label>
                            <select id="gender" value={formData.gender} onChange={handleChange} className="flex h-12 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all cursor-pointer">
                              <option value="" className="bg-[#0f172a]">Select gender...</option>
                              <option value="Male" className="bg-[#0f172a]">Male</option>
                              <option value="Female" className="bg-[#0f172a]">Female</option>
                              <option value="Other" className="bg-[#0f172a]">Other</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="package_start_date" className="text-xs font-bold uppercase text-muted-foreground">Package Activation Date</Label>
                            <Input id="package_start_date" type="date" value={formData.package_start_date} onChange={handleChange} required className="h-12 bg-background/50 backdrop-blur-sm" />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <Label htmlFor="package_type" className="text-xs font-bold uppercase text-muted-foreground">Gym Membership Plan</Label>
                            <select id="package_type" value={formData.package_type} onChange={handleChange} className="flex h-12 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer">
                              {packages.map(p => (
                                <option key={p.id} value={p.id} className="bg-[#0f172a]">{p.name} ({p.price.toLocaleString()} PKR)</option>
                              ))}
                              <option value="custom" className="bg-[#0f172a]">Custom Package...</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="trainer_package_type" className="text-xs font-bold uppercase text-muted-foreground">Personal Trainer Cycle</Label>
                            <select id="trainer_package_type" value={formData.trainer_package_type} onChange={handleChange} className="flex h-12 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer">
                              <option value="none" className="bg-[#0f172a]">No Private Trainer</option>
                              {ptPackages.map(pt => (
                                <option key={pt.id} value={pt.id} className="bg-[#0f172a]">{pt.name} ({pt.price.toLocaleString()} PKR)</option>
                              ))}
                              <option value="Commissioned" className="bg-[#0f172a]">Commission Based (Custom)</option>
                            </select>
                          </div>
                        </div>

                        {formData.package_type === 'custom' && (
                          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/20 animate-in slide-in-from-top-2 duration-300">
                            <div className="space-y-2">
                              <Label htmlFor="custom_package_duration" className="text-yellow-500 font-bold uppercase text-[10px]">Custom Duration (Months)</Label>
                              <select 
                                id="custom_package_duration" 
                                value={formData.custom_package_duration} 
                                onChange={handleChange}
                                className="flex h-12 w-full rounded-md border border-yellow-500/30 bg-background/50 px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-yellow-500 cursor-pointer"
                              >
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24].map(m => (
                                  <option key={m} value={String(m)} className="bg-[#0f172a]">{m} Month{m > 1 ? 's' : ''}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="custom_package_price" className="text-yellow-500 font-bold uppercase text-[10px]">Custom Amount (PKR)</Label>
                              <Input 
                                id="custom_package_price" 
                                type="number" 
                                placeholder="Enter custom price..." 
                                value={formData.custom_package_price} 
                                onChange={handleChange} 
                                className="h-12 border-yellow-500/30 bg-yellow-500/5 focus-visible:ring-yellow-500 font-bold text-white" 
                              />
                            </div>
                          </div>
                        )}

                        {formData.trainer_package_type === 'Commissioned' && (
                          <div className="space-y-2 animate-in slide-in-from-top-2 duration-300">
                            <Label htmlFor="trainer_commission" className="text-yellow-500 font-bold uppercase text-[10px]">Custom Commission Amount (PKR)</Label>
                            <Input id="trainer_commission" type="number" placeholder="Enter custom amount..." value={formData.trainer_commission} onChange={handleChange} className="h-12 border-yellow-500/30 bg-yellow-500/5 focus-visible:ring-yellow-500 font-bold" />
                          </div>
                        )}

                        <div className="space-y-2 pt-2">
                          <Label htmlFor="trainer_name" className="text-xs font-bold uppercase text-muted-foreground">Assigned Professional Trainer</Label>
                          <select id="trainer_name" value={formData.trainer_name} onChange={handleChange} className="flex h-12 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-base ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer">
                            <option value="Unassigned" className="bg-[#0f172a]">Pick an official trainer from the registry...</option>
                            {trainers.map(t => (
                              <option key={t.id} value={t.name} className="bg-[#0f172a]">{t.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-emerald-500/20 rounded-lg">
                          <Briefcase className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-emerald-400 uppercase tracking-widest leading-none">Internal Staff Protocol</p>
                          <p className="text-[10px] text-muted-foreground uppercase mt-1">Automatic ID sequencing and profile creation</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="employee_id" className="text-[10px] font-bold uppercase text-emerald-500/70">Employee Registry Number</Label>
                          <Input id="employee_id" value={employeeId} readOnly className="bg-emerald-500/10 border-emerald-500/20 font-black text-2xl h-14 tracking-widest text-emerald-500 text-center" />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Employees are exempt from system fees. Biometric enrollment is required for attendance tracking only.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Financials & Biometrics */}
            <div className="lg:col-span-5 space-y-6">
              {/* Financial Settlement Card (Only for members) */}
              {admissionMode === 'member' && (
                <Card className="bg-emerald-500/[0.03] backdrop-blur-xl border-emerald-500/20 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
                  <div className="absolute -top-12 -right-12 p-8 opacity-[0.05] group-hover:rotate-12 transition-transform duration-700">
                    <Banknote className="w-32 h-32 text-emerald-500" />
                  </div>
                  <CardHeader>
                    <CardTitle className="text-xl font-black italic uppercase tracking-tighter text-emerald-500 flex items-center gap-2">
                      <Banknote className="w-6 h-6" />
                      Initial Settlement
                    </CardTitle>
                    <CardDescription className="text-emerald-500/60 font-medium">Automatic ledger calculation and payment logging</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex flex-wrap items-center gap-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/10">
                      {!isCardioOnlyPackage && (
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            id="has_cardio"
                            checked={formData.has_cardio}
                            onChange={(e) => setFormData(p => ({ ...p, has_cardio: e.target.checked }))}
                            className="w-5 h-5 rounded border-emerald-500/40 text-emerald-500 focus:ring-emerald-500 cursor-pointer bg-black/20"
                          />
                          <Label htmlFor="has_cardio" className="text-[10px] text-emerald-500 font-black uppercase cursor-pointer tracking-wider">Cardio</Label>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-3 border-l border-emerald-500/20 pl-6">
                        <input
                          type="checkbox"
                          id="is_premium"
                          checked={formData.is_premium}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setFormData(p => ({
                              ...p,
                              is_premium: checked,
                              admission_fee: checked ? "0" : (p.admission_fee === "0" ? String(settings ? settings.admissionFee : 2000) : p.admission_fee)
                            }));
                          }}
                          className="w-5 h-5 rounded border-emerald-500/40 text-emerald-500 focus:ring-emerald-500 cursor-pointer bg-black/20"
                        />
                        <Label htmlFor="is_premium" className="text-[10px] text-emerald-500 font-black uppercase cursor-pointer tracking-wider">Premium (VIP)</Label>
                      </div>

                      <div className="flex items-center gap-3 border-l border-emerald-500/20 pl-6">
                        <input
                          type="checkbox"
                          id="admission_1000"
                          checked={formData.admission_fee === "1000"}
                          disabled={formData.is_premium}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setFormData(p => ({
                              ...p,
                              admission_fee: checked ? "1000" : String(settings ? settings.admissionFee : 2000)
                            }));
                          }}
                          className="w-5 h-5 rounded border-emerald-500/40 text-emerald-500 focus:ring-emerald-500 cursor-pointer bg-black/20 disabled:opacity-50"
                        />
                        <Label htmlFor="admission_1000" className="text-[10px] text-emerald-500 font-black uppercase cursor-pointer tracking-wider disabled:opacity-50">Admission 1000</Label>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <span className="text-[9px] font-black text-muted-foreground uppercase">Gym Fee</span>
                        <div className="bg-secondary/20 h-10 flex items-center justify-center font-mono text-sm border border-border/50 rounded-md">{formData.membership_fee}</div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-black text-muted-foreground uppercase">Admission</span>
                        <div className="bg-secondary/20 h-10 flex items-center justify-center font-mono text-sm border border-border/50 rounded-md">{formData.admission_fee}</div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-black text-muted-foreground uppercase">Trainer</span>
                        <div className="bg-secondary/20 h-10 flex items-center justify-center font-mono text-sm border border-border/50 rounded-md">{formData.trainer_fees}</div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-emerald-500/20 space-y-2">
                      <Label htmlFor="amount_paid" className="text-emerald-500 font-black uppercase text-xs tracking-widest flex items-center justify-between">
                        Total Payment Received (PKR)
                        <span className="bg-emerald-500 text-black px-2 py-0.5 rounded text-[10px]">REQUIRED</span>
                      </Label>
                      <Input id="amount_paid" type="number" placeholder="0" value={formData.amount_paid} onChange={handleChange} className="h-14 border-emerald-500/40 bg-emerald-500/10 focus-visible:ring-emerald-500 text-2xl font-black text-emerald-500 text-center" />
                      <p className="text-[10px] text-emerald-500/60 italic text-center font-medium">Verified by automated billing system.</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Biometric Scanner Card */}
              <Card className="bg-card/50 backdrop-blur border-border shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-black italic uppercase tracking-tighter flex items-center gap-2">
                    <Fingerprint className="w-5 h-5 text-primary" />
                    Biometric Enrollment
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex gap-4">
                    <div className="w-24 shrink-0">
                      <Label className="text-[9px] font-black uppercase text-muted-foreground mb-1 block">Device ID</Label>
                      <Input id="zk_id" type="text" value={formData.zk_id} onChange={(e) => setFormData(p => ({ ...p, zk_id: e.target.value }))} className="h-12 font-black text-lg text-center bg-background/50 backdrop-blur-sm border-2 border-primary/20" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-[9px] font-black uppercase text-muted-foreground mb-1 block">Hardware Action</Label>
                      <Button type="button" onClick={handleEnrollmentAction} disabled={btnConfig.disabled || !formData.zk_id} variant={btnConfig.variant} className="w-full h-12 text-sm font-black uppercase italic tracking-wider shadow-lg active:scale-95 transition-all">
                        {btnConfig.icon}
                        {btnConfig.label || "Start Enrollment"}
                      </Button>
                    </div>
                  </div>

                  <div className={`p-4 rounded-xl text-center border-2 transition-all duration-500 ${statusConfig.className}`}>
                    <div className="flex flex-col items-center gap-2">
                      <p className={`text-[10px] uppercase font-black tracking-[0.2em] ${statusConfig.textClass}`}>
                        {statusConfig.text}
                      </p>
                      {enrollState === 'STEP2_DONE' && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/20 rounded-full border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span className="text-[10px] text-emerald-400 font-mono font-bold tracking-tighter">
                            SYNCED: ID {formData.zk_id} {step2Result?.user?.uid != null ? `| UID ${step2Result.user.uid}` : ""}
                          </span>
                        </div>
                      )}
                      {enrollState === 'STEP1_DONE' && (
                        <span className="text-[10px] text-amber-500 font-mono font-bold">
                          READY: WAITING FOR TOUCH (UID: {step1Result?.user?.uid ?? formData.zk_id})
                        </span>
                      )}
                    </div>
                  </div>

                  {error && (
                    <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg animate-in shake-in-radius-2 duration-300">
                      <p className="text-[10px] text-red-500 font-black uppercase tracking-wider mb-1">Hardware Conflict Detected</p>
                      <p className="text-xs text-red-400 leading-tight">{error}</p>
                    </div>
                  )}
                  {bridgeNotice && !error && (
                    <div className="bg-yellow-500/5 border border-yellow-500/20 p-3 rounded-lg flex items-start gap-2">
                      <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full mt-1 shrink-0 animate-pulse" />
                      <p className="text-xs text-yellow-500/70 font-medium leading-tight">{bridgeNotice}</p>
                    </div>
                  )}
                  {!isBridgeActive && (
                    <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg flex items-start gap-2">
                      <div className="w-1.5 h-1.5 bg-amber-500 rounded-full mt-1 shrink-0 animate-pulse" />
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-amber-500 mb-0.5">Bridge Offline — Manual Mode</p>
                        <p className="text-xs text-amber-400/70 leading-tight">The hardware bridge is not running. Set a Scanner ID manually above and save — fingerprint enrollment can be completed later when the bridge is online.</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Mega Submit Button */}
              <div className="space-y-4">
                <Button type="submit" className="w-full h-20 text-xl font-[1000] italic uppercase tracking-tighter group relative overflow-hidden" disabled={!formData.name || !formData.phone || (!isBridgeActive && !formData.zk_id) || (isBridgeActive && enrollState !== 'STEP2_DONE') || isSubmitting}>
                  {isSubmitting ? (
                    <div className="flex items-center gap-4">
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <span>{admissionMode === 'member' ? 'Registering...' : 'Enrolling Staff...'}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <Activity className="w-8 h-8" />
                      <span>{admissionMode === 'member' ? 'Finalize Admission' : 'Commit Staff Profile'}</span>
                    </div>
                  )}
                </Button>
                <p className="text-[10px] text-center text-muted-foreground uppercase font-bold tracking-[0.3em] opacity-40 italic">Secure Ledger Transmission v1.0</p>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
