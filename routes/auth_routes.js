import dotenv from 'dotenv';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendVerificationEmail } from '../helper/email_service.js'; // your helper
import db from '../db.js';
import authenticateToken from '../middleware/authenticate_token.js';
import { v4 as uuidv4 } from 'uuid';
import { transporter } from "../helper/email_service.js";  // 👈 import transporter


dotenv.config();

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;

// In-memory store for refresh tokens (use Redis or DB in production)
let refreshTokens = [];
// ----------------- Register
router.post('/register', async (req, res) => { 
  const { name, email, password } = req.body;

  db.get('SELECT * FROM banned_accounts WHERE email = ?', [email], async (err, banned) => {
    if (banned) return res.status(403).json({ message: 'This account is banned.' });

    const hashed = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (name, email, password, remainingUpdates, remainingDeletes, taskStrikes, emailVerified) 
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [name, email, hashed, 3, 3, 0],
      async function (err) {
        if (err) return res.status(400).json({ message: err.message });

        // Generate verification token
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

        db.run(
          'INSERT INTO email_verifications (userId, token, expiresAt) VALUES (?, ?, ?)',
          [this.lastID, token, expiresAt]
        );

        // Send email
        await sendVerificationEmail(email, token);

        res.json({
          message: 'Account created! Please verify your email to activate your account.',
        });
      }
    );
  });
});



// ----------------- Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    if (!user.emailVerified) return res.status(403).json({ message: 'Please verify your email first' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    const payload = { id: user.id, email: user.email };

    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
    const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: '364d' });

    refreshTokens.push(refreshToken);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        remainingUpdates: user.remainingUpdates,
        remainingDeletes: user.remainingDeletes,
        taskStrikes: user.taskStrikes,
      },
    });
  });
});

// ----------------- Refresh Access Token
router.post('/refreshToken', (req, res) => {
  const { token } = req.body;

  if (!token) return res.sendStatus(401);
  if (!refreshTokens.includes(token)) return res.sendStatus(403);

  jwt.verify(token, REFRESH_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    const accessToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '15m' });
    res.json({ accessToken });
  });
});

// ----------------- Logout (Protected)
router.post('/logout', authenticateToken, (req, res) => {
  const token = req.token; // token extracted in authenticateToken
  refreshTokens = refreshTokens.filter(t => t !== token);
  res.json({ message: "Logged out successfully" }); 
});

// ----------------- Get User (Protected)
router.get('/getUserDetails', authenticateToken, (req, res) => {
  db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  });
});

// ----------------- Update User Info (Protected)
router.put('/updateUserDetails', authenticateToken, (req, res) => {
  const { name, email, remainingUpdates, remainingDeletes, taskStrikes,notificationsOn } = req.body;

  // Prepare dynamic fields to update
  const updates = [];
  const values = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }

  if (notificationsOn !== undefined) {
    updates.push('notificationsOn = ?');
    values.push(notificationsOn);
  }
  if (email !== undefined) {
    updates.push('email = ?');
    values.push(email);

    // mark as unverified until they confirm
    updates.push('emailVerified = ?');
    values.push(0);
  }

  if (remainingUpdates !== undefined) {
    updates.push('remainingUpdates = ?');
    values.push(remainingUpdates);
  }
  if (remainingDeletes !== undefined) {
    updates.push('remainingDeletes = ?');
    values.push(remainingDeletes);
  }
  if (taskStrikes !== undefined) {
    updates.push('taskStrikes = ?');
    values.push(taskStrikes);
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No fields provided to update' });
  }

  values.push(req.user.id);

  const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;

  db.run(sql, values, function (err) {
    if (err) return res.status(500).json({ message: err.message });

    // if email changed, send verification
    if (email !== undefined) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      db.run(
        `INSERT INTO email_verifications (userId, token, expiresAt) VALUES (?, ?, ?)`,
        [req.user.id, token, expiresAt.toISOString()],
        async (err2) => {
          if (err2) return res.status(500).json({ message: err2.message });

          try {
            await sendVerificationEmail(email, token);
            return res.json({
              message: 'Email updated. Please verify your new email before logging in again.',
            });
          } catch (e) {
            return res.status(500).json({ message: 'Error sending verification email' });
          }
        }
      );
    } else {
      res.json({ message: 'User updated successfully', changes: this.changes });
    }
  });
});


// Delete user data if strikes >= 3
router.post('/checkStrikes', authenticateToken, (req, res) => {
  const userId = req.user.id;
 
  try {
    db.get('SELECT taskStrikes, email FROM users WHERE id = ?', [userId], (err, row) => {
      if (err) return res.status(500).json({ message: err.message });
      if (!row) return res.status(404).json({ message: 'User not found' });

      if (row.taskStrikes >= 3) {
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          db.run('INSERT OR IGNORE INTO banned_accounts (email) VALUES (?)', [row.email]);
          db.run('DELETE FROM tasks WHERE userId = ?', [userId]);
          db.run('DELETE FROM failedTasks WHERE userId = ?', [userId]);
          db.run('DELETE FROM notes WHERE userId = ?', [userId]);
          db.run('DELETE FROM user_achievements WHERE userId = ?', [userId]);
          db.run('DELETE FROM users WHERE id = ?', [userId]);
          db.run('COMMIT');
        });

        return res.json({ message: 'User data deleted due to 3 strikes' });
      } else {
        return res.json({ message: 'User is safe', strikes: row.taskStrikes });
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/changePassword', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Both current and new password required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' });
  }

  db.get('SELECT password FROM users WHERE id = ?', [userId], async (err, row) => {
    if (err || !row) return res.status(404).json({ message: 'User not found' });

    const match = await bcrypt.compare(currentPassword, row.password);
    if (!match) return res.status(400).json({ message: 'Current password incorrect' });

    // Prevent using the same password
    const sameAsOld = await bcrypt.compare(newPassword, row.password);
    if (sameAsOld) return res.status(400).json({ message: 'New password cannot be the same as old password' });

    const hashed = await bcrypt.hash(newPassword, 10);
    db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, userId], function(err) {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ message: 'Password updated successfully' });
    });
  });
});

// ✅ Step 1: User requests password reset, OTP is emailed
router.post("/forgetPassword", (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: "Email required" });

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err || !user) return res.status(404).json({ message: "User not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    db.run(
      "INSERT INTO password_otps (email, otp, expiresAt) VALUES (?, ?, ?)",
      [email, otp, expiresAt.toISOString()],
      (err) => {
        if (err) return res.status(500).json({ message: "DB error: " + err.message });

        transporter.sendMail(
          {
            from: '"Tasker App" <malk1milk2@gmail.com>',
            to: email,
            subject: "Your Password Reset OTP",
            html: `<p>Your OTP code is:</p>
                   <h2>${otp}</h2>
                   <p>This code expires in 5 minutes.</p>`,
          },
          (err) => {
            if (err) return res.status(500).json({ message: "Failed to send email" });
            res.json({ message: "OTP sent to email" });
          }
        );
      }
    );
  });
});

// ✅ Step 2: User submits OTP + new password
router.post("/resetPassword", async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: "Email, OTP and new password required" });
  }

  db.get(
    "SELECT * FROM password_otps WHERE email = ? ORDER BY id DESC LIMIT 1",
    [email],
    async (err, row) => {
      if (err || !row) return res.status(400).json({ message: "OTP not found" });

      if (row.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });
      if (new Date(row.expiresAt) < new Date()) {
        return res.status(400).json({ message: "OTP expired" });
      }

      const hashed = await bcrypt.hash(newPassword, 10);

      db.run("UPDATE users SET password = ? WHERE email = ?", [hashed, email], (err) => {
        if (err) return res.status(500).json({ message: "Failed to update password" });

        // delete used otp
        db.run("DELETE FROM password_otps WHERE email = ?", [email]);

        res.json({ message: "Password reset successful" });
      });
    }
  );
});


// Helper to format date as YYYY-MM-DD
const formatDate = (date) => date.toISOString().split('T')[0];

router.get('/getHomeData', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const now = new Date(); // current local time
  const today = formatDate(now);

  db.serialize(() => {
    let tasksDueToday = 0;
    let tasksCompleted = 0;
    let streak = 0;
    let upcomingTaskCount = 0;
    let upcomingTaskText = '';

    // 1️⃣ Count tasks due today (not completed)
    db.get(
      `SELECT COUNT(*) as count FROM tasks 
       WHERE userId = ? AND DATE(deadline) = ? AND isCompleted = 0`,
      [userId, today],
      (err, row) => {
        if (err) return res.status(500).json({ message: err.message });
        tasksDueToday = row.count;

        // 2️⃣ Count tasks completed today
        db.get(
          `SELECT COUNT(*) as count FROM tasks 
           WHERE userId = ? AND DATE(deadline) = ? AND isCompleted = 1`,
          [userId, today],
          (err, row) => {
            if (err) return res.status(500).json({ message: err.message });
            tasksCompleted = row.count;

            // 3️⃣ Get streak from users table
            db.get(
              `SELECT taskStrikes FROM users WHERE id = ?`,
              [userId],
              (err, user) => {
                if (err) return res.status(500).json({ message: err.message });
                streak = user ? user.taskStrikes : 0;

                // 4️⃣ Count upcoming tasks and get nearest deadline
                db.get(
                  `SELECT COUNT(*) as count, MIN(deadline) as nextDeadline 
                   FROM tasks 
                   WHERE userId = ? AND isCompleted = 0 AND deadline > ?`,
                  [userId, now.toISOString()],
                  (err, row) => {
                    if (err) return res.status(500).json({ message: err.message });

                    upcomingTaskCount = row.count;

                    if (row.nextDeadline) {
                      const nextDate = new Date(row.nextDeadline);
                      const diffMs = nextDate - new Date();
                      const diffMins = Math.ceil(diffMs / (1000 * 60)); // total minutes
                      const hours = Math.floor(diffMins / 60);
                      const minutes = diffMins % 60;

                      let timeText = '';
                      if (hours > 0) timeText += `${hours} hour${hours > 1 ? 's' : ''} `;
                      if (minutes > 0) timeText += `${minutes} minute${minutes > 1 ? 's' : ''}`;

                      upcomingTaskText = `You have ${upcomingTaskCount} task${upcomingTaskCount > 1 ? 's' : ''} due in ${timeText.trim()}!`;
                    }

                    // 5️⃣ Return all data
                    res.json({
                      tasksDueToday,
                      tasksCompleted,
                      streak,
                      upcomingTaskCount,
                      upcomingTaskText,
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

export default router;
