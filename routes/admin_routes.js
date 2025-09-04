import express from 'express';
import db from '../db.js'; // make sure your db.js also uses `export default`

const router = express.Router();

// Add new achievement
router.post('/achievements', (req, res) => {
  const { title, subTitle, condition } = req.body;
  db.run(
    `INSERT INTO achievements (title, subTitle, condition) VALUES (?, ?, ?)`,
    [title, subTitle, condition],
    function (err) {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ id: this.lastID, title, subTitle, condition });
    }
  );
});

// Update achievement
router.put('/achievements/:id', (req, res) => {
  const { title, subTitle, condition } = req.body;
  const id = req.params.id;

  db.run(
    `UPDATE achievements SET title = ?, subTitle = ?, condition = ? WHERE id = ?`,
    [title, subTitle, condition, id],
    function (err) {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ updated: this.changes });
    }
  );
});

// Delete achievement
router.delete('/achievements/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM achievements WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ message: err.message });
    res.json({ deleted: this.changes });
  });
});

export default router;