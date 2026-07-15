# Admin User Setup Guide

## SQL to Insert Admin User

To manually insert an admin user with email `admin@gmail.com` and password `Admin@123`, run the following SQL in your PostgreSQL database:

```sql
-- SQL to insert admin user with email: admin@gmail.com and password: Admin@123
-- This uses bcrypt hash with salt rounds = 10

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
```

**Note:** The bcrypt hash `$2b$10$kdck6elR/fey9uhS0bcicuabNGhE4VNgQuLLG81IPiLbM8pla8ro.` is for the password `Admin@123`.

## Automatic Admin Creation

The application automatically creates a default admin user on startup if one doesn't exist. The default credentials are:
- **Email:** admin@gmail.com
- **Password:** Admin@123
- **Name:** Sanjay Meher
- **Role:** admin
- **Custom Role:** Freelancer

This is handled by the `createDefaultAdmin()` function in `/lib/auth.js` which runs during server initialization.

---

## Why Registration and Login Were Not Working

### Issues Found and Fixed:

1. **Missing Token in Response**
   - **Problem:** The login and signup endpoints were not returning the session token in the JSON response. The frontend JavaScript (`public/js/auth.js`) was expecting a `token` field in the response to store in sessionStorage for authentication.
   - **Fix:** Modified both `/api/auth/login` and `/api/auth/signup` endpoints in `server.js` to include the token in the response:
     ```javascript
     res.json({ id: user.id, email: user.email, fullName: user.full_name, role: user.role, token });
     ```

2. **Missing .env File**
   - **Problem:** The `.env` file was missing, which is required for database connection and other configurations.
   - **Fix:** Created a `.env` file template with all necessary environment variables.

### How Authentication Works Now:

1. **Login Flow:**
   - User submits email/password via login form
   - Server authenticates and creates a session
   - Server returns user data + session token
   - Frontend stores token in sessionStorage
   - Frontend includes token in Authorization header for subsequent requests

2. **Session Cookie:**
   - Server also sets an HTTP-only cookie `session_token` for secure server-side authentication
   - This cookie is used by middleware for protecting API routes

3. **Frontend Auth Check:**
   - On page load, `checkAuth()` function verifies the session
   - If valid, shows app content; otherwise shows login modal

### Testing:

1. Start the server: `npm start`
2. Open http://localhost:3000
3. Login with:
   - Email: `admin@gmail.com`
   - Password: `Admin@123`
4. Or create a new account via the "Create Account" tab
