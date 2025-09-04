import express from 'express';
import admin from 'firebase-admin';
import cron from 'node-cron';
import db from '../db.js';
import authenticateToken from '../middleware/authenticate_token.js';
import dotenv from 'dotenv';

const router = express.Router();
dotenv.config(); // <-- make sure this is called
// Initialize Firebase Admin

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      "type": process.env.GOOGLE_TYPE,
      "project_id": process.env.GOOGLE_PROJECT_ID,
      "private_key_id": process.env.GOOGLE_PRIVATE_KEY_ID,
      "private_key": process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // fix line breaks
      "client_email": process.env.GOOGLE_CLIENT_EMAIL,
      "client_id": process.env.GOOGLE_CLIENT_ID,
      "auth_uri": process.env.GOOGLE_AUTH_URI,
      "token_uri": process.env.GOOGLE_TOKEN_URI,
      "auth_provider_x509_cert_url": process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
      "client_x509_cert_url": process.env.GOOGLE_CLIENT_X509_CERT_URL,
      "universe_domain": process.env.GOOGLE_UNIVERSE_DOMAIN,
    }),
  });
}

// 🔹 Helper function to send notification
function sendNotification(task) {
  if (!task.fcmToken) return;

  // 🔹 Check if user allows notifications
  db.get(`SELECT notificationsOn FROM users WHERE id = ?`, [task.userId], (err, user) => {
    if (err) return console.error(err);
    if (!user || user.notificationsOn !== 1) return; // 🚫 Skip if turned off

    // ✅ safeguard: query latest state from DB before sending
    db.get(`SELECT isCompleted FROM tasks WHERE id = ?`, [task.id], (err, row) => {
      if (err) return console.error(err);
      if (!row) return;

      if (row.isCompleted) {
        // 🎉 Send congrats notification
        admin.messaging().send({
          token: task.fcmToken,
          notification: {
            title: `🎉 Congrats!`,
            body: `You’ve successfully completed: ${task.title}`,
          },
          data: { type: 'completed' }
        })
        .then(response => console.log(`✅ Congrats notification sent for task ${task.id}:`, response))
        .catch(err => console.error(`❌ Error sending congrats notification for task ${task.id}:`, err));
        return;
      }

      // ⏰ Otherwise, send reminder
      admin.messaging().send({
        token: task.fcmToken,
        notification: {
          title: `Task Reminder For: ${task.title}`,
          body: `Don't forget: ${task.content}`,
        },
        data: { type: 'reminder' }
      })
      .then(response => console.log(`✅ Reminder notification sent for task ${task.id}:`, response))
      .catch(err => console.error(`❌ Error sending reminder notification for task ${task.id}:`, err));
    });
  });
}

// 🔹 Helper function to warn user notification
function warnUserNotification(task) {
  if (!task.fcmToken) return;

  db.get(`SELECT notificationsOn FROM users WHERE id = ?`, [task.userId], (err, user) => {
    if (err) return console.error(err);
    if (!user || user.notificationsOn !== 1) return; // 🚫 Skip if turned off

    admin.messaging().send({
      token: task.fcmToken,
      notification: {
        title: `You Got Striked!`,
        body: `You Failed to Complete This Task On Time: ${task.title}`,
      },
      data: { type: 'warning' }
    })
    .then(response => console.log(`✅ Warning notification sent for task ${task.id}:`, response))
    .catch(err => console.error(`❌ Error sending warning notification for task ${task.id}:`, err));
  });
}

// 🔹 Cron job: every minute for notifications + failed tasks
cron.schedule('* * * * *', () => {
  const now = new Date();
  const nextMinute = new Date(now.getTime() + 60 * 1000);

  // Define multiple reminder intervals (minutes)
  const reminderIntervals = [0.1667, 5, 10, 15, 20]; // 0.1667 min = 10 sec

  // 🔹 Notifications for all oneTime/scheduled tasks
  db.all(
    `SELECT * FROM tasks WHERE deadline IS NOT NULL AND isCompleted = 0 AND fcmToken IS NOT NULL`,
    [],
    (err, rows) => {
      if (err) return console.error(err);

      rows.forEach(task => {
        const deadline = new Date(task.deadline);
        reminderIntervals.forEach(minBefore => {
          const reminderTime = new Date(deadline.getTime() - minBefore * 60 * 1000);
          if (reminderTime >= now && reminderTime <= nextMinute) {
            sendNotification(task);
          }
        });
      });
    }
  );

  // 🔹 Notifications for custom tasks
  db.all(
    `SELECT * FROM tasks WHERE frequency = 'custom' AND isCompleted = 0 AND fcmToken IS NOT NULL`,
    [],
    (err, rows) => {
      if (err) return console.error(err);
      rows.forEach(task => {
        try {
          const dates = JSON.parse(task.dates || "[]");
          dates.forEach(dateStr => {
            const taskDate = new Date(dateStr);
            reminderIntervals.forEach(minBefore => {
              const reminderTime = new Date(taskDate.getTime() - minBefore * 60 * 1000);
              if (!isNaN(reminderTime) && reminderTime >= now && reminderTime <= nextMinute) {
                sendNotification(task);
              }
            });
          });
        } catch (e) {
          console.error("❌ Failed parsing dates[] for task", task.id, e);
        }
      });
    }
  );

  // 🔹 Check failed tasks and insert into failedTasks table
  db.all(
    `SELECT * FROM tasks WHERE deadline IS NOT NULL AND isCompleted = 0 AND deadline < ?`,
    [now.toISOString()],
    (err, rows) => {
      if (err) return console.error(err);

      rows.forEach(task => {
        // Check if already in failedTasks
        db.get(`SELECT * FROM failedTasks WHERE taskId = ?`, [task.id], (checkErr, existing) => {
          if (checkErr) return console.error(checkErr);
          if (existing) return; // already marked as failed

          // Insert into failedTasks
          db.run(
            `INSERT INTO failedTasks
            (taskId, title, content, frequency, dates, deadline, isCompleted, taskType, taskPriority, userId, fcmToken, failedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              task.id,
              task.title,
              task.content,
              task.frequency,
              task.dates,
              task.deadline,
              task.isCompleted,
              task.taskType,
              task.taskPriority,
              task.userId,
              task.fcmToken,
              now.toISOString()
            ],
            (insertErr) => {
              if (insertErr) console.error('❌ Error inserting failed task:', insertErr);
            }
          );

          // Increment user strikes
          db.run(
            `UPDATE users SET taskStrikes = taskStrikes + 1 WHERE id = ?`,
            [task.userId],
            (updateErr) => {
              if (updateErr) console.error('❌ Error updating user strikes:', updateErr);
            }
          );

          // Delete task from tasks table
          db.run(`DELETE FROM tasks WHERE id = ?`, [task.id], (deleteErr) => {
            if (deleteErr) console.error('❌ Error deleting task:', deleteErr);
          });

          warnUserNotification(task);
        });
      });
    }
  );
});
// 🔹 Get all tasks excluding failed tasks
router.get('/getTasks', authenticateToken, (req, res) => {
  const userId = req.user.id;

  const query = `
    SELECT * FROM tasks
    WHERE userId = ?
      AND id NOT IN (
        SELECT taskId FROM failedTasks WHERE userId = ?
      )
  `;

  db.all(query, [userId, userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});


// 🔹 Get failed tasks
router.get('/getFailedTasks', authenticateToken, (req, res) => {
  const userId = req.user.id;
  db.all(`SELECT * FROM failedTasks WHERE userId = ? ORDER BY failedAt DESC`, [userId], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

// 🔹 Add new task
router.post('/addTask', authenticateToken, (req, res) => {
  const {
    title, content, frequency, dates, deadline,
    isCompleted = 0, taskType, taskPriority, fcmToken
  } = req.body;

  const userId = req.user.id;
  let taskDeadline = null;

  if (taskType === 'oneTime' || (taskType === 'scheduled' && (frequency === 'everyday' || frequency === 'everyweek'))) {
    taskDeadline = new Date(deadline);
    if (isNaN(taskDeadline)) return res.status(400).json({ message: 'Invalid deadline' });
  } else if (taskType === 'scheduled' && frequency === 'custom') {
    if (!Array.isArray(dates) || dates.length === 0)
      return res.status(400).json({ message: 'Custom tasks must include dates[]' });
  } else {
    return res.status(400).json({ message: 'Invalid taskType/frequency' });
  }

  const query = `
    INSERT INTO tasks
      (title, content, frequency, dates, deadline, isCompleted, taskType, taskPriority, userId, fcmToken)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    title,
    content,
    frequency,
    JSON.stringify(dates || []),
    taskDeadline ? taskDeadline.toISOString() : null,
    isCompleted,
    taskType,
    taskPriority,
    userId,
    fcmToken
  ];

  db.run(query, values, function (err) {
    if (err) return res.status(400).json({ message: err.message });
    const taskId = this.lastID;

    // Schedule notification
    if (taskDeadline && fcmToken) {
      const notifyTime = taskDeadline.getTime() - 10 * 1000;
      const delay = notifyTime - Date.now();
      if (delay > 0) {
        setTimeout(() => sendNotification({ id: taskId, title,content, fcmToken }), delay);
      }
    } else if (taskType === 'scheduled' && frequency === 'custom' && fcmToken) {
      dates.forEach(dateStr => {
        const d = new Date(dateStr);
        if (!isNaN(d)) {
          const notifyTime = d.getTime() - 10 * 1000;
          const delay = notifyTime - Date.now();
          if (delay > 0) setTimeout(() => sendNotification({ id: taskId, title,content, fcmToken }), delay);
        }
      });
    }

    res.json({ message: 'Task added successfully', id: taskId });
  });
});

// 🔹 Update task
router.put('/updateTask/:id', authenticateToken, (req, res) => {
  const taskId = req.params.id;
  const { title, content, frequency, dates, deadline, isCompleted, taskType, taskPriority, fcmToken } = req.body;
  const userId = req.user.id;

  const query = `UPDATE tasks 
    SET title = ?, content = ?, frequency = ?, dates = ?, deadline = ?, 
        isCompleted = ?, taskType = ?, taskPriority = ?, fcmToken = ?
    WHERE id = ? AND userId = ?`;

  const values = [
    title, content, frequency, JSON.stringify(dates || []),
    deadline, isCompleted, taskType, taskPriority,
    fcmToken, taskId, userId,
  ];

  db.run(query, values, function (err) {
    if (err) return res.status(400).json({ message: err.message });
    if (this.changes === 0) return res.status(404).json({ message: 'Task not found or not owned by user' });
    res.json({ message: 'Task updated' });
  });
});

// 🔹 Delete task
router.delete('/deleteTask/:id', authenticateToken, (req, res) => {
  const taskId = req.params.id;
  const userId = req.user.id;

  db.run(`DELETE FROM tasks WHERE id = ? AND userId = ?`, [taskId, userId], function (err) {
    if (err) return res.status(400).json({ message: err.message });
    if (this.changes === 0) return res.status(404).json({ message: 'Task not found or not owned by user' });
    res.json({ message: 'Task deleted' });
  });
});

export default router;
