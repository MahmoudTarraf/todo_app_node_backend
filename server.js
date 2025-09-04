// =======================
// 📁 server.js (ESM version)
// =======================
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

import { Sequelize, DataTypes } from 'sequelize';
import AdminJS from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import AdminJSSequelize from '@adminjs/sequelize';

// Import routes (with .js extension for ESM)
import authRoutes from './routes/auth_routes.js';
import taskRoutes from './routes/tasks_routes.js';
import noteRoutes from './routes/notes_routes.js';
import usersRoutes from './routes/users_routes.js';
import { router as emailRoutes } from './helper/email_service.js';

dotenv.config();

// =======================
// 🔹 Sequelize + SQLite (AdminJS)
// =======================
AdminJS.registerAdapter(AdminJSSequelize);

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './todo.db',
  logging: false,
});

// =======================
// 🔹 Define Models matching existing SQLite tables
// =======================
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  name: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  password: { type: DataTypes.STRING },
  remainingUpdates: { type: DataTypes.INTEGER },
  remainingDeletes: { type: DataTypes.INTEGER },
  emailVerified: { type: DataTypes.BOOLEAN },
  notificationsOn: { type: DataTypes.INTEGER },
  taskStrikes: { type: DataTypes.INTEGER },
}, { tableName: 'users', timestamps: false });

const Task = sequelize.define('Task', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  title: { type: DataTypes.STRING },
  content: { type: DataTypes.TEXT },
  frequency: { type: DataTypes.STRING },
  dates: { type: DataTypes.STRING },
  deadline: { type: DataTypes.STRING },
  isCompleted: { type: DataTypes.BOOLEAN },
  taskType: { type: DataTypes.STRING },
  taskPriority: { type: DataTypes.STRING },
  userId: { type: DataTypes.INTEGER },
  fcmToken: { type: DataTypes.STRING },
}, { tableName: 'tasks', timestamps: false });

const Note = sequelize.define('Note', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  title: { type: DataTypes.STRING },
  content: { type: DataTypes.TEXT },
  userId: { type: DataTypes.INTEGER },
}, { tableName: 'notes', timestamps: false });

const FailedTask = sequelize.define('FailedTask', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  taskId: { type: DataTypes.INTEGER },
  title: { type: DataTypes.STRING },
  content: { type: DataTypes.TEXT },
  frequency: { type: DataTypes.STRING },
  dates: { type: DataTypes.STRING },
  deadline: { type: DataTypes.STRING },
  isCompleted: { type: DataTypes.BOOLEAN },
  taskType: { type: DataTypes.STRING },
  taskPriority: { type: DataTypes.STRING },
  userId: { type: DataTypes.INTEGER },
  fcmToken: { type: DataTypes.STRING },
  failedAt: { type: DataTypes.STRING },
}, { tableName: 'failedTasks', timestamps: false });

const Achievement = sequelize.define('Achievement', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  title: { type: DataTypes.STRING },
  subTitle: { type: DataTypes.STRING },
  condition: { type: DataTypes.INTEGER },
}, { tableName: 'achievements', timestamps: false });

const UserAchievement = sequelize.define('UserAchievement', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  userId: { type: DataTypes.INTEGER },
  achievementId: { type: DataTypes.INTEGER },
  achievedAt: { type: DataTypes.DATE },
}, { tableName: 'user_achievements', timestamps: false });

const BannedAccount = sequelize.define('BannedAccount', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  email: { type: DataTypes.STRING },
}, { tableName: 'banned_accounts', timestamps: false });

const EmailVerification = sequelize.define('EmailVerification', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  userId: { type: DataTypes.INTEGER },
  token: { type: DataTypes.STRING },
  expiresAt: { type: DataTypes.STRING },
  isUsed: { type: DataTypes.BOOLEAN },
}, { tableName: 'email_verifications', timestamps: false });

// =======================
// 🔹 AdminJS Setup
// =======================
const adminJs = new AdminJS({
  resources: [
    User, Task, Note, FailedTask, Achievement,
    UserAchievement, BannedAccount, EmailVerification
  ],
  rootPath: '/admin',
});

// Hardcoded admin (password is in plain text for bcrypt.compareSync)
const ADMIN = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
};

const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
  adminJs,
  {
    authenticate: async (email, password) => {
    const hashedPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
      if (email === ADMIN.email && bcrypt.compareSync(password, ADMIN.password)) {
        return ADMIN;
      }
      return null;
    },
    cookieName: 'adminjs',
    cookiePassword: 'supersecretcookiepassword',
  },
  null,
  {
    resave: false,
    saveUninitialized: true,
    secret: 'supersecretcookiepassword',
  }
);

// =======================
// 🔹 Express App
// =======================
const app = express();
app.use(bodyParser.json());
app.use(cors());

// Register routes
app.use('/auth', authRoutes);
app.use('/tasks', taskRoutes);
app.use('/notes', noteRoutes);
app.use('/users', usersRoutes);
app.use('', emailRoutes);

// Mount AdminJS
app.use(adminJs.options.rootPath, adminRouter);

// Error logging
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = 'localhost';

sequelize.authenticate().then(() => {
  console.log('✅ Connected to SQLite via Sequelize');
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running at http://${HOST}:${PORT}`);
    console.log(`🔑 AdminJS running at http://${HOST}:${PORT}/admin`);
  });
}).catch(err => {
  console.error('❌ Unable to connect to database:', err);
});
