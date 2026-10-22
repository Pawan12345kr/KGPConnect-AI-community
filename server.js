require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

app.set('trust proxy', 1);

// ===== Email Delivery (Supports HTTPS Brevo/Resend APIs and SMTP) =====
function getMailTransporter() {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user, pass },
    connectionTimeout: 4000, // 4-second timeout to prevent hanging on Render Free Tier
    greetingTimeout: 4000,
    socketTimeout: 4000,
  });
}

// Universal email sender: Try Brevo/Resend HTTPS (port 443, works on Render Free Tier) then SMTP
async function sendKgpEmail({ to, otp }) {
  const cleanEmail = to.trim().toLowerCase();
  const subject = `${otp} is your KGPConnect verification code`;
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 28px; background: #0f172a; color: #f8fafc; border-radius: 16px;">
      <h2 style="margin: 0 0 8px; color: #60a5fa;">KGPConnect — IIT Kharagpur AI Community</h2>
      <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
        Use the following 6-digit verification code for your KGP Email ID (<strong>${cleanEmail}</strong>):
      </p>
      <div style="margin: 24px 0; padding: 18px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #10b981;">
        ${otp}
      </div>
      <p style="color: #64748b; font-size: 12px;">
        This code expires in 5 minutes. If you didn't request this code, you can safely ignore this email.
      </p>
    </div>
  `;

  // 1. Brevo HTTP API (Port 443 - works on Render Free tier without blocking)
  const brevoApiKey = (process.env.BREVO_API_KEY || '').trim();
  if (brevoApiKey) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: {
            name: process.env.EMAIL_SENDER_NAME || 'KGPConnect IIT Kharagpur',
            email: process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER || 'no-reply@kgpconnect.in',
          },
          to: [{ email: cleanEmail }],
          subject,
          htmlContent: html,
        }),
      });
      if (res.ok) {
        console.log(`✉️  OTP email delivered via Brevo HTTPS API to: ${cleanEmail}`);
        return { success: true, provider: 'brevo' };
      }
      const errText = await res.text();
      console.warn('Brevo API response:', errText);
    } catch (e) {
      console.warn('Brevo API request failed:', e.message);
    }
  }

  // 2. Resend HTTP API (Port 443 - works on Render Free tier)
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'KGPConnect <onboarding@resend.dev>',
          to: [cleanEmail],
          subject,
          html,
        }),
      });
      if (res.ok) {
        console.log(`✉️  OTP email delivered via Resend HTTPS API to: ${cleanEmail}`);
        return { success: true, provider: 'resend' };
      }
      const errText = await res.text();
      console.warn('Resend API response:', errText);
    } catch (e) {
      console.warn('Resend API request failed:', e.message);
    }
  }

  // 3. SMTP with strict timeout (Note: Render Free Tier blocks outbound ports 25, 465, 587)
  const transporter = getMailTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"KGPConnect IIT Kharagpur" <${process.env.SMTP_USER}>`,
        to: cleanEmail,
        replyTo: 'no-reply@kgpconnect.in',
        envelope: {
          from: process.env.SMTP_USER,
          to: [cleanEmail],
        },
        subject,
        html,
      });
      console.log(`✉️  OTP email delivered via SMTP to recipient: ${cleanEmail}`);
      return { success: true, provider: 'smtp' };
    } catch (mailErr) {
      console.warn(`⚠️ SMTP send failed (Render Free Tier blocks outbound SMTP ports 25/465/587): ${mailErr.message}`);
      return { success: false, error: mailErr.message, blocked: true };
    }
  }

  return { success: false, unconfigured: true };
}

// ===== Middleware =====
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Session configuration
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: DATA_DIR,
  }),
  secret: process.env.SESSION_SECRET || 'kgpconnect-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Prevent browser back-button caching of authenticated state
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.endsWith('.html') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Support x-user-id header fallback ONLY when pages are opened directly via file://
app.use((req, res, next) => {
  if (!req.session.userId && req.headers.origin === 'null' && req.headers['x-user-id']) {
    const headerId = Number(req.headers['x-user-id']);
    if (!isNaN(headerId) && headerId > 0) {
      req.session.userId = headerId;
    }
  }
  next();
});

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));


// ===== AUTH ROUTES (First-Time Email OTP + Password Login & Password Management) =====

function isValidKgpEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)?iitkgp\.ac\.in$/i.test(email.trim());
}

// Send 6-digit OTP to KGP Email ID (used for First-Time Sign Up & Forgot/Set Password)
app.post('/api/auth/send-email-otp', async (req, res) => {
  try {
    const { email, fullName, mode } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'KGP Email ID is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!isValidKgpEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid IIT Kharagpur Email ID (@iitkgp.ac.in or @kgpian.iitkgp.ac.in).' });
    }

    const existingUser = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);

    if (mode === 'signup') {
      if (!fullName || !fullName.trim()) {
        return res.status(400).json({ error: 'Full name is required to sign up.' });
      }
      if (existingUser && existingUser.password_hash) {
        return res.status(409).json({ error: 'An account with this KGP Email ID already exists. Please log in with your password.' });
      }
    } else if (mode === 'reset') {
      if (!existingUser) {
        return res.status(404).json({ error: 'No account found with this KGP Email ID. Please sign up first.' });
      }
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`🔑 Verification OTP for ${cleanEmail}: ${otp}`);

    // Store OTP in email_otp_codes (expires in 5 minutes)
    db.prepare('DELETE FROM email_otp_codes WHERE LOWER(email) = ?').run(cleanEmail);
    db.prepare(`
      INSERT INTO email_otp_codes (email, code, expires_at)
      VALUES (?, ?, datetime('now', '+5 minutes'))
    `).run(cleanEmail, otp);

    // Send real email via Brevo / Resend (HTTPS port 443) or Nodemailer SMTP
    const mailResult = await sendKgpEmail({ to: cleanEmail, otp });

    if (mailResult.success) {
      return res.json({
        message: `OTP sent to ${cleanEmail}`,
        email: cleanEmail,
      });
    }

    // Fallback: If Render Free Tier blocks outbound SMTP (ports 587/465) or SMTP is unconfigured,
    // provide devOtp so the user is never stuck and can complete verification & testing!
    console.warn(`[OTP Fallback] Provided direct testing code for ${cleanEmail}: ${otp}`);
    return res.json({
      message: `OTP generated for ${cleanEmail}`,
      email: cleanEmail,
      devOtp: otp,
      note: 'Render Free Tier blocks outbound SMTP ports (25, 465, 587). OTP is provided for direct testing. To deliver real emails, add BREVO_API_KEY (port 443) or upgrade Render plan.',
    });
  } catch (err) {
    console.error('Send Email OTP error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Verify 6-digit Email OTP & Set Password (Compulsory for First-Time User Sign Up)
app.post('/api/auth/verify-email-otp', async (req, res) => {
  try {
    const { email, code, password, fullName, rollNumber, remember } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'KGP Email ID and 6-digit OTP code are required.' });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Please set a password of at least 6 characters.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!isValidKgpEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please use a valid IIT Kharagpur Email ID (@iitkgp.ac.in or @kgpian.iitkgp.ac.in).' });
    }

    const cleanCode = String(code).trim();
    const otpRecord = db.prepare(`
      SELECT * FROM email_otp_codes
      WHERE LOWER(email) = ? AND code = ? AND expires_at > datetime('now')
    `).get(cleanEmail, cleanCode);

    if (!otpRecord) {
      return res.status(401).json({ error: 'Invalid or expired OTP code. Please try again.' });
    }

    // Delete used OTP
    db.prepare('DELETE FROM email_otp_codes WHERE LOWER(email) = ?').run(cleanEmail);

    const passwordHash = await bcrypt.hash(String(password), 10);
    const cleanRoll = rollNumber && rollNumber.trim() ? rollNumber.trim().toUpperCase() : null;
    let user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const derivedName = (fullName && fullName.trim())
        ? fullName.trim()
        : cleanEmail.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      const avatarColors = [
        'from-blue-400 to-blue-600', 'from-cyan-400 to-cyan-600',
        'from-amber-400 to-amber-600', 'from-violet-400 to-violet-600',
        'from-rose-400 to-rose-600', 'from-emerald-400 to-emerald-600',
        'from-orange-400 to-orange-600', 'from-pink-400 to-pink-600',
      ];
      const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];

      const result = db.prepare(`
        INSERT INTO users (full_name, email, password_hash, roll_number, avatar_color, is_verified)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(derivedName, cleanEmail, passwordHash, cleanRoll, avatarColor);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    } else {
      const updatedName = (fullName && fullName.trim()) ? fullName.trim() : user.full_name;
      const updatedRoll = cleanRoll || user.roll_number;
      db.prepare(`
        UPDATE users
        SET full_name = ?, password_hash = ?, roll_number = ?, is_verified = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(updatedName, passwordHash, updatedRoll, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    // Set session
    req.session.userId = user.id;
    if (remember) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    res.json({
      message: 'Email verified & password set!',
      user: sanitizeUser(user),
      isNewUser,
    });
  } catch (err) {
    console.error('Verify Email OTP error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Returning User Login: Email ID + Password ONLY (No OTP required)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, remember } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'KGP Email ID and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!isValidKgpEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid IIT Kharagpur Email ID (@iitkgp.ac.in or @kgpian.iitkgp.ac.in).' });
    }

    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    if (!user) {
      return res.status(404).json({ error: 'No account found with this KGP Email ID. First-time users must Sign Up with Email OTP.' });
    }

    // If current user existed before password support and hasn't set a password yet
    if (!user.password_hash) {
      return res.status(403).json({
        error: 'You have not set a password for your account yet. Please use "Forgot / Set Password" with Email OTP once to set your password.',
        needsPasswordSetup: true,
        email: cleanEmail,
      });
    }

    const isMatch = await bcrypt.compare(String(password), user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password. Please try again or click "Forgot Password?".' });
    }

    req.session.userId = user.id;
    if (remember) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    res.json({
      message: 'Logged in successfully!',
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Set Password for a currently logged-in user who hasn't set one yet (from Profile page)
app.post('/api/auth/set-password', requireAuth, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (user.password_hash) {
      return res.status(400).json({ error: 'You already have a password set. Please use Update Password or Forgot Password.' });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, user.id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json({ message: 'Password set successfully! You can now log in with your email and password.', user: sanitizeUser(updated) });
  } catch (err) {
    console.error('Set password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Update Password for a logged-in user who knows their current password (from Profile page)
app.put('/api/auth/update-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (!user.password_hash) {
      return res.status(400).json({ error: 'No current password set. Use "Set Password" instead.' });
    }

    const valid = await bcrypt.compare(String(currentPassword), user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect. If you forgot it, use the "Forgot Password (OTP)" tab.' });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, user.id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json({ message: 'Password updated successfully!', user: sanitizeUser(updated) });
  } catch (err) {
    console.error('Update password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Forgot / Reset Password using 6-digit Email OTP (works from Login page or Profile page)
app.post('/api/auth/reset-password-otp', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, 6-digit OTP code, and new password are required.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim();

    const otpRecord = db.prepare(`
      SELECT * FROM email_otp_codes
      WHERE LOWER(email) = ? AND code = ? AND expires_at > datetime('now')
    `).get(cleanEmail, cleanCode);

    if (!otpRecord) {
      return res.status(401).json({ error: 'Invalid or expired OTP code. Please try again.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    if (!user) {
      return res.status(404).json({ error: 'No account found with this KGP Email ID.' });
    }

    db.prepare('DELETE FROM email_otp_codes WHERE LOWER(email) = ?').run(cleanEmail);

    const hash = await bcrypt.hash(String(newPassword), 10);
    db.prepare('UPDATE users SET password_hash = ?, is_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, user.id);

    req.session.userId = user.id;
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

    res.json({
      message: 'Password reset successfully!',
      user: sanitizeUser(updated),
    });
  } catch (err) {
    console.error('Reset password OTP error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});


// Update profile (step 2 of signup or from profile page)
app.put('/api/auth/profile', requireAuth, (req, res) => {
  try {
    const { fullName, department, gradYear, rollNumber, bio, profileImage, coverImage, interests } = req.body;
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!current) return res.status(404).json({ error: 'User not found.' });

    const newName = fullName ? fullName.trim() : current.full_name;
    const newDept = department !== undefined ? department : current.department;
    const newYear = gradYear !== undefined ? gradYear : current.grad_year;
    const newRoll = rollNumber !== undefined ? rollNumber : current.roll_number;
    const newBio  = bio !== undefined ? bio : current.bio;
    const newImg  = profileImage !== undefined ? profileImage : current.profile_image;
    const newCover = coverImage !== undefined ? coverImage : current.cover_image;
    const newInterests = interests !== undefined
      ? (Array.isArray(interests) ? interests.join(',') : interests)
      : current.interests;

    db.prepare(`
      UPDATE users
      SET full_name = ?, department = ?, grad_year = ?, roll_number = ?, bio = ?, profile_image = ?, cover_image = ?, interests = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newName, newDept || null, newYear || null, newRoll || null, newBio || null, newImg || null, newCover || null, newInterests || null, req.session.userId);

    // Also update author info on user's articles & comments
    const deptBadge = newDept
      ? `${newDept}${newYear ? " '" + String(newYear).slice(-2) : ''}`
      : 'KGPian';
    db.prepare('UPDATE articles SET author_name = ?, author_dept = ?, author_image = ? WHERE user_id = ?')
      .run(newName, deptBadge, newImg || null, req.session.userId);
    db.prepare('UPDATE comments SET author_name = ?, author_dept = ?, author_image = ? WHERE user_id = ?')
      .run(newName, deptBadge, newImg || null, req.session.userId);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    res.json({ message: 'Profile updated!', user: sanitizeUser(user) });

  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});


// Update interests (step 3 of signup)
app.put('/api/auth/interests', requireAuth, (req, res) => {
  try {
    const { interests } = req.body;
    const interestsStr = Array.isArray(interests) ? interests.join(',') : interests;

    db.prepare(`
      UPDATE users SET interests = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(interestsStr, req.session.userId);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    res.json({ message: 'Interests saved!', user: sanitizeUser(user) });

  } catch (err) {
    console.error('Interests update error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});


// Get current user
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.', loggedIn: false });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.status(401).json({ error: 'User not found.', loggedIn: false });
  }

  res.json({ loggedIn: true, user: sanitizeUser(user) });
});


// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out.' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully.' });
  });
});

// Permanently Delete User Account & All Associated Data (Articles, Comments, Likes, Saved Articles)
app.delete('/api/auth/account', requireAuth, (req, res) => {
  try {
    const userId = Number(req.session.userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const userKey = `user_${userId}`;

    const deleteAccountTx = db.transaction(() => {
      // 1. Remove likes by this user and decrement like count on those articles
      const likedRows = db.prepare('SELECT article_id FROM article_likes WHERE user_key = ?').all(userKey);
      const decLikeStmt = db.prepare('UPDATE articles SET likes = MAX(0, likes - 1) WHERE id = ?');
      for (const row of likedRows) {
        decLikeStmt.run(row.article_id);
      }
      db.prepare('DELETE FROM article_likes WHERE user_key = ?').run(userKey);

      // 2. Remove saved/bookmarked articles for this user
      db.prepare('DELETE FROM saved_articles WHERE user_id = ?').run(userId);

      // 3. Delete all comments authored by this user (nested replies cascade automatically)
      db.prepare('DELETE FROM comments WHERE user_id = ?').run(userId);

      // 4. Delete all articles published by this user (their comments/likes/saves cascade automatically)
      db.prepare('DELETE FROM articles WHERE user_id = ?').run(userId);

      // 5. Sync comment counts on all remaining articles
      db.prepare(`
        UPDATE articles
        SET comments = (SELECT COUNT(*) FROM comments WHERE comments.article_id = articles.id)
      `).run();

      // 6. Clean up any OTP records for this email or phone
      if (user.email) {
        db.prepare('DELETE FROM email_otp_codes WHERE LOWER(email) = LOWER(?)').run(user.email);
      }
      if (user.phone) {
        db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(user.phone);
      }

      // 7. Permanently delete the user record so they can sign up again anytime with the same email
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });

    deleteAccountTx();

    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ message: 'Your account and all associated data have been permanently deleted.' });
    });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});


// ===== ARTICLE & INTERACTION ROUTES =====

function getUserKey(req) {
  if (req.session && req.session.userId) {
    return `user_${req.session.userId}`;
  }
  return null;
}

function formatArticleRow(r, userKey, userId) {
  const liked = userKey
    ? !!db.prepare('SELECT 1 FROM article_likes WHERE article_id = ? AND user_key = ?').get(r.id, userKey)
    : false;
  const saved = userId
    ? !!db.prepare('SELECT 1 FROM saved_articles WHERE article_id = ? AND user_id = ?').get(r.id, userId)
    : false;

  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    excerpt: r.excerpt,
    content: r.content,
    topic: r.topic,
    coverImage: r.cover_image,
    author: r.author_name,
    authorDept: r.author_dept,
    authorAvatar: r.author_avatar,
    authorImage: r.author_image || null,
    readTime: r.read_time,
    likes: r.likes,
    comments: r.comments,
    likedByMe: liked,
    savedByMe: saved,
    date: formatArticleDate(r.created_at),
  };
}

// Get all articles (public — no login required to read)
app.get('/api/articles', (req, res) => {
  try {
    const userKey = getUserKey(req);
    const userId = req.session ? req.session.userId : null;
    const rows = db.prepare('SELECT * FROM articles ORDER BY id DESC').all();
    const formatted = rows.map(r => formatArticleRow(r, userKey, userId));
    res.json({ articles: formatted });
  } catch (err) {
    console.error('Fetch articles error:', err);
    res.status(500).json({ error: 'Failed to load articles.' });
  }
});

// Publish a new article (requires login)
app.post('/api/articles', requireAuth, (req, res) => {
  try {
    const { title, excerpt, content, topic, coverImage, readTime } = req.body;

    if (!title || !content || !topic) {
      return res.status(400).json({ error: 'Title, content, and topic category are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const authorDept = user.department
      ? `${user.department}${user.grad_year ? " '" + String(user.grad_year).slice(-2) : ''}`
      : 'KGPian';

    const cleanExcerpt = excerpt && excerpt.trim()
      ? excerpt.trim()
      : content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) + '…';

    const result = db.prepare(`
      INSERT INTO articles (user_id, title, excerpt, content, topic, cover_image, author_name, author_dept, author_avatar, author_image, read_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      title.trim(),
      cleanExcerpt,
      content,
      topic,
      coverImage || null,
      user.full_name,
      authorDept,
      user.avatar_color || 'from-blue-400 to-blue-600',
      user.profile_image || null,
      readTime || '5 min'
    );

    const newArticle = db.prepare('SELECT * FROM articles WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      message: 'Article published successfully!',
      article: {
        id: newArticle.id,
        title: newArticle.title,
        topic: newArticle.topic,
      },
    });
  } catch (err) {
    console.error('Publish article error:', err);
    res.status(500).json({ error: 'Failed to publish article.' });
  }
});

// Delete own article
app.delete('/api/articles/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!article) return res.status(404).json({ error: 'Article not found.' });
    if (article.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'You can only delete your own articles.' });
    }
    db.prepare('DELETE FROM articles WHERE id = ?').run(id);
    res.json({ message: 'Article deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete article.' });
  }
});

// Toggle Like on an article (requires login — increase if not liked, decrease if already liked)
app.post('/api/articles/:id/like', requireAuth, (req, res) => {
  try {
    const articleId = Number(req.params.id);
    const userKey = `user_${req.session.userId}`;

    const existing = db.prepare('SELECT id FROM article_likes WHERE article_id = ? AND user_key = ?')
      .get(articleId, userKey);

    let liked = false;
    if (existing) {
      // Already liked -> remove like and decrease count
      db.prepare('DELETE FROM article_likes WHERE id = ?').run(existing.id);
      db.prepare('UPDATE articles SET likes = MAX(0, likes - 1) WHERE id = ?').run(articleId);
      liked = false;
    } else {
      // Not liked yet -> add like and increase count
      db.prepare('INSERT INTO article_likes (article_id, user_key) VALUES (?, ?)').run(articleId, userKey);
      db.prepare('UPDATE articles SET likes = likes + 1 WHERE id = ?').run(articleId);
      liked = true;
    }

    const updated = db.prepare('SELECT likes FROM articles WHERE id = ?').get(articleId);
    res.json({ liked, likes: updated ? updated.likes : 0 });
  } catch (err) {
    console.error('Toggle like error:', err);
    res.status(500).json({ error: 'Failed to toggle like.' });
  }
});

// Toggle Save / Bookmark an article (requires login)
app.post('/api/articles/:id/save', requireAuth, (req, res) => {
  try {
    const articleId = Number(req.params.id);
    const userId = req.session.userId;

    const existing = db.prepare('SELECT id FROM saved_articles WHERE article_id = ? AND user_id = ?')
      .get(articleId, userId);

    let saved = false;
    if (existing) {
      db.prepare('DELETE FROM saved_articles WHERE id = ?').run(existing.id);
      saved = false;
    } else {
      db.prepare('INSERT INTO saved_articles (user_id, article_id) VALUES (?, ?)').run(userId, articleId);
      saved = true;
    }

    res.json({ saved });
  } catch (err) {
    console.error('Toggle save error:', err);
    res.status(500).json({ error: 'Failed to save article.' });
  }
});

// Get comments for an article (supports nested replies via parentId + 10-min delete window + article owner moderation)
app.get('/api/articles/:id/comments', (req, res) => {
  try {
    const articleId = Number(req.params.id);
    const currentUserId = req.session ? req.session.userId : null;
    const article = db.prepare('SELECT user_id FROM articles WHERE id = ?').get(articleId);
    const isArticleOwner = Boolean(currentUserId && article && article.user_id && Number(article.user_id) === Number(currentUserId));

    const rows = db.prepare(`
      SELECT *, (strftime('%s', 'now') - strftime('%s', created_at)) AS elapsed_seconds
      FROM comments
      WHERE article_id = ?
      ORDER BY id ASC
    `).all(articleId);

    const comments = rows.map(c => {
      const elapsed = typeof c.elapsed_seconds === 'number' ? Math.max(0, c.elapsed_seconds) : 999999;
      const isOwner = Boolean(currentUserId && c.user_id && Number(c.user_id) === Number(currentUserId));
      return {
        id: c.id,
        articleId: c.article_id,
        parentId: c.parent_id || null,
        userId: c.user_id,
        author: c.author_name,
        authorDept: c.author_dept,
        authorAvatar: c.author_avatar,
        authorImage: c.author_image,
        content: c.content,
        elapsedSeconds: elapsed,
        canDelete: isArticleOwner || (isOwner && elapsed <= 600),
        isOwner,
        isArticleOwner,
        date: formatArticleDate(c.created_at),
      };
    });
    res.json({ comments, isArticleOwner });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments.' });
  }
});

// Add a comment or nested reply to an article (requires login)
app.post('/api/articles/:id/comments', requireAuth, (req, res) => {
  try {
    const articleId = Number(req.params.id);
    const { content, parentId } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment cannot be empty.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'Please log in to comment.' });
    }

    let validParentId = null;
    if (parentId) {
      const parentComment = db.prepare('SELECT id FROM comments WHERE id = ? AND article_id = ?').get(Number(parentId), articleId);
      if (parentComment) {
        validParentId = parentComment.id;
      }
    }

    const userId = user.id;
    const authorName = user.full_name;
    const authorDept = user.department
      ? `${user.department}${user.grad_year ? " '" + String(user.grad_year).slice(-2) : ''}`
      : 'KGPian';
    const authorAvatar = user.avatar_color || 'from-blue-400 to-blue-600';
    const authorImage = user.profile_image || null;

    const result = db.prepare(`
      INSERT INTO comments (article_id, parent_id, user_id, author_name, author_dept, author_avatar, author_image, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(articleId, validParentId, userId, authorName, authorDept, authorAvatar, authorImage, content.trim());

    db.prepare('UPDATE articles SET comments = comments + 1 WHERE id = ?').run(articleId);

    const newComment = db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid);
    const updatedArticle = db.prepare('SELECT comments FROM articles WHERE id = ?').get(articleId);

    res.status(201).json({
      comment: {
        id: newComment.id,
        articleId: newComment.article_id,
        parentId: newComment.parent_id || null,
        userId: newComment.user_id,
        author: newComment.author_name,
        authorDept: newComment.author_dept,
        authorAvatar: newComment.author_avatar,
        authorImage: newComment.author_image,
        content: newComment.content,
        elapsedSeconds: 0,
        canDelete: true,
        isOwner: true,
        date: 'Just now',
      },
      totalComments: updatedArticle ? updatedArticle.comments : 1,
    });
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Failed to add comment.' });
  }
});

// Delete a comment (allowed by the article owner at any time, OR by the comment author within 10 minutes = 600s)
function handleDeleteComment(req, res) {
  try {
    const articleId = Number(req.params.articleId);
    const commentId = Number(req.params.commentId);

    const comment = db.prepare(`
      SELECT *, (strftime('%s', 'now') - strftime('%s', created_at)) AS elapsed_seconds
      FROM comments
      WHERE id = ? AND article_id = ?
    `).get(commentId, articleId);

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    const article = db.prepare('SELECT user_id FROM articles WHERE id = ?').get(articleId);
    const isArticleOwner = Boolean(article && article.user_id && Number(article.user_id) === Number(req.session.userId));
    const isCommentOwner = Boolean(comment.user_id && Number(comment.user_id) === Number(req.session.userId));

    if (!isArticleOwner && !isCommentOwner) {
      return res.status(403).json({ error: 'You can only delete your own comments or comments on your own article.' });
    }

    // If the user is NOT the article owner, enforce the 10-minute (600s) window for deleting their own comment
    const elapsedSeconds = typeof comment.elapsed_seconds === 'number' ? Math.max(0, comment.elapsed_seconds) : 0;
    if (!isArticleOwner && elapsedSeconds > 600) {
      return res.status(403).json({
        error: 'Time limit exceeded: Comments can only be deleted within 10 minutes of posting.',
        expired: true,
      });
    }

    // Delete nested replies first (bottom-up), then the target comment itself
    const collectDescendantsBottomUp = (rootId) => {
      const children = db.prepare('SELECT id FROM comments WHERE parent_id = ?').all(rootId);
      const ids = [];
      for (const child of children) {
        ids.push(...collectDescendantsBottomUp(child.id));
      }
      ids.push(rootId);
      return ids;
    };
    const toDeleteIds = collectDescendantsBottomUp(commentId);
    const deleteStmt = db.prepare('DELETE FROM comments WHERE id = ?');
    const deleteTx = db.transaction((ids) => {
      for (const id of ids) deleteStmt.run(id);
    });
    deleteTx(toDeleteIds);

    // Sync article's total comment count accurately from the comments table
    const remainingCount = db.prepare('SELECT COUNT(*) as count FROM comments WHERE article_id = ?').get(articleId).count;
    db.prepare('UPDATE articles SET comments = ? WHERE id = ?').run(remainingCount, articleId);

    res.json({
      message: 'Comment deleted successfully.',
      deletedCount: toDeleteIds.length,
      totalComments: remainingCount,
    });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Failed to delete comment.' });
  }
}

app.delete('/api/articles/:articleId/comments/:commentId', requireAuth, handleDeleteComment);
app.post('/api/articles/:articleId/comments/:commentId/delete', requireAuth, handleDeleteComment);

// Get full user profile data (user info + published articles + saved articles + liked articles)
app.get('/api/user/dashboard', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const userKey = `user_${userId}`;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const publishedRows = db.prepare('SELECT * FROM articles WHERE user_id = ? ORDER BY id DESC').all(userId);
    const savedRows = db.prepare(`
      SELECT a.* FROM articles a
      INNER JOIN saved_articles s ON s.article_id = a.id
      WHERE s.user_id = ?
      ORDER BY s.id DESC
    `).all(userId);
    const likedRows = db.prepare(`
      SELECT a.* FROM articles a
      INNER JOIN article_likes l ON l.article_id = a.id
      WHERE l.user_key = ?
      ORDER BY l.id DESC
    `).all(userKey);
    const commentedRows = db.prepare(`
      SELECT a.*,
             (SELECT c2.content FROM comments c2 WHERE c2.article_id = a.id AND c2.user_id = ? ORDER BY c2.id DESC LIMIT 1) AS my_comment_content,
             MAX(c.id) AS last_comment_id
      FROM articles a
      INNER JOIN comments c ON c.article_id = a.id
      WHERE c.user_id = ?
      GROUP BY a.id
      ORDER BY last_comment_id DESC
    `).all(userId, userId);

    res.json({
      user: sanitizeUser(user),
      publishedArticles: publishedRows.map(r => formatArticleRow(r, userKey, userId)),
      savedArticles: savedRows.map(r => formatArticleRow(r, userKey, userId)),
      likedArticles: likedRows.map(r => formatArticleRow(r, userKey, userId)),
      commentedArticles: commentedRows.map(r => ({
        ...formatArticleRow(r, userKey, userId),
        myLatestComment: r.my_comment_content || '',
      })),
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load profile data.' });
  }
});

// Get any user's public profile (photo, bio, department, interests, published articles)
app.get('/api/users/public-profile', (req, res) => {
  try {
    const rawUserId = req.query.userId ? Number(req.query.userId) : null;
    const rawAuthor = req.query.author ? String(req.query.author).trim() : '';
    const viewerUserId = req.session ? req.session.userId : null;
    const viewerKey = getUserKey(req);

    let user = null;
    if (rawUserId && !isNaN(rawUserId) && rawUserId > 0) {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(rawUserId);
    }
    if (!user && rawAuthor) {
      user = db.prepare('SELECT * FROM users WHERE LOWER(full_name) = LOWER(?)').get(rawAuthor);
    }

    if (user) {
      const publishedRows = db.prepare(`
        SELECT * FROM articles
        WHERE user_id = ? OR LOWER(author_name) = LOWER(?)
        ORDER BY id DESC
      `).all(user.id, user.full_name);

      const safeUser = sanitizeUser(user);
      // Do not expose private phone number on other people's public profile
      const isOwnProfile = Boolean(viewerUserId && Number(viewerUserId) === Number(user.id));
      if (!isOwnProfile) {
        delete safeUser.phone;
      }

      return res.json({
        user: safeUser,
        isOwnProfile,
        publishedArticles: publishedRows.map(r => formatArticleRow(r, viewerKey, viewerUserId)),
      });
    }

    // Fallback for seeded community authors who don't have a row in users table yet
    if (rawAuthor) {
      const publishedRows = db.prepare(`
        SELECT * FROM articles
        WHERE LOWER(author_name) = LOWER(?)
        ORDER BY id DESC
      `).all(rawAuthor);

      const commentRow = db.prepare(`
        SELECT * FROM comments
        WHERE LOWER(author_name) = LOWER(?)
        ORDER BY id DESC LIMIT 1
      `).get(rawAuthor);

      const sample = publishedRows[0] || commentRow;
      const authorName = sample ? sample.author_name : rawAuthor;
      const deptStr = (sample && sample.author_dept) ? sample.author_dept : 'CSE \'26';
      const parts = deptStr.split("'");
      const deptCode = parts[0] ? parts[0].trim() : 'CSE';
      const gradYr = parts[1] ? '20' + parts[1].trim() : '2026';
      const topics = [...new Set(publishedRows.map(r => r.topic).filter(Boolean))];
      const slug = authorName.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.');

      const fallbackUser = {
        id: null,
        full_name: authorName,
        email: `${slug}@kgpian.iitkgp.ac.in`,
        department: deptCode,
        grad_year: gradYr,
        roll_number: null,
        bio: `${authorName} is a contributor & researcher in the IIT Kharagpur AI Community (${deptStr}).`,
        avatar_color: (sample && sample.author_avatar) || 'from-kgp-500 to-accent-violet',
        profile_image: (sample && sample.author_image) || null,
        is_verified: 1,
        interests: topics.length > 0 ? topics : ['Machine Learning', 'LLM', 'Deep Learning'],
      };

      return res.json({
        user: fallbackUser,
        isOwnProfile: false,
        publishedArticles: publishedRows.map(r => formatArticleRow(r, viewerKey, viewerUserId)),
      });
    }

    return res.status(404).json({ error: 'Profile not found.' });
  } catch (err) {
    console.error('Public profile error:', err);
    res.status(500).json({ error: 'Failed to load user profile.' });
  }
});

function formatArticleDate(dateStr) {
  if (!dateStr) return 'Just now';
  const d = new Date(dateStr + 'Z');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}


// ===== HELPERS =====

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Please log in first.' });
  }
  next();
}

function sanitizeUser(user) {
  // Remove sensitive fields before sending to client, but include has_password flag
  const { password_hash, ...safe } = user;
  return {
    ...safe,
    has_password: Boolean(password_hash && String(password_hash).length > 0),
    interests: safe.interests ? safe.interests.split(',') : [],
  };
}


// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`\n🚀 KGPConnect server running at http://localhost:${PORT}`);
  console.log(`   📄 Home:    http://localhost:${PORT}/index.html`);
  console.log(`   🔐 Login:   http://localhost:${PORT}/login.html`);
  console.log(`   📝 Signup:  http://localhost:${PORT}/signup.html`);
  const hasMail = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  if (hasMail) {
    console.log(`   ✉️  SMTP:    Configured (${process.env.SMTP_USER})\n`);
  } else {
    console.log(`   ⚠️  SMTP:    NOT configured. Set SMTP_USER & SMTP_PASS in hosting environment variables to deliver live OTPs.\n`);
  }
});
