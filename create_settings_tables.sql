-- SQL MIGRATION SCRIPT FOR WORKOUT CHAPTER 1
-- RUN THIS IN YOUR SUPABASE SQL EDITOR TO SETUP DYNAMIC SETTINGS

-- 1. Create the gym_packages table to hold all plans, add-ons, and personal training options
CREATE TABLE IF NOT EXISTS gym_packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    duration INTEGER NOT NULL, -- Duration in months (e.g., 1 for monthly, 3 for quarterly, 1200 for lifetime)
    type TEXT NOT NULL CHECK (type IN ('gym', 'addon', 'pt')), -- type of package
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security (RLS) and allow public read/write for simplicity
ALTER TABLE gym_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access" ON gym_packages FOR SELECT USING (true);
CREATE POLICY "Allow public write access" ON gym_packages FOR ALL USING (true);

-- 2. Populate the table with the default packages from your flyer and settings screenshot
INSERT INTO gym_packages (id, name, price, duration, type) VALUES
('pkg_strength', 'Strength (Monthly)', 5000, 1, 'gym'),
('pkg_cardio', 'Cardio (Monthly)', 3000, 1, 'gym'),
('pkg_3month', '3 Months Plan', 14000, 3, 'gym'),
('pkg_6month', '6 Months Plan', 26000, 6, 'gym'),
('pkg_12month', '12 Months Plan', 50000, 12, 'gym'),
('pkg_lifetime', 'Lifetime Membership', 80000, 1200, 'gym'),
('add_cardio', 'Cardio Add-on (Monthly)', 2500, 1, 'addon'),
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

-- 3. Create the system_settings table to store the admission fee, ZKTeco IP config, and admin username/password
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS and allow public access
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access" ON system_settings FOR SELECT USING (true);
CREATE POLICY "Allow public write access" ON system_settings FOR ALL USING (true);

-- 4. Seed system settings
INSERT INTO system_settings (key, value) VALUES
('admission_fee', '2000'::jsonb),
('zk_config', '{"ip": "192.168.1.201", "port": 4370, "autoSync": true}'::jsonb),
('security', '{"username": "Admin", "password": "admin123"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
