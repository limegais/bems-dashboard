-- Patch: Update user credentials for admin and user (Password: iotlabftuns2023)
-- Jalankan: psql -p 5433 -d bems_db -f database/update_users.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO bems_core.users (username, email, password_hash, full_name, role)
VALUES 
  ('admin', 'admin@livinglab.uns.ac.id', crypt('iotlabftuns2023', gen_salt('bf')), 'Super Administrator BEMS', 'superadmin'),
  ('user',  'user@livinglab.uns.ac.id',  crypt('iotlabftuns2023', gen_salt('bf')), 'Living Lab User',           'occupant')
ON CONFLICT (username) 
DO UPDATE SET 
  password_hash = EXCLUDED.password_hash,
  updated_at = CURRENT_TIMESTAMP;

-- Verifikasi akun
SELECT id, username, email, role, created_at, updated_at FROM bems_core.users WHERE username IN ('admin', 'user');
