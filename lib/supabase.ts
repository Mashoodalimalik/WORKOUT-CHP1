/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable prefer-const */
import { createClient } from "@supabase/supabase-js";
import { normalizeDeviceTimestamp } from "./utils";

// Lazy import to avoid circular dependency (member-cache.ts imports supabase.ts)
let _cacheModule: typeof import("./member-cache") | null = null;
const getCache = () => {
  if (!_cacheModule) {
    // Dynamic require — runs synchronously after first import
    try { 
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _cacheModule = require("./member-cache"); 
    } catch { 
      _cacheModule = null; 
    }
  }
  return _cacheModule?.memberCache ?? null;
};

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const isValidUrl = rawSupabaseUrl.startsWith('https://') || rawSupabaseUrl.startsWith('http://');
const supabaseUrl = isValidUrl ? rawSupabaseUrl : 'https://dummy-id.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const isDummy = !isValidUrl || supabaseUrl.includes("dummy-id");

if (!isDummy) {
  console.log("IRON LEDGER: Running in STRICT mode (Supabase Connected)");
} else {
  console.warn("IRON LEDGER: Running in DUMMY mode (No Supabase detected)");
}

// Simulated in-memory storage (dummy mode only — no persistence across refresh)
export let simulatedMembers: any[] = [];
export let simulatedTrainers: any[] = [];
export let simulatedLogs: any[] = [];
export let simulatedLedgerEntries: any[] = [];

const pad2 = (value: number) => String(value).padStart(2, '0');

const toLocalDateInputValue = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
};

const toSequenceId = (value: number) => String(Math.max(1, value)).padStart(3, '0');

const parseNumericSerial = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return null;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const getNextSerialFromMembers = (members: any[]) => {
  const maxSerial = members.reduce((max, member) => {
    const parsedSerial = parseNumericSerial(member?.serial_number);
    if (parsedSerial == null) return max;
    return Math.max(max, parsedSerial);
  }, 0);

  return toSequenceId(maxSerial + 1);
};

const toLocalIsoWithOffset = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad2(Math.floor(absOffset / 60));
  const offsetMins = pad2(absOffset % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`;
};

const normalizePackageStartDate = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  return toLocalDateInputValue();
};

const toLocalMidnightIsoWithOffset = (dateInput: string) => {
  const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return toLocalIsoWithOffset();
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const localMidnight = new Date(year, monthIndex, day, 0, 0, 0, 0);
  return toLocalIsoWithOffset(localMidnight);
};

const DAY_IN_MS = 1000 * 60 * 60 * 24;
const CARDIO_ONLY_PACKAGE = 'cardio only';

const DEFAULT_SETTINGS = {
  zkIP: "192.168.1.201",
  zkPort: "4370",
  zkStatus: "Connected",
  zkAutoSync: true,
  adminUser: "Admin",
  adminPass: "Hard!!3s",
  admissionFee: 2000
};

const DEFAULT_PACKAGES = [
  { id: "pkg_strength", name: "Strength (Monthly)", price: 5000, duration: 1, type: "gym" },
  { id: "pkg_cardio", name: "Cardio (Monthly)", price: 3000, duration: 1, type: "gym" },
  { id: "pkg_3month", name: "3 Months Plan", price: 14000, duration: 3, type: "gym" },
  { id: "pkg_6month", name: "6 Months Plan", price: 26000, duration: 6, type: "gym" },
  { id: "pkg_12month", name: "12 Months Plan", price: 50000, duration: 12, type: "gym" },
  { id: "pkg_lifetime", name: "Lifetime Membership", price: 80000, duration: 1200, type: "gym" }
];

const DEFAULT_ADDONS = [
  { id: "add_cardio", name: "Cardio Add-on (Monthly)", price: 2500 },
  { id: "add_pool_only", name: "Pool Only (Monthly)", price: 3000 },
  { id: "add_pool_add", name: "Pool Add-on (Monthly)", price: 1500 }
];

const DEFAULT_PT_PACKAGES = [
  { id: "pt_basic", name: "PT Basic (Coaching)", price: 8000, type: "pt" },
  { id: "pt_regular", name: "PT Regular (Guided)", price: 12000, type: "pt" },
  { id: "pt_target", name: "PT Target (Advanced)", price: 20000, type: "pt" }
];

let cachedSettings = { ...DEFAULT_SETTINGS };
let cachedPackages = [...DEFAULT_PACKAGES];
let cachedAddons = [...DEFAULT_ADDONS];
let cachedPTPackages = [...DEFAULT_PT_PACKAGES];

const getGymPackageDurationMonths = (packageType: unknown) => {
  const normalized = String(packageType || '').toLowerCase();
  
  const customMatch = normalized.match(/custom\s*\((\d+)\s*month/);
  if (customMatch) {
    return parseInt(customMatch[1], 10);
  }

  const pkg = cachedPackages.find(p => p.name.toLowerCase() === normalized || p.id.toLowerCase() === normalized);
  if (pkg) return pkg.duration;
  
  if (normalized === '6 months') return 6;
  if (normalized === '12 months') return 12;
  if (normalized === 'lifetime') return 1200;
  return 1;
};

const getGymCycleDays = (packageType: unknown) => {
  const duration = getGymPackageDurationMonths(packageType);
  if (duration >= 1200) return 99999;
  return duration * 30;
};

const getPackageExpectedGymFee = (packageType: unknown, hasCardio: unknown) => {
  const normalized = String(packageType || '').toLowerCase();
  if (normalized.startsWith('custom')) {
    return null;
  }
  
  const pkg = cachedPackages.find(p => p.name.toLowerCase() === normalized || p.id.toLowerCase() === normalized);
  let basePrice = 0;
  if (pkg) {
    basePrice = pkg.price;
  } else {
    if (normalized === CARDIO_ONLY_PACKAGE) basePrice = 3000; // Default cardio only
    else if (normalized === 'basic') basePrice = 2500;
    else if (normalized === '6 months') basePrice = 10000;
    else if (normalized === '12 months') basePrice = 15000;
    else if (normalized === 'lifetime') basePrice = 25000;
    else if (normalized === 'employee') basePrice = 0;
  }

  const cardioAddonPkg = cachedAddons.find(a => a.name.toLowerCase().includes('cardio'));
  const cardioFee = cardioAddonPkg ? cardioAddonPkg.price : 2500;
  const addonCost = hasCardio && normalized !== CARDIO_ONLY_PACKAGE ? cardioFee : 0;

  return basePrice + addonCost;
};

const getPackageExpectedTrainerFee = (trainerPackageType: unknown, trainerCommission: unknown) => {
  const normalized = String(trainerPackageType || '').toLowerCase();
  if (normalized === 'none' || normalized === '') return 0;
  if (normalized === 'commissioned') return Math.max(0, Number(trainerCommission) || 0);

  const pt = cachedPTPackages.find(p => p.name.toLowerCase() === normalized || p.id.toLowerCase() === normalized);
  if (pt) return pt.price;

  if (normalized === 'monthly') return 8000;
  if (normalized === 'sessions') return 12000;
  return null;
};

const getRecurringGymFee = (member: any) => {
  const storedGymFee = Number(member?.gym_fees) || 0;
  const expectedGymFee = getPackageExpectedGymFee(member?.package_type, member?.has_cardio);

  if (expectedGymFee == null) {
    return storedGymFee;
  }

  if (storedGymFee === expectedGymFee + 1000) {
    return expectedGymFee;
  }

  if (storedGymFee === 0 && expectedGymFee > 0) {
    return expectedGymFee;
  }

  return storedGymFee;
};

const getRecurringTrainerFee = (member: any) => {
  const storedTrainerFee = Math.max(0, Number(member?.trainer_fees) || 0);
  const expectedTrainerFee = getPackageExpectedTrainerFee(member?.trainer_package_type, member?.trainer_commission);

  if (expectedTrainerFee == null) {
    return storedTrainerFee;
  }

  return expectedTrainerFee;
};

const getSafeDate = (input: unknown, fallback: Date = new Date()) => {
  if (input == null || input === '') return fallback;
  const parsed = new Date(String(input));
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
};

const hasTrainerPackage = (member: any) => {
  const trainerType = String(member?.trainer_package_type || '').toLowerCase();
  return trainerType !== '' && trainerType !== 'none';
};

const getCycleEndDate = (startDate: Date, monthsOffset: number): Date => {
  const result = new Date(startDate);
  const targetDay = startDate.getDate();
  result.setMonth(result.getMonth() + monthsOffset);
  if (result.getDate() !== targetDay) {
    result.setDate(0);
  }
  return result;
};

const calculateMonthsElapsed = (startDate: Date, endDate: Date) => {
  if (endDate < startDate) return 0;
  
  let yearDiff = endDate.getFullYear() - startDate.getFullYear();
  let monthDiff = endDate.getMonth() - startDate.getMonth();
  let totalMonths = yearDiff * 12 + monthDiff;
  
  const targetDate = getCycleEndDate(startDate, totalMonths);
  targetDate.setHours(0, 0, 0, 0);
  
  const endCompare = new Date(endDate);
  endCompare.setHours(0, 0, 0, 0);
  
  if (endCompare < targetDate && totalMonths > 0) {
    totalMonths--;
  }
  return totalMonths;
};

export const getMemberPaymentSnapshot = (member: any) => {
  const recurringGymFees = getRecurringGymFee(member);
  const recurringTrainerFees = getRecurringTrainerFee(member);
  const recurringTotal = recurringGymFees + recurringTrainerFees;

  const startDate = getSafeDate(member?.package_start_date ?? member?.created_at, new Date());
  startDate.setHours(0,0,0,0);
  const today = new Date();
  today.setHours(0,0,0,0);

  const gymPackageDuration = getGymPackageDurationMonths(member?.package_type);
  const monthsElapsed = calculateMonthsElapsed(startDate, today);

  const rawGymCyclesElapsed = gymPackageDuration > 0
    ? Math.floor(monthsElapsed / gymPackageDuration)
    : 0;

  const rawTrainerCyclesElapsed = monthsElapsed; 

  const bakedGymCycles = Number(member?.baked_gym_cycles) || 0;
  const bakedTrainerCycles = Number(member?.baked_trainer_cycles) || 0;
  const legacyFees = Number(member?.legacy_fees) || 0;

  const totalGymCyclesStarted = rawGymCyclesElapsed + 1;
  const totalTrainerCyclesStarted = hasTrainerPackage(member) ? rawTrainerCyclesElapsed + 1 : 0;

  const gymCyclesToCharge = Math.max(0, totalGymCyclesStarted - bakedGymCycles);
  const trainerCyclesToCharge = Math.max(0, totalTrainerCyclesStarted - bakedTrainerCycles);

  const totalGymCost = gymCyclesToCharge * recurringGymFees + (bakedGymCycles > 0 || member?.is_premium ? 0 : (Number(member?.admission_fee) || 0));
  const totalTrainerCost = trainerCyclesToCharge * recurringTrainerFees;
  const totalRequired = legacyFees + totalGymCost + totalTrainerCost;
  
  const totalPaid = Math.max(0, Number(member?.amount_paid) || 0);
  
  const balance = totalPaid - totalRequired;
  const isDue = balance < 0;
  const cycleDue = isDue ? Math.abs(balance) : 0;
  const remainingBalance = !isDue ? balance : 0;

  let reason = '';
  if (isDue) {
    if (rawGymCyclesElapsed - bakedGymCycles > 0 || rawTrainerCyclesElapsed - bakedTrainerCycles > 0) {
      reason = 'Cycle Expired / Insufficient Balance';
    } else {
      reason = 'Outstanding Initial Balance';
    }
  }

  const currentCycleStart = new Date(startDate);
  currentCycleStart.setMonth(currentCycleStart.getMonth() + rawGymCyclesElapsed * gymPackageDuration);
  const currentCycleEnd = new Date(currentCycleStart);
  currentCycleEnd.setMonth(currentCycleEnd.getMonth() + gymPackageDuration);

  const daysSinceCycleStart = Math.floor(Math.max(0, today.getTime() - currentCycleStart.getTime()) / DAY_IN_MS);

  const currentCyclePaid = Math.max(0, Math.min(
    totalPaid - (totalRequired - recurringTotal),
    recurringTotal
  ));

  return {
    recurringGymFees,
    recurringTrainerFees,
    recurringTotal,
    totalRequired,
    totalPaid,
    currentCyclePaid,
    cycleDue,
    remainingBalance,
    daysSincePayment: daysSinceCycleStart,
    gymCycleDays: gymPackageDuration * 30,
    trainerCycleDays: 30,
    isDue,
    reason,
    lastPaymentDate: startDate,
  };
};

export const dbService = {
  getMemberAnalytics: async () => {
    const cache = getCache();
    const all = isDummy
      ? simulatedMembers
      : (cache?.isReady() ? cache.getAllMembers() : ((await supabase.from('members').select('*')).data || []));
    return all.map(m => {
       const paymentSnapshot = getMemberPaymentSnapshot(m);
       const daysSinceVisit = m.last_visit ? Math.floor((Date.now() - new Date(m.last_visit).getTime()) / (1000 * 60 * 60 * 24)) : 0;
       const paymentStatus = paymentSnapshot.isDue ? 'due' : 'completed';
       let category = "Active Payer";
       if (paymentStatus === 'due' && daysSinceVisit > 30) category = "Left / Long-Term Unpaid";
       else if (paymentStatus === 'completed' && daysSinceVisit > 30) category = "Inactive Payer (Not Visiting)";
       else if (paymentStatus === 'due') category = "Non-Paying (Active User)";
       return { ...m, payment_status: paymentStatus, category, daysSinceVisit };
    });
  },
  
  getMemberByFingerprint: async (fingerprint: string) => {
    if(!isDummy) {
      // Try cache first (instant O(1) lookup)
      const cache = getCache();
      if (cache?.isReady()) {
        return cache.getMemberByScannerId(fingerprint);
      }
      // Fallback: direct Supabase query (only before cache is initialized).
      // Use array select + [0] instead of .single() to avoid throwing on no match.
      const { data: rows1 } = await supabase
        .from('members')
        .select('*')
        .or(`fingerprint_template.eq."${fingerprint}",zk_id.eq."${fingerprint}"`);
      if (rows1?.[0]) return rows1[0];
      // Retry without quotes for numeric-only IDs stored as plain TEXT
      const { data: rows2 } = await supabase
        .from('members')
        .select('*')
        .or(`fingerprint_template.eq.${fingerprint},zk_id.eq.${fingerprint}`);
      return rows2?.[0] ?? null;
    }
    return simulatedMembers.find(m => m.fingerprint_template === fingerprint || m.zk_id === fingerprint) || null;
  },
  
  logAttendance: async (memberId: string | null, status: 'granted' | 'denied', notes?: string, timestamp?: string) => {
    const normalizedTimestamp = normalizeDeviceTimestamp(timestamp);
    if(!isDummy) {
      const payload: any = { member_id: memberId, status, notes };
      if (normalizedTimestamp) payload.timestamp = normalizedTimestamp;
      const { data } = await supabase.from('attendance_logs').insert([payload]).select('*').single();
      // Append to cache immediately so HOST UI updates instantly
      const cache = getCache();
      if (cache?.isReady() && data) {
        cache.appendLog(data);
      }
      return;
    }
    const dummyLog = { 
      id: Math.random().toString(), 
      member_id: memberId, 
      status, 
      notes, 
      timestamp: normalizedTimestamp ? new Date(normalizedTimestamp) : new Date() 
    };
    simulatedLogs.push(dummyLog);
  },

  getAllMembers: async () => {
    if(!isDummy) {
      const cache = getCache();
      if (cache?.isReady()) return cache.getAllMembers();
      const { data } = await supabase.from('members').select('*');
      return data || [];
    }
    return simulatedMembers;
  },

  getRecentLogs: async (limit: number = 10) => {
    if(!isDummy) {
      const cache = getCache();
      if (cache?.isReady()) return cache.getRecentLogs(limit);
      const { data } = await supabase.from('attendance_logs').select('*, members(name, phone, photo_url)').order('timestamp', { ascending: false }).limit(limit);
      return data || [];
    }
    return simulatedLogs.map(log => ({
      ...log,
      members: simulatedMembers.find(m => m.id === log.member_id)
    })).reverse().slice(0, limit);
  },

  getAttendanceByRange: async (startDate: string, endDate: string) => {
    if(!isDummy) {
      if (typeof window === 'undefined') {
        const { data } = await supabase.from('attendance_logs').select('timestamp, status, notes').gte('timestamp', startDate).lte('timestamp', endDate).order('timestamp', { ascending: false });
        return data || [];
      }

      const cacheKey = `iron_ledger_chart_${startDate.split('-')[0]}`; // group by year
      const cached = sessionStorage.getItem(cacheKey);
      
      if (cached) {
        const { data: cachedData, lastTs } = JSON.parse(cached);
        // Fetch only new logs since lastTs
        const { data: newLogs } = await supabase
          .from('attendance_logs')
          .select('timestamp, status, notes')
          .gt('timestamp', lastTs)
          .lte('timestamp', endDate)
          .order('timestamp', { ascending: false });
        
        const merged = [...(newLogs || []), ...cachedData];
        sessionStorage.setItem(cacheKey, JSON.stringify({
          data: merged,
          lastTs: new Date().toISOString()
        }));
        return merged;
      }
      
      // First load: fetch full range
      const { data } = await supabase
        .from('attendance_logs')
        .select('timestamp, status, notes')
        .gte('timestamp', startDate)
        .lte('timestamp', endDate)
        .order('timestamp', { ascending: false });
      
      sessionStorage.setItem(cacheKey, JSON.stringify({
        data: data || [],
        lastTs: new Date().toISOString()
      }));
      return data || [];
    }
    return simulatedLogs
      .filter(l => {
        const ts = new Date(l.timestamp).getTime();
        return ts >= new Date(startDate).getTime() && ts <= new Date(endDate).getTime();
      })
      .map(log => ({
        ...log,
        members: simulatedMembers.find(m => m.id === log.member_id)
      })).reverse();
  },
  
  createMember: async (payload: any) => {
    const normalizedPackageType = payload.package_type || 'Basic';
    const normalizedHasCardio = String(normalizedPackageType).toLowerCase() === CARDIO_ONLY_PACKAGE
      ? false
      : !!payload.has_cardio;
    const gym_fees = Number(payload.gym_fees) || 0;
    const admission_fee = Number(payload.admission_fee) || 0;
    const trainer_fees = Number(payload.trainer_fees) || 0;
    const amount_paid = Number(payload.amount_paid) || 0;
    const total_fees = gym_fees + trainer_fees + admission_fee;
    const payment_status = amount_paid >= total_fees ? 'completed' : 'due';
    const normalizedPackageStartDate = normalizePackageStartDate(payload.package_start_date);
    const cycleStartTimestamp = toLocalMidnightIsoWithOffset(normalizedPackageStartDate);
    const ledgerTimestamp = cycleStartTimestamp;
    const providedSerial = typeof payload.serial_number === 'string' && payload.serial_number.trim()
      ? payload.serial_number.trim()
      : null;
    const serialNumber = providedSerial || await dbService.getNextMemberSerial();

    if(!isDummy) {
       // Let Supabase handle ID generation for UUID fields
       const { error } = await supabase.from('members').insert([{
         serial_number: serialNumber,
          name: payload.name,
          phone: payload.phone || '',
          gender: payload.gender || 'Not specified',
          trainer_name: payload.trainer_name || 'Unassigned',
          gym_fees: gym_fees,
          admission_fee: admission_fee,
          trainer_fees: trainer_fees,
          amount_paid: amount_paid,
          package_type: normalizedPackageType,
          trainer_package_type: payload.trainer_package_type || 'none',
          has_cardio: normalizedHasCardio,
          is_premium: !!payload.is_premium,
          trainer_commission: Number(payload.trainer_commission) || 0,
           package_start_date: normalizedPackageStartDate,
           // For new admissions, billing cycle starts from selected package_start_date.
           payment_date: amount_paid > 0 ? cycleStartTimestamp : null,
          payment_status: payment_status,
          fingerprint_template: payload.bio,
          zk_id: payload.zk_id,
           last_visit: toLocalIsoWithOffset()
       }]);

       if (error) throw error;

       // AUTOMATED LEDGER SYNC
       if (amount_paid > 0) {
          const isCardioOnlyPackage = String(normalizedPackageType).toLowerCase() === CARDIO_ONLY_PACKAGE;
          const parts = [];
          parts.push(`Gym (${normalizedPackageType})`);
          if (!payload.is_premium) parts.push('Admission');
          if (payload.trainer_package_type !== 'none') {
            const tType = payload.trainer_package_type === 'Commissioned' ? 'Comm' : payload.trainer_package_type;
            parts.push(`Trainer (${tType})`);
          }
          if (normalizedHasCardio && !isCardioOnlyPackage) parts.push('Cardio');

          const desc = `${parts.join(' + ')} - ${payload.name}`;
          
          await dbService.createLedgerEntry({
            type: 'income',
            amount: amount_paid,
            category: 'Membership',
            description: desc,
            // Admission ledger entry should align with selected admission date.
            date: ledgerTimestamp,
          });
       }

       // Refresh cache so the UI picks up the newly created member (with the DB-generated UUID)
       const cache = getCache();
       if (cache?.isReady()) {
         await cache.forceRefresh();
       }
       
       return;
    }
    const newMember = {
       id: Math.random().toString(),
       serial_number: serialNumber,
       name: payload.name,
       phone: payload.phone || '',
       gender: payload.gender || 'Not specified',
       trainer_name: payload.trainer_name || 'Unassigned',
       gym_fees: gym_fees,
       admission_fee: admission_fee,
       trainer_fees: trainer_fees,
       amount_paid: amount_paid,
       package_type: normalizedPackageType,
       trainer_package_type: payload.trainer_package_type || 'none',
       has_cardio: normalizedHasCardio,
       trainer_commission: Number(payload.trainer_commission) || 0,
       package_start_date: normalizedPackageStartDate,
       payment_date: amount_paid > 0 ? cycleStartTimestamp : null,
       payment_status: payment_status,
       fingerprint_template: payload.bio,
       zk_id: payload.zk_id,
       last_visit: toLocalIsoWithOffset()
    };
    simulatedMembers.push(newMember);

    // Sync dummy mode member with cache
    const cache = getCache();
    if (cache) {
      cache.upsertMember(newMember);
    }


    // Dummy mode ledger sync
    if (amount_paid > 0) {
       const isCardioOnlyPackage = String(normalizedPackageType).toLowerCase() === CARDIO_ONLY_PACKAGE;
       const parts = [];
       parts.push(`Gym (${normalizedPackageType})`);
       if (!payload.is_premium) parts.push('Admission');
       if (payload.trainer_package_type !== 'none') {
         const tType = payload.trainer_package_type === 'Commissioned' ? 'Comm' : payload.trainer_package_type;
         parts.push(`Trainer (${tType})`);
       }
       if (normalizedHasCardio && !isCardioOnlyPackage) parts.push('Cardio');

       const desc = `${parts.join(' + ')} - ${payload.name}`;
       simulatedLedgerEntries.push({
         id: Math.random().toString(),
         type: 'income',
         amount: amount_paid,
         category: 'Membership',
         description: desc,
         date: ledgerTimestamp
       });

    }
  },

  updateMemberPayment: async (memberId: string, amount: number, customDate?: string) => {
    if(!isDummy) {
      // Try cache first for member data, fallback to Supabase
      const cache = getCache();
      let member = cache?.isReady() ? cache.getMemberById(memberId) : null;
      if (!member) {
        const { data } = await supabase.from('members').select('*').eq('id', memberId).single();
        member = data;
      }
      if (!member) return;
      const paymentSnapshot = getMemberPaymentSnapshot(member);
      const basePaid = paymentSnapshot.totalPaid;
      const newPaid = basePaid + amount;
      const totalFees = paymentSnapshot.recurringTotal;
      const newStatus = newPaid >= totalFees ? 'completed' : 'due';
      
      // Use custom date if provided, otherwise now.
      // If customDate is YYYY-MM-DD, we convert it to local ISO format for DB consistency.
      const paymentDate = customDate 
        ? (customDate.includes('T') ? customDate : `${customDate}T${new Date().toISOString().split('T')[1]}`)
        : toLocalIsoWithOffset();

      // Each payment resets the 30-day billing clock
      await supabase.from('members').update({ 
        amount_paid: newPaid, 
        payment_status: newStatus, 
        payment_date: paymentDate 
      }).eq('id', memberId);

      // Update cache immediately so UI reflects change
      if (cache?.isReady()) {
        cache.upsertMember({ id: memberId, amount_paid: newPaid, payment_status: newStatus, payment_date: paymentDate });
      }

      // AUTOMATED LEDGER SYNC
      await dbService.createLedgerEntry({
        type: 'income',
        amount: amount,
        category: 'Membership',
        description: `Monthly Subscription Fee - ${member.name}`,
        date: paymentDate,
      });
      return;
    }
    const idx = simulatedMembers.findIndex(m => m.id === memberId);
    if(idx !== -1) {
       const paymentSnapshot = getMemberPaymentSnapshot(simulatedMembers[idx]);
       const paymentDate = customDate || toLocalIsoWithOffset();
       
       simulatedMembers[idx].amount_paid = paymentSnapshot.totalPaid + amount;
       simulatedMembers[idx].payment_status = simulatedMembers[idx].amount_paid >= paymentSnapshot.recurringTotal ? 'completed' : 'due';
       simulatedMembers[idx].payment_date = paymentDate;


       // Dummy mode ledger sync
       simulatedLedgerEntries.push({
         id: Math.random().toString(),
         type: 'income',
         amount: amount,
         category: 'Membership',
         description: `Monthly Subscription Fee - ${simulatedMembers[idx].name}`,
         date: paymentDate
       });

    }
  },

  deleteMember: async (memberId: string) => {
    if(!isDummy) {
      await supabase.from('members').delete().eq('id', memberId);
      const cache = getCache();
      if (cache?.isReady()) cache.removeMember(memberId);
      return;
    }
    simulatedMembers = simulatedMembers.filter(m => m.id !== memberId);
  },

  // Trainer Service Methods
  getAllTrainers: async () => {
    if(!isDummy) {
        const cache = getCache();
        if (cache?.isReady()) return cache.getAllTrainers();
        const { data } = await supabase.from('trainers').select('*');
        return data || [];
    }
    return simulatedTrainers;
  },

  createTrainer: async (payload: { name: string, phone: string }) => {
    if(!isDummy) {
        const { data, error } = await supabase.from('trainers').insert([{
           name: payload.name,
           phone: payload.phone
        }]).select('*').single();

        if (error) throw error;
        
        const cache = getCache();
        if (cache?.isReady() && data) {
          cache.upsertTrainer(data);
        }
        return data;
    }
    const newTrainer = {
        id: Math.random().toString(),
        name: payload.name,
        phone: payload.phone,
        hire_date: new Date().toISOString()
    };
    simulatedTrainers.push(newTrainer);

    // Sync dummy mode trainer with cache
    const cache = getCache();
    if (cache) {
      cache.upsertTrainer(newTrainer);
    }
  },

  deleteTrainer: async (trainerId: string) => {
    if(!isDummy) {
        await supabase.from('trainers').delete().eq('id', trainerId);
        const cache = getCache();
        if (cache?.isReady()) cache.removeTrainer?.(trainerId);
        return;
    }
    simulatedTrainers = simulatedTrainers.filter(t => t.id !== trainerId);
  },

  assignTrainerToMember: async (memberId: string, trainerName: string) => {
    const nameToSave = trainerName === 'Unassigned' ? '' : trainerName;
    if(!isDummy) {
        await supabase.from('members').update({ trainer_name: nameToSave }).eq('id', memberId);
        const cache = getCache();
        if (cache?.isReady()) {
          cache.upsertMember({ id: memberId, trainer_name: nameToSave });
        }
        return;
    }
    const idx = simulatedMembers.findIndex(m => m.id === memberId);
    if(idx !== -1) {
      simulatedMembers[idx].trainer_name = nameToSave;
    }
  },

  updateMemberZkId: async (memberId: string, zkId: string) => {
    if(!isDummy) {
        await supabase.from('members').update({ zk_id: zkId }).eq('id', memberId);
        const cache = getCache();
        if (cache?.isReady()) cache.upsertMember({ id: memberId, zk_id: zkId });
        return;
    }
    const idx = simulatedMembers.findIndex(m => m.id === memberId);
    if(idx !== -1) simulatedMembers[idx].zk_id = zkId;
  },

  simulatePackageUpdate: (member: any, payload: {
    package_type: string,
    trainer_package_type: string,
    has_cardio?: boolean,
    trainer_commission?: number,
    reset_start_date?: boolean,
    amount_paid?: number,
    custom_gym_fees?: number,
  }) => {
    const normalizedPackage = payload.package_type || 'Basic';
    const normalizedTrainerPackage = payload.trainer_package_type || 'none';
    const normalizedCardio = String(normalizedPackage).toLowerCase() === CARDIO_ONLY_PACKAGE
      ? false
      : !!payload.has_cardio;
    const normalizedCommission = Math.max(0, Number(payload.trainer_commission) || 0);

    const oldSnapshot = getMemberPaymentSnapshot(member);
    const oldGymFee = oldSnapshot.recurringGymFees;
    const oldTrainerFee = oldSnapshot.recurringTrainerFees;
    const oldGymCycleDays = oldSnapshot.gymCycleDays;
    
    const isCustom = String(normalizedPackage).toLowerCase().startsWith('custom');
    let nextGymFee = 0;
    if (isCustom) {
      nextGymFee = payload.custom_gym_fees !== undefined ? payload.custom_gym_fees : (Number(member.gym_fees) || 0);
    } else {
      nextGymFee = getPackageExpectedGymFee(normalizedPackage, normalizedCardio) ?? 0;
    }
    const nextTrainerFee = getPackageExpectedTrainerFee(normalizedTrainerPackage, normalizedCommission) ?? 0;
    const nextGymCycleDays = getGymCycleDays(normalizedPackage);
    
    let nextLegacyFees = Number(member.legacy_fees) || 0;
    let nextBakedGym = Number(member.baked_gym_cycles) || 0;
    let nextBakedTrainer = Number(member.baked_trainer_cycles) || 0;
    let nextStartDate = member.package_start_date;
    let nextAmountPaid = member.amount_paid;

    let gymCredit = 0;
    let trainerCredit = 0;

    if (payload.reset_start_date) {
        nextLegacyFees = 0;
        nextStartDate = toLocalDateInputValue(); // TODAY
        nextBakedGym = 0;
        nextBakedTrainer = 0;
        nextAmountPaid = payload.amount_paid !== undefined ? payload.amount_paid : 0;
    } else {
        if (payload.amount_paid !== undefined) {
            nextAmountPaid = (Number(member.amount_paid) || 0) + payload.amount_paid;
        }
        if (oldGymFee !== nextGymFee || oldTrainerFee !== nextTrainerFee || oldGymCycleDays !== nextGymCycleDays) {
            const startDate = getSafeDate(member.package_start_date ?? member.created_at, new Date());
            const daysSinceStart = Math.floor(Math.max(0, new Date().getTime() - startDate.getTime()) / DAY_IN_MS);
            
            const pastDaysInCurrentGymCycle = daysSinceStart % oldGymCycleDays;
            const unusedGymDays = oldGymCycleDays - pastDaysInCurrentGymCycle;
            gymCredit = Math.round(oldGymFee * (unusedGymDays / oldGymCycleDays));
            
            const pastDaysInCurrentTrainerCycle = hasTrainerPackage(member) ? (daysSinceStart % 30) : 0;
            const unusedTrainerDays = hasTrainerPackage(member) ? (30 - pastDaysInCurrentTrainerCycle) : 0;
            trainerCredit = Math.round(oldTrainerFee * (unusedTrainerDays / 30));
            
            nextLegacyFees = oldSnapshot.totalRequired - gymCredit - trainerCredit;
            const admissionFeeToSubtract = Number(member.admission_fee) || 0;
            nextLegacyFees = Math.max(0, nextLegacyFees - admissionFeeToSubtract);
            nextStartDate = toLocalDateInputValue(); // TODAY
            nextBakedGym = 0;
            nextBakedTrainer = 0;
        }
    }

    const merged = {
        ...member,
        package_type: normalizedPackage,
        trainer_package_type: normalizedTrainerPackage,
        has_cardio: normalizedCardio,
        trainer_commission: normalizedCommission,
        gym_fees: nextGymFee,
        trainer_fees: nextTrainerFee,
        baked_gym_cycles: nextBakedGym,
        baked_trainer_cycles: nextBakedTrainer,
        legacy_fees: nextLegacyFees,
        package_start_date: nextStartDate,
        amount_paid: nextAmountPaid
    };

    return {
        snapshot: getMemberPaymentSnapshot(merged),
        metrics: {
            creditApplied: gymCredit + trainerCredit,
            newCycleCost: nextGymFee + nextTrainerFee
        }
    };
  },

  updateMemberPackage: async (memberId: string, payload: {
    package_type: string,
    trainer_package_type: string,
    has_cardio?: boolean,
    trainer_commission?: number,
    reset_start_date?: boolean,
    amount_paid?: number,
    custom_gym_fees?: number,
  }) => {
    const normalizedPackage = payload.package_type || 'Basic';
    const normalizedTrainerPackage = payload.trainer_package_type || 'none';
    const normalizedCardio = String(normalizedPackage).toLowerCase() === CARDIO_ONLY_PACKAGE
      ? false
      : !!payload.has_cardio;
    const normalizedCommission = Math.max(0, Number(payload.trainer_commission) || 0);

    if(!isDummy) {
        const { data: existing, error: fetchError } = await supabase.from('members').select('*').eq('id', memberId).single();
        if (fetchError) throw fetchError;
        if (!existing) throw new Error('Member not found');

        const oldSnapshot = getMemberPaymentSnapshot(existing);
        const oldGymFee = oldSnapshot.recurringGymFees;
        const oldTrainerFee = oldSnapshot.recurringTrainerFees;
        const oldGymCycleDays = oldSnapshot.gymCycleDays;

        const isCustom = String(normalizedPackage).toLowerCase().startsWith('custom');
        let nextGymFee = 0;
        if (isCustom) {
          nextGymFee = payload.custom_gym_fees !== undefined ? payload.custom_gym_fees : (Number(existing.gym_fees) || 0);
        } else {
          nextGymFee = getPackageExpectedGymFee(normalizedPackage, normalizedCardio) ?? 0;
        }
        const nextTrainerFee = getPackageExpectedTrainerFee(normalizedTrainerPackage, normalizedCommission) ?? 0;
        const nextGymCycleDays = getGymCycleDays(normalizedPackage);

        let nextLegacyFees = Number(existing.legacy_fees) || 0;
        let nextBakedGym = Number(existing.baked_gym_cycles) || 0;
        let nextBakedTrainer = Number(existing.baked_trainer_cycles) || 0;
        let nextStartDate = existing.package_start_date;
        let nextAmountPaid = existing.amount_paid;

        let gymCredit = 0;
        let trainerCredit = 0;

        const paymentReceived = payload.amount_paid || 0;

        if (payload.reset_start_date) {
            nextLegacyFees = 0;
            nextStartDate = toLocalDateInputValue(); // TODAY
            nextBakedGym = 0;
            nextBakedTrainer = 0;
            nextAmountPaid = paymentReceived;
        } else {
            nextAmountPaid = (Number(existing.amount_paid) || 0) + paymentReceived;
            if (oldGymFee !== nextGymFee || oldTrainerFee !== nextTrainerFee || oldGymCycleDays !== nextGymCycleDays) {
                const startDate = getSafeDate(existing.package_start_date ?? existing.created_at, new Date());
                const daysSinceStart = Math.floor(Math.max(0, new Date().getTime() - startDate.getTime()) / DAY_IN_MS);
                
                const pastDaysInCurrentGymCycle = daysSinceStart % oldGymCycleDays;
                const unusedGymDays = oldGymCycleDays - pastDaysInCurrentGymCycle;
                gymCredit = Math.round(oldGymFee * (unusedGymDays / oldGymCycleDays));
                
                const pastDaysInCurrentTrainerCycle = hasTrainerPackage(existing) ? (daysSinceStart % 30) : 0;
                const unusedTrainerDays = hasTrainerPackage(existing) ? (30 - pastDaysInCurrentTrainerCycle) : 0;
                trainerCredit = Math.round(oldTrainerFee * (unusedTrainerDays / 30));
                
                nextLegacyFees = oldSnapshot.totalRequired - gymCredit - trainerCredit;
                const admissionFeeToSubtract = Number(existing.admission_fee) || 0;
                nextLegacyFees = Math.max(0, nextLegacyFees - admissionFeeToSubtract);
                nextStartDate = toLocalDateInputValue(); // TODAY
                nextBakedGym = 0;
                nextBakedTrainer = 0;
            }
        }

        const merged = {
          ...existing,
          package_type: normalizedPackage,
          trainer_package_type: normalizedTrainerPackage,
          has_cardio: normalizedCardio,
          trainer_commission: normalizedCommission,
          gym_fees: nextGymFee,
          trainer_fees: nextTrainerFee,
          baked_gym_cycles: nextBakedGym,
          baked_trainer_cycles: nextBakedTrainer,
          legacy_fees: nextLegacyFees,
          package_start_date: nextStartDate,
          amount_paid: nextAmountPaid
        };

        const snapshot = getMemberPaymentSnapshot(merged);
        const nextStatus = snapshot.isDue ? 'due' : 'completed';

        const { error: updateError } = await supabase.from('members').update({
          package_type: normalizedPackage,
          trainer_package_type: normalizedTrainerPackage,
          has_cardio: normalizedCardio,
          trainer_commission: normalizedCommission,
          gym_fees: nextGymFee,
          trainer_fees: nextTrainerFee,
          baked_gym_cycles: nextBakedGym,
          baked_trainer_cycles: nextBakedTrainer,
          legacy_fees: nextLegacyFees,
          package_start_date: nextStartDate,
          amount_paid: nextAmountPaid,
          payment_status: nextStatus,
        }).eq('id', memberId);

        if (updateError) throw updateError;
        
        const cache = getCache();
        if (cache?.isReady()) {
          cache.upsertMember({ ...merged, payment_status: nextStatus });
        }

        if (paymentReceived > 0) {
          const isReset = !!payload.reset_start_date;
          const ledgerDesc = isReset
            ? `Package Renewal/Reset (${normalizedPackage}) - ${existing.name}`
            : `Package Update Fee (${normalizedPackage}) - ${existing.name}`;
          
          await dbService.createLedgerEntry({
            type: 'income',
            amount: paymentReceived,
            category: 'Membership',
            description: ledgerDesc,
            date: toLocalIsoWithOffset(),
          });
        }
        return;
    }

    const idx = simulatedMembers.findIndex(m => m.id === memberId);
    if (idx === -1) return;

    const existing = simulatedMembers[idx];
    const oldSnapshot = getMemberPaymentSnapshot(existing);
    const oldGymFee = oldSnapshot.recurringGymFees;
    const oldTrainerFee = oldSnapshot.recurringTrainerFees;
    const oldGymCycleDays = oldSnapshot.gymCycleDays;

    const isCustom = String(normalizedPackage).toLowerCase().startsWith('custom');
    let nextGymFee = 0;
    if (isCustom) {
      nextGymFee = payload.custom_gym_fees !== undefined ? payload.custom_gym_fees : (Number(existing.gym_fees) || 0);
    } else {
      nextGymFee = getPackageExpectedGymFee(normalizedPackage, normalizedCardio) ?? 0;
    }
    const nextTrainerFee = getPackageExpectedTrainerFee(normalizedTrainerPackage, normalizedCommission) ?? 0;
    const nextGymCycleDays = getGymCycleDays(normalizedPackage);

    let nextLegacyFees = Number(existing.legacy_fees) || 0;
    let nextBakedGym = Number(existing.baked_gym_cycles) || 0;
    let nextBakedTrainer = Number(existing.baked_trainer_cycles) || 0;
    let nextStartDate = existing.package_start_date;
    let nextAmountPaid = existing.amount_paid;

    const paymentReceived = payload.amount_paid || 0;

    if (payload.reset_start_date) {
        nextLegacyFees = 0;
        nextStartDate = toLocalDateInputValue(); // TODAY
        nextBakedGym = 0;
        nextBakedTrainer = 0;
        nextAmountPaid = paymentReceived;
    } else {
        nextAmountPaid = (Number(existing.amount_paid) || 0) + paymentReceived;
        if (oldGymFee !== nextGymFee || oldTrainerFee !== nextTrainerFee || oldGymCycleDays !== nextGymCycleDays) {
            const startDate = getSafeDate(existing.package_start_date ?? existing.created_at, new Date());
            const daysSinceStart = Math.floor(Math.max(0, new Date().getTime() - startDate.getTime()) / DAY_IN_MS);
            
            const pastDaysInCurrentGymCycle = daysSinceStart % oldGymCycleDays;
            const unusedGymDays = oldGymCycleDays - pastDaysInCurrentGymCycle;
            const gymCredit = Math.round(oldGymFee * (unusedGymDays / oldGymCycleDays));
            
            const pastDaysInCurrentTrainerCycle = hasTrainerPackage(existing) ? (daysSinceStart % 30) : 0;
            const unusedTrainerDays = hasTrainerPackage(existing) ? (30 - pastDaysInCurrentTrainerCycle) : 0;
            const trainerCredit = Math.round(oldTrainerFee * (unusedTrainerDays / 30));
            
            nextLegacyFees = oldSnapshot.totalRequired - gymCredit - trainerCredit;
            const admissionFeeForDummy = Number(existing.admission_fee) || 0;
            nextLegacyFees = Math.max(0, nextLegacyFees - admissionFeeForDummy);
            nextStartDate = toLocalDateInputValue(); // TODAY
            nextBakedGym = 0;
            nextBakedTrainer = 0;
        }
    }

    const merged = {
      ...existing,
      package_type: normalizedPackage,
      trainer_package_type: normalizedTrainerPackage,
      has_cardio: normalizedCardio,
      trainer_commission: normalizedCommission,
      gym_fees: nextGymFee,
      trainer_fees: nextTrainerFee,
      baked_gym_cycles: nextBakedGym,
      baked_trainer_cycles: nextBakedTrainer,
      legacy_fees: nextLegacyFees,
      package_start_date: nextStartDate,
      amount_paid: nextAmountPaid
    };
    
    const snapshot = getMemberPaymentSnapshot(merged);
    const nextStatus = snapshot.isDue ? 'due' : 'completed';

    simulatedMembers[idx] = {
      ...merged,
      payment_status: nextStatus,
    };

    const cache = getCache();
    if (cache) {
      cache.upsertMember(simulatedMembers[idx]);
    }

    if (paymentReceived > 0) {
      const isReset = !!payload.reset_start_date;
      const ledgerDesc = isReset
        ? `Package Renewal/Reset (${normalizedPackage}) - ${existing.name}`
        : `Package Update Fee (${normalizedPackage}) - ${existing.name}`;
      
      simulatedLedgerEntries.push({
        id: Math.random().toString(),
        type: 'income',
        amount: paymentReceived,
        category: 'Membership',
        description: ledgerDesc,
        date: toLocalIsoWithOffset()
      });
    }
  },

  updateMember: async (memberId: string, payload: any) => {
     if (!isDummy) {
        const { error } = await supabase.from('members').update(payload).eq('id', memberId);
        if (error) throw error;
        const cache = getCache();
        if (cache?.isReady()) {
           cache.upsertMember({ id: memberId, ...payload });
        }
        return;
     }
     const idx = simulatedMembers.findIndex(m => m.id === memberId);
     if (idx !== -1) {
        simulatedMembers[idx] = { ...simulatedMembers[idx], ...payload };
        const cache = getCache();
        if (cache) {
           cache.upsertMember(simulatedMembers[idx]);
        }
     }
  },

  getTrainerStats: async () => {
     const cache = getCache();
     const trainers = isDummy ? simulatedTrainers : (cache?.isReady() ? cache.getAllTrainers() : ((await supabase.from('trainers').select('*')).data || []));
     const membersData = isDummy ? simulatedMembers : (cache?.isReady() ? cache.getAllMembers() : ((await supabase.from('members').select('*')).data || []));

     return trainers.map(t => {
        const portfolio = membersData.filter(m => m.trainer_name === t.name && String(m.package_type || '').toLowerCase() !== 'employee');
        const totalIncome = portfolio.reduce((sum, m) => {
           const snapshot = getMemberPaymentSnapshot(m);
           if (snapshot.recurringTrainerFees <= 0) return sum;
           if (snapshot.daysSincePayment >= 30) return sum;
           if (snapshot.totalPaid <= 0 || snapshot.recurringTotal <= 0) return sum;

           const paymentCoverage = Math.min(1, snapshot.totalPaid / snapshot.recurringTotal);
           const trainerIncomeShare = snapshot.recurringTrainerFees * paymentCoverage;
           return sum + trainerIncomeShare;
        }, 0);
        return {
           ...t,
           clientCount: portfolio.length,
           totalIncome: Math.round(totalIncome)
        };
     });
  },

  // Notification Service Methods
  getDuesNotifications: async () => {
    const cache = getCache();
    const members = isDummy ? simulatedMembers : (cache?.isReady() ? cache.getAllMembers() : ((await supabase.from('members').select('*')).data || []));

    return members.map((m: any) => {
        const paymentSnapshot = getMemberPaymentSnapshot(m);

        return {
           id: m.id,
           name: m.name,
           phone: m.phone,
           trainer_name: m.trainer_name,
           package_type: m.package_type,
           trainer_package_type: m.trainer_package_type,
          daysSincePayment: paymentSnapshot.daysSincePayment,
          isOverdue: paymentSnapshot.isDue,
          balance: paymentSnapshot.cycleDue,
           lastPaymentDate: m.payment_date,
          type: paymentSnapshot.reason || 'Reminder'
        };
    }).filter(n => n.isOverdue);
  },

  // Ledger Service Methods
  getLedgerEntries: async (timeframe: 'daily' | 'monthly' | 'yearly' | 'all' = 'daily', selectedDate: Date = new Date()) => {
    if (!isDummy) {
      let query = supabase.from('ledger_entries').select('*');
      
      if (timeframe === 'daily') {
        const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 0, 0, 0, 0);
        const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59, 999);
        query = query.gte('date', toLocalIsoWithOffset(start)).lte('date', toLocalIsoWithOffset(end));
      } else if (timeframe === 'monthly') {
        const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 0, 0, 0, 0);
        const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0, 23, 59, 59, 999);
        query = query.gte('date', toLocalIsoWithOffset(start)).lte('date', toLocalIsoWithOffset(end));
      } else if (timeframe === 'yearly') {
        const start = new Date(selectedDate.getFullYear(), 0, 1, 0, 0, 0, 0);
        const end = new Date(selectedDate.getFullYear(), 11, 31, 23, 59, 59, 999);
        query = query.gte('date', toLocalIsoWithOffset(start)).lte('date', toLocalIsoWithOffset(end));
      }
      
      const { data, error } = await query.order('date', { ascending: false });
      if (error) throw error;
      return data || [];
    }

    // Dummy mode filtering
    return simulatedLedgerEntries.filter(entry => {
      const entryDate = new Date(entry.date);
      if (timeframe === 'all') return true;
      if (timeframe === 'daily') {
        return entryDate.toDateString() === selectedDate.toDateString();
      } else if (timeframe === 'monthly') {
        return entryDate.getMonth() === selectedDate.getMonth() && entryDate.getFullYear() === selectedDate.getFullYear();
      } else if (timeframe === 'yearly') {
        return entryDate.getFullYear() === selectedDate.getFullYear();
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },

  createLedgerEntry: async (payload: { type: 'income' | 'expense', amount: number, category: string, description: string, date?: string }) => {
    if (!isDummy) {
      const { error } = await supabase.from('ledger_entries').insert([{
        type: payload.type,
        amount: payload.amount,
        category: payload.category,
        description: payload.description,
        date: payload.date || toLocalIsoWithOffset()
      }]);
      if (error) throw error;
      return;
    }
    
    const newEntry = {
      id: Math.random().toString(36).substr(2, 9),
      ...payload,
      date: payload.date || toLocalIsoWithOffset()
    };
    simulatedLedgerEntries.push(newEntry);
  },

  deleteLedgerEntry: async (entryId: string) => {
    if (!isDummy) {
        const { error } = await supabase.from('ledger_entries').delete().eq('id', entryId);
        if (error) throw error;
        return;
    }
    simulatedLedgerEntries = simulatedLedgerEntries.filter(e => e.id !== entryId);
  },

  getNextZkId: async () => {
    const cache = getCache();
    const members = isDummy ? simulatedMembers : (cache?.isReady() ? cache.getAllMembers() : ((await supabase.from('members').select('zk_id')).data || []));
    
    // Parse all existing numeric zk_ids and filter out invalid ones
    const ids = members
      .map((m: any) => {
        const parsed = parseInt(String(m.zk_id || '').trim(), 10);
        return isNaN(parsed) ? null : parsed;
      })
      .filter((id): id is number => id !== null && id > 0)
      .sort((a, b) => a - b);
    
    // De-duplicate in case of manual entries
    const uniqueIds = Array.from(new Set(ids));
    
    // Find first gap starting from 1
    let nextId = 1;
    for (const id of uniqueIds) {
       if (id === nextId) {
          nextId++;
       } else if (id > nextId) {
          break; // Gap found
       }
    }
    
    return String(nextId);
  },

  getNextMemberSerial: async () => {
    if (!isDummy) {
      const cache = getCache();
      if (cache?.isReady()) return getNextSerialFromMembers(cache.getAllMembers());
      const { data, error } = await supabase
        .from('members')
        .select('serial_number');

      if (error) return '001';
      return getNextSerialFromMembers(data || []);
    }

    return getNextSerialFromMembers(simulatedMembers);
  },

  getNextEmployeeId: async () => {
    const cache = getCache();
    const members = isDummy ? simulatedMembers : (cache?.isReady() ? cache.getAllMembers() : ((await supabase.from('members').select('package_type')).data || []));
    const employeeCount = members.filter((m: any) => String(m.package_type || '').toLowerCase() === 'employee').length;
    return toSequenceId(employeeCount + 1);
  },

  // --- DYNAMIC SETTINGS & PACKAGES METHODS ---
  getCachedSettings: () => cachedSettings,
  getCachedPackages: () => cachedPackages,
  getCachedAddons: () => cachedAddons,
  getCachedPTPackages: () => cachedPTPackages,

  loadSettingsAndPackages: async () => {
    try {
      if (isDummy) {
        // Dummy mode: always use in-memory defaults (no persistence)
        cachedSettings = { ...DEFAULT_SETTINGS };
        cachedPackages = [...DEFAULT_PACKAGES];
        cachedAddons = [...DEFAULT_ADDONS];
        cachedPTPackages = [...DEFAULT_PT_PACKAGES];
        return;
      }

      // STRICT MODE: Supabase is the single source of truth
      const { data: settingsData, error: settingsError } = await supabase.from('system_settings').select('*');
      if (!settingsError && settingsData && settingsData.length > 0) {
        settingsData.forEach(row => {
          if (row.key === 'admission_fee') cachedSettings.admissionFee = Number(row.value);
          if (row.key === 'security' && row.value) {
            cachedSettings.adminUser = row.value.username || cachedSettings.adminUser;
            cachedSettings.adminPass = row.value.password || cachedSettings.adminPass;
          }
          if (row.key === 'zk_config' && row.value) {
            cachedSettings.zkIP = row.value.ip || cachedSettings.zkIP;
            cachedSettings.zkPort = String(row.value.port || cachedSettings.zkPort);
            cachedSettings.zkAutoSync = !!row.value.autoSync;
          }
        });
      }

      const { data: pkgsData, error: pkgsError } = await supabase.from('gym_packages').select('*');
      if (!pkgsError && pkgsData) {
        if (pkgsData.length > 0) {
          cachedPackages = pkgsData.filter((p: any) => p.type === 'gym');
          cachedAddons = pkgsData.filter((p: any) => p.type === 'addon');
          cachedPTPackages = pkgsData.filter((p: any) => p.type === 'pt');
        } else {
          // Table exists but is currently empty — seed with defaults once
          cachedPackages = [...DEFAULT_PACKAGES];
          cachedAddons = [...DEFAULT_ADDONS];
          cachedPTPackages = [...DEFAULT_PT_PACKAGES];
          try {
            const allSeed = [
              ...cachedPackages.map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price) || 0, duration: Number(p.duration) || 1, type: 'gym' })),
              ...cachedAddons.map((a: any) => ({ id: a.id, name: a.name, price: Number(a.price) || 0, duration: Number(a.duration) || 1, type: 'addon' })),
              ...cachedPTPackages.map((pt: any) => ({ id: pt.id, name: pt.name, price: Number(pt.price) || 0, duration: Number(pt.duration) || 1, type: 'pt' }))
            ];
            await supabase.from('gym_packages').upsert(allSeed, { onConflict: 'id' });
          } catch (seedErr) {
            console.warn("Could not seed gym_packages table", seedErr);
          }
        }
      } else if (pkgsError) {
        console.warn("Could not fetch gym_packages from Supabase (table may not exist yet):", pkgsError.message);
      }
    } catch (e) {
      console.warn("Could not load settings from Supabase, using current cache", e);
    }
  },

  saveSettings: async (settings: any) => {
    cachedSettings = { ...cachedSettings, ...settings };
    if (!isDummy) {
      const res1 = await supabase.from('system_settings').upsert({ key: 'admission_fee', value: cachedSettings.admissionFee });
      if (res1.error) throw new Error(`Failed to save admission fee: ${res1.error.message}`);

      const res2 = await supabase.from('system_settings').upsert({ 
        key: 'security', 
        value: { username: cachedSettings.adminUser, password: cachedSettings.adminPass } 
      });
      if (res2.error) throw new Error(`Failed to save security settings: ${res2.error.message}`);

      const res3 = await supabase.from('system_settings').upsert({ 
        key: 'zk_config', 
        value: { ip: cachedSettings.zkIP, port: Number(cachedSettings.zkPort), autoSync: cachedSettings.zkAutoSync } 
      });
      if (res3.error) throw new Error(`Failed to save ZK config: ${res3.error.message}`);
    }
  },

  savePackages: async (packages: any[]) => {
    cachedPackages = packages;
    if (!isDummy) {
      const { data: existing, error: selErr } = await supabase.from('gym_packages').select('id').eq('type', 'gym');
      if (selErr) throw new Error(`Failed to check existing gym packages: ${selErr.message}. Make sure table 'gym_packages' exists in Supabase.`);
      
      const existingIds = (existing || []).map((r: any) => r.id);
      const newIds = packages.map(p => p.id);
      const toDelete = existingIds.filter((id: string) => !newIds.includes(id));
      
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from('gym_packages').delete().in('id', toDelete);
        if (delErr) throw new Error(`Failed to delete removed gym packages: ${delErr.message}`);
      }
      
      if (packages.length > 0) {
        const cleanPayload = packages.map(p => ({
          id: p.id,
          name: p.name,
          price: Number(p.price) || 0,
          duration: Number(p.duration) || 1,
          type: 'gym'
        }));
        const { error: upErr } = await supabase.from('gym_packages').upsert(cleanPayload, { onConflict: 'id' });
        if (upErr) throw new Error(`Failed to save gym packages to Supabase: ${upErr.message}`);
      }
    }
  },

  saveAddons: async (addons: any[]) => {
    cachedAddons = addons;
    if (!isDummy) {
      const { data: existing, error: selErr } = await supabase.from('gym_packages').select('id').eq('type', 'addon');
      if (selErr) throw new Error(`Failed to check existing add-ons: ${selErr.message}. Make sure table 'gym_packages' exists in Supabase.`);
      
      const existingIds = (existing || []).map((r: any) => r.id);
      const newIds = addons.map(a => a.id);
      const toDelete = existingIds.filter((id: string) => !newIds.includes(id));
      
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from('gym_packages').delete().in('id', toDelete);
        if (delErr) throw new Error(`Failed to delete removed add-ons: ${delErr.message}`);
      }
      
      if (addons.length > 0) {
        const cleanPayload = addons.map(a => ({
          id: a.id,
          name: a.name,
          price: Number(a.price) || 0,
          duration: Number(a.duration) || 1,
          type: 'addon'
        }));
        const { error: upErr } = await supabase.from('gym_packages').upsert(cleanPayload, { onConflict: 'id' });
        if (upErr) throw new Error(`Failed to save add-ons to Supabase: ${upErr.message}`);
      }
    }
  },

  savePTPackages: async (ptPackages: any[]) => {
    cachedPTPackages = ptPackages;
    if (!isDummy) {
      const { data: existing, error: selErr } = await supabase.from('gym_packages').select('id').eq('type', 'pt');
      if (selErr) throw new Error(`Failed to check existing PT packages: ${selErr.message}. Make sure table 'gym_packages' exists in Supabase.`);
      
      const existingIds = (existing || []).map((r: any) => r.id);
      const newIds = ptPackages.map(pt => pt.id);
      const toDelete = existingIds.filter((id: string) => !newIds.includes(id));
      
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from('gym_packages').delete().in('id', toDelete);
        if (delErr) throw new Error(`Failed to delete removed PT packages: ${delErr.message}`);
      }
      
      if (ptPackages.length > 0) {
        const cleanPayload = ptPackages.map(pt => ({
          id: pt.id,
          name: pt.name,
          price: Number(pt.price) || 0,
          duration: Number(pt.duration) || 1,
          type: 'pt'
        }));
        const { error: upErr } = await supabase.from('gym_packages').upsert(cleanPayload, { onConflict: 'id' });
        if (upErr) throw new Error(`Failed to save PT packages to Supabase: ${upErr.message}`);
      }
    }
  }
};


