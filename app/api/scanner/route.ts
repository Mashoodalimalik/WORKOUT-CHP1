import { NextResponse } from 'next/server';
import { supabase, getMemberPaymentSnapshot } from '@/lib/supabase';
import { normalizeDeviceTimestamp } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Only fetch columns needed for payment computation (not photo_url, phone, gender, etc.)
const SCANNER_MEMBER_COLS = 'id,name,package_type,trainer_package_type,has_cardio,trainer_commission,gym_fees,trainer_fees,admission_fee,amount_paid,package_start_date,created_at,payment_date,is_premium,fingerprint_template,zk_id';

const decodeBinaryUserId = (raw: string) => {
  const bytes = Array.from(raw).map((c) => c.charCodeAt(0));
  if (bytes.length === 0) return null;

  const littleEndian = bytes.reduce((acc, byte, index) => acc + byte * (256 ** index), 0);
  if (Number.isFinite(littleEndian) && littleEndian > 0) {
    return String(littleEndian);
  }
  return null;
};

const normalizeUserId = (value: unknown) => {
  if (value == null) return null;

  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;

  // Some scanners may emit non-printable bytes for user_id; decode those bytes into decimal.
  if (/[^\x20-\x7E]/.test(raw)) {
    const decoded = decodeBinaryUserId(raw);
    if (decoded) return decoded;
  }

  return raw;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, rawUserId, uid, timestamp } = body;

    // Normalize device timestamp: pyzk sends "2026-04-21 21:10:15" (UTC, no suffix).
    // Append "Z" so JS/Supabase treat it as UTC, not local time.
    const normalizedTimestamp = normalizeDeviceTimestamp(timestamp);

    const normalizedUserId = normalizeUserId(userId ?? rawUserId);
    const fallbackUid = normalizeUserId(uid);

    console.log('[API] Received scan payload', {
      rawUserId: userId ?? rawUserId,
      normalizedUserId,
      fallbackUid,
      rawTimestamp: timestamp,
      normalizedTimestamp,
    });

    // Helper to query member by column with fallback to select('*') if explicit column selection fails
    const findMember = async (columnName: string, val: string) => {
      let { data, error } = await supabase
        .from('members')
        .select(SCANNER_MEMBER_COLS)
        .eq(columnName, val)
        .limit(1);

      if (error || !data) {
        const retry = await supabase
          .from('members')
          .select('*')
          .eq(columnName, val)
          .limit(1);
        data = retry.data;
      }
      return data?.[0] ?? null;
    };

    let member: any = null;

    if (normalizedUserId) {
      member = await findMember('fingerprint_template', normalizedUserId);
      if (!member) {
        member = await findMember('zk_id', normalizedUserId);
      }
    }

    if (!member && fallbackUid) {
      member = await findMember('fingerprint_template', fallbackUid);
      if (!member) {
        member = await findMember('zk_id', fallbackUid);
      }
    }

    if (!member) {
      console.warn('[API] No member found for scanner payload', {
        normalizedUserId,
        fallbackUid,
      });
      
      // Log unknown scan directly to Supabase
      const unknownId = normalizedUserId || fallbackUid || 'UNKNOWN';
      const logPayload: any = { member_id: null, status: 'denied', notes: `Unknown Scanner ID: ${unknownId}` };
      if (normalizedTimestamp) logPayload.timestamp = normalizedTimestamp;
      await supabase.from('attendance_logs').insert([logPayload]);
      
      return NextResponse.json({ 
        error: 'Member not found', 
        log: 'denied',
        status: 'denied',
        notes: `Unknown Scanner ID: ${unknownId}`
      }, { status: 404 });
    }

    const paymentSnapshot = getMemberPaymentSnapshot(member);

    const permission: 'granted' | 'denied' = paymentSnapshot.isDue ? 'denied' : 'granted';
    let overdueReason = '';

    if (paymentSnapshot.isDue) {
      overdueReason = paymentSnapshot.reason || 'Outstanding Balance';
    }

    // Log the attendance with timestamp from payload
    const attendancePayload: any = { member_id: member.id, status: permission, notes: overdueReason };
    if (normalizedTimestamp) attendancePayload.timestamp = normalizedTimestamp;
    await supabase.from('attendance_logs').insert([attendancePayload]);
    console.log(`[API] Successfully logged attendance for ${member.name} (${permission})`);

    return NextResponse.json({ 
      success: true, 
      memberName: member.name, 
      status: permission,
      paymentDue: overdueReason !== '',
      overdueReason: overdueReason,
      timestamp: normalizedTimestamp
    });
  } catch (error) {
    console.error('[API] Error processing scanner POST request:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
