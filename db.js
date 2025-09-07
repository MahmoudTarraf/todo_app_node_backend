// =======================
// 📁 db.js (ESM)
// =======================
import sqlite3 from 'sqlite3';
sqlite3.verbose();

const db = new sqlite3.Database('./todo.db', (err) => {
  if (err) return console.error(err.message);
  console.log('🗂️ Connected to SQLite database');
});

// Create users table
// Each user has many tasks and notes

// Create tables
const initDb = () => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      remainingUpdates INTEGER DEFAULT 3,
      remainingDeletes INTEGER DEFAULT 3,
      notificationsOn INTEGER DEFAULT 1,
      lastRewardDate TEXT,
      lastRewardStreak INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      lastTaskDate TEXT,
      emailVerified INTEGER,
      taskStrikes INTEGER DEFAULT 0
    )
  `);

  // Create tasks table
  db.serialize(()=>
    {
    db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      frequency TEXT NOT NULL,
      dates TEXT NOT NULL,
      deadline TEXT,
      deadlineDate TEXT,
      isCompleted INTEGER NOT NULL DEFAULT 0,
      taskType TEXT NOT NULL,
      taskPriority TEXT NOT NULL,
      userId INTEGER,
      fcmToken TEXT,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // Create index separately for fast queries on userId + deadlineDate
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tasks_user_date 
    ON tasks(userId, deadlineDate)
  `);
  db.run(`
  CREATE INDEX IF NOT EXISTS idx_tasks_user_deadline
  ON tasks(userId, deadline)
  `);

  });


  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      userId INTEGER,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);


// Create failedTasks table
db.run(`
  CREATE TABLE IF NOT EXISTS failedTasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taskId INTEGER,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    frequency TEXT NOT NULL,
    dates TEXT NOT NULL,
    deadline TEXT,
    isCompleted INTEGER NOT NULL,
    taskType TEXT NOT NULL,
    taskPriority TEXT NOT NULL,
    userId INTEGER,
    fcmToken TEXT,
    failedAt TEXT,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
  )`);
  
db.run(`
  CREATE TABLE IF NOT EXISTS banned_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE
  )`);
db.run(`
    CREATE TABLE IF NOT EXISTS email_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expiresAt TEXT NOT NULL,
    isUsed INTEGER DEFAULT 0
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subTitle TEXT,
    condition INTEGER NOT NULL -- number of completed tasks needed
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    achievementId INTEGER NOT NULL,
    achievedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(userId, achievementId),
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(achievementId) REFERENCES achievements(id)
  )
`);
// db.js (or migration file)
db.run(`
  CREATE TABLE IF NOT EXISTS password_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    otp TEXT NOT NULL,
    expiresAt DATETIME NOT NULL
  )
`);

};

initDb();
export default db;