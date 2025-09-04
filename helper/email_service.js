import nodemailer from 'nodemailer';
import express from 'express';
import db from '../db.js';   
const router = express.Router();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'malk1milk2@gmail.com',
    pass: 'ghke wnqh qoqh itne', // use App Password if 2FA is on
  },
});

async function sendVerificationEmail(to, token) {
  const verificationLink = `https://5bafcca02c5b.ngrok-free.app/verify-email?token=${token}`;
  await transporter.sendMail({
    from: '"Tasker App" <malk1milk2@gmail.com>',
    to,
    subject: 'Verify your email',
    html: `<p>Please click the link to verify your email:</p>
           <a href="${verificationLink}">Verify Email</a>
           <p>This link expires in 24 hours.</p>`,
  });
}

router.get('/verify-email', (req, res) => {
  const { token } = req.query;

  if (!token) return res.status(400).send("Invalid verification link");

  db.get(
    'SELECT * FROM email_verifications WHERE token = ?',
    [token],
    (err, row) => {
      if (err || !row) return res.status(400).send("Invalid or expired token");

      if (new Date(row.expiresAt) < new Date()) {
        return res.status(400).send("Verification link expired");
      }

      // Mark user as verified
      db.run('UPDATE users SET emailVerified = 1 WHERE id = ?', [row.userId], (err) => {
        if (err) return res.status(500).send("Database error");

        // Optionally remove the token
        db.run('DELETE FROM email_verifications WHERE token = ?', [token]);

        res.send("✅ Email verified successfully! You can now log in.");
      });
    }
  );
});

export { sendVerificationEmail , router, transporter};
