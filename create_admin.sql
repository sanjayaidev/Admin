-- SQL to insert admin user with email: admin@gmail.com and password: Admin@123
-- This uses bcrypt hash with salt rounds = 10

-- INSERT statement for admin user:
INSERT INTO users (email, password_hash, full_name, role, custom_role, is_active)
VALUES (
  'admin@gmail.com',
  '$2b$10$kdck6elR/fey9uhS0bcicuabNGhE4VNgQuLLG81IPiLbM8pla8ro.',
  'Sanjay Meher',
  'admin',
  'Freelancer',
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  full_name = 'Sanjay Meher',
  custom_role = 'Freelancer',
  is_active = TRUE;

-- Verify the user was created:
SELECT id, email, full_name, role, custom_role, is_active, created_at 
FROM users 
WHERE email = 'admin@gmail.com';
