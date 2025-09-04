import express from 'express';
import db from '../db.js'; // make sure your db.js also uses `export default`

const router = express.Router();
// Get all achievements + whether user unlocked them
router.get('/:id/getAchievements', (req, res) => {
  const userId = req.params.id;

  db.all(
    `
    SELECT 
      a.id, 
      a.title, 
      a.subTitle, 
      a.condition,
      COUNT(t.id) as userProgress,
      CASE WHEN ua.id IS NOT NULL THEN 1 ELSE 0 END AS isCompleted,
      ua.achievedAt
    FROM achievements a
    LEFT JOIN user_achievements ua
      ON a.id = ua.achievementId AND ua.userId = ?
    LEFT JOIN tasks t
      ON t.userId = ? AND t.isCompleted = 1
    GROUP BY a.id
    `,
    [userId, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });

      const result = rows.map(r => {
        const progress = Math.min(
          Math.round((r.userProgress / r.condition) * 100),
          100
        );

        return {
          id: r.id,
          title: r.title,
          subTitle: r.subTitle,
          condition: r.condition,
          progress,
          isCompleted: r.isCompleted === 1,
          achievedAt: r.achievedAt
        };
      });

      res.json(result);
    }
  );
});

// ---------------- LOGIC TO CHECK ACHIEVEMENTS ----------------
// Check and update achievements for a user
router.post('/:id/check-achievements', (req, res) => {
  const userId = req.params.id;

  db.get(
     `SELECT COUNT(*) as completedTasks FROM tasks WHERE userId = ? AND isCompleted = 1`,
    [userId],
    (err, row) => {
      if (err) return res.status(500).json({ message: err.message });

      const completedTasks = row.completedTasks;

      db.all(`SELECT * FROM achievements`, [], (err, achievements) => {
        if (err) return res.status(500).json({ message: err.message });

        let unlocked = [];

        achievements.forEach(ach => {
          if (completedTasks >= ach.condition) {
            // Insert if not already unlocked
            db.run(
              `INSERT OR IGNORE INTO user_achievements (userId, achievementId) VALUES (?, ?)`,
              [userId, ach.id],
              function (err2) {
                if (!err2 && this.changes > 0) {
                  unlocked.push(ach.title);
                }
              }
            );
          }
        });

        // After processing, return updated achievements
        db.all(
          `
          SELECT a.id, a.title, a.subTitle, a.condition,
                 CASE WHEN ua.id IS NOT NULL THEN 1 ELSE 0 END AS isCompleted,
                 ua.achievedAt
          FROM achievements a
          LEFT JOIN user_achievements ua
            ON a.id = ua.achievementId AND ua.userId = ?
          `,
          [userId],
          (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });

            const result = rows.map(r => ({
              id: r.id,
              title: r.title,
              subTitle: r.subTitle,
              condition: r.condition,
              isCompleted: r.isCompleted === 1,
              achievedAt: r.achievedAt
            }));

            res.json({
              message: unlocked.length
                ? `Unlocked achievements: ${unlocked.join(', ')}`
                : "No new achievements unlocked.",
              achievements: result
            });
          }
        );
      });
    }
  );
});


export default router;