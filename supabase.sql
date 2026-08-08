-- Mengaktifkan UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabel Profil Pengguna (Sinkronisasi dengan Supabase Auth)
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    full_name TEXT NOT NULL,
    nip TEXT UNIQUE NOT NULL,
    role TEXT CHECK (role IN ('admin', 'guru', 'tendik')) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel Pengaturan Kantor (Lokasi Madrasah & Radius)
CREATE TABLE office_settings (
    id INT PRIMARY KEY DEFAULT 1,
    -- Koordinat default MAN Kota Lhokseumawe (Estimasi)
    latitude DECIMAL NOT NULL DEFAULT 5.1812, 
    longitude DECIMAL NOT NULL DEFAULT 97.1425,
    radius_meters INT NOT NULL DEFAULT 50
);

-- Insert data default pengaturan
INSERT INTO office_settings (id, latitude, longitude, radius_meters) 
VALUES (1, 5.1812, 97.1425, 50);

-- 3. Tabel Hari Libur Nasional
CREATE TABLE holidays (
    id SERIAL PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    description TEXT NOT NULL
);

-- 4. Tabel Log Presensi
CREATE TABLE attendance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) NOT NULL,
    date DATE NOT NULL,
    time_in TIMESTAMPTZ,
    time_out TIMESTAMPTZ,
    lat_in DECIMAL,
    lng_in DECIMAL,
    lat_out DECIMAL,
    lng_out DECIMAL,
    status TEXT NOT NULL, -- 'Hadir Tepat Waktu', 'Terlambat', 'Luar Radius', 'Izin', 'Sakit'
    UNIQUE(user_id, date) -- Mencegah duplikasi absen di hari yang sama
);

-- Mengaktifkan Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;

-- Kebijakan RLS (Contoh dasar: Pengguna hanya bisa melihat data mereka sendiri, Admin bisa melihat semua)
CREATE POLICY "Pengguna bisa melihat log mereka sendiri" 
ON attendance_logs FOR SELECT USING (auth.uid() = user_id);