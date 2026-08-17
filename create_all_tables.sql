-- ============================================================
-- FULL DATABASE SETUP SCRIPT FOR WORKOUT CHAPTER 1
-- Run this ONCE in Supabase SQL Editor to create all tables
-- ============================================================

-- 1. MEMBERS TABLE
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number TEXT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    gender TEXT DEFAULT 'Not specified',
    trainer_name TEXT DEFAULT 'Unassigned',
    package_type TEXT DEFAULT 'Basic',
    trainer_package_type TEXT DEFAULT 'none',
    has_cardio BOOLEAN DEFAULT false,
    gym_fees NUMERIC DEFAULT 0,
    trainer_fees NUMERIC DEFAULT 0,
    admission_fee NUMERIC DEFAULT 0,
    trainer_commission NUMERIC DEFAULT 0,
    amount_paid NUMERIC DEFAULT 0,
    payment_status TEXT DEFAULT 'due',
    payment_date TIMESTAMP WITH TIME ZONE,
    package_start_date DATE,
    fingerprint_template TEXT,
    zk_id VARCHAR(50),
    baked_gym_cycles INTEGER DEFAULT 0,
    baked_trainer_cycles INTEGER DEFAULT 0,
    legacy_fees NUMERIC DEFAULT 0,
    is_premium BOOLEAN DEFAULT false,
    photo_url TEXT,
    last_visit TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access on members" ON members FOR ALL USING (true);

-- 2. TRAINERS TABLE
CREATE TABLE IF NOT EXISTS trainers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    hire_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE trainers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access on trainers" ON trainers FOR ALL USING (true);

-- 3. ATTENDANCE LOGS TABLE
CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('granted', 'denied')),
    notes TEXT DEFAULT '',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access on attendance_logs" ON attendance_logs FOR ALL USING (true);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_timestamp ON attendance_logs(timestamp DESC);

-- 4. LEDGER ENTRIES TABLE
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount NUMERIC NOT NULL,
    category TEXT NOT NULL,
    description TEXT DEFAULT '',
    date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access on ledger_entries" ON ledger_entries FOR ALL USING (true);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_date ON ledger_entries(date DESC);

-- 5. GYM PACKAGES TABLE
CREATE TABLE IF NOT EXISTS gym_packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    duration INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('gym', 'addon', 'pt')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE gym_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access on gym_packages" ON gym_packages FOR ALL USING (true);

-- Seed default packages
INSERT INTO gym_packages (id, name, price, duration, type) VALUES
('pkg_strength', 'Strength (Monthly)', 5000, 1, 'gym'),
('pkg_cardio', 'Cardio (Monthly)', 3000, 1, 'gym'),
('pkg_3month', '3 Months Plan', 14000, 3, 'gym'),
('pkg_6month', '6 Months Plan', 26000, 6, 'gym'),
('pkg_12month', '12 Months Plan', 50000, 12, 'gym'),
('pkg_lifetime', 'Lifetime Membership', 80000, 1200, 'gym'),
('add_cardio', 'Cardio Add-on (Monthly)', 3000, 1, 'addon'),
('add_pool_only', 'Pool Only (Monthly)', 3000, 1, 'addon'),
('add_pool_add', 'Pool Add-on (Monthly)', 1500, 1, 'addon'),
('pt_basic', 'PT Basic (Coaching)', 8000, 1, 'pt'),
('pt_regular', 'PT Regular (Guided)', 12000, 1, 'pt'),
('pt_target', 'PT Target (Advanced)', 20000, 1, 'pt')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    duration = EXCLUDED.duration,
    type = EXCLUDED.type;

-- 6. SYSTEM SETTINGS TABLE
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public access on system_settings" ON system_settings FOR ALL USING (true);

-- Seed default settings
INSERT INTO system_settings (key, value) VALUES
('admission_fee', '2000'::jsonb),
('zk_config', '{"ip": "192.168.1.201", "port": 4370, "autoSync": true}'::jsonb),
('security', '{"username": "Admin", "password": "Hard!!3s"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 7. SCANNER COMMANDS TABLE
CREATE TABLE IF NOT EXISTS scanner_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command_type VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scanner_commands_status ON scanner_commands(status);
