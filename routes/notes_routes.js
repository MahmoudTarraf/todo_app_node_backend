// =======================
// 📁 routes/notes_routes.js
// =======================
// routes/notes_routes.js
import express from 'express';
import db from '../db.js';
import authenticateToken from '../middleware/authenticate_token.js';

const router = express.Router();

// 🔹 Get all notes for a user
router.get('/getNotes', authenticateToken, (req, res) => {
  const userId = req.user.id;

  const query = `SELECT * FROM notes WHERE userId = ? ORDER BY id DESC`;

  db.all(query, [userId], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});


// 🔹 Add a new note
router.post('/addNote', authenticateToken, (req, res) => {
  const { title, content } = req.body;
  const userId = req.user.id;

  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content are required' });
  }

  const query = `INSERT INTO notes (title, content, userId) VALUES (?, ?, ?)`;

  db.run(query, [title, content, userId], function (err) {
    if (err) return res.status(400).json({ message: err.message });
    res.json({ message: 'Note added successfully', id: this.lastID });
  });
});


// 🔹 Update a note
router.put('/updateNote/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;
  const { title, content } = req.body;
  const userId = req.user.id;

  const query = `UPDATE notes SET title = ?, content = ? WHERE id = ? AND userId = ?`;

  db.run(query, [title, content, noteId, userId], function (err) {
    if (err) return res.status(400).json({ message: err.message });
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Note not found or not owned by user' });
    }
    res.json({ message: 'Note updated' });
  });
});


// 🔹 Delete a note
router.delete('/deleteNote/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.user.id;

  db.run(`DELETE FROM notes WHERE id = ? AND userId = ?`, [noteId, userId], function (err) {
    if (err) return res.status(400).json({ message: err.message });
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Note not found or not owned by user' });
    }
    res.json({ message: 'Note deleted' });
  });
});


export default router;

