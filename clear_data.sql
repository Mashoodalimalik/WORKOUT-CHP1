-- ============================================================
-- WORKOUT CHAPTER 1 — FRESH START DATA CLEAR SCRIPT
-- Run this in the Supabase SQL Editor to wipe all gym data
-- while keeping table structure, packages, and settings intact.
--
-- WARNING:  THIS IS DESTRUCTIVE AND IRREVERSIBLE.
--           Double-check before running.
-- ============================================================

-- 1. Clear attendance logs (depends on members via FK, delete first)
TRUNCATE TABLE attendance_logs RESTART IDENTITY CASCADE;

-- 2. Clear ledger entries
TRUNCATE TABLE ledger_entries RESTART IDENTITY CASCADE;

-- 3. Clear all members
TRUNCATE TABLE members RESTART IDENTITY CASCADE;

-- 4. Clear all trainers
TRUNCATE TABLE trainers RESTART IDENTITY CASCADE;

-- 5. Clear scanner commands queue
TRUNCATE TABLE scanner_commands RESTART IDENTITY CASCADE;

-- ============================================================
-- The following are NOT cleared (intentional):
--    - gym_packages    -> your membership plans stay intact
--    - system_settings -> your admin password, scanner IP, fees
-- ============================================================

-- Verify counts after truncation (all should be 0)
SELECT 'members'          AS tbl, COUNT(*) AS rows FROM members
UNION ALL
SELECT 'trainers'         AS tbl, COUNT(*) AS rows FROM trainers
UNION ALL
SELECT 'attendance_logs'  AS tbl, COUNT(*) AS rows FROM attendance_logs
UNION ALL
SELECT 'ledger_entries'   AS tbl, COUNT(*) AS rows FROM ledger_entries
UNION ALL
SELECT 'scanner_commands' AS tbl, COUNT(*) AS rows FROM scanner_commands;
