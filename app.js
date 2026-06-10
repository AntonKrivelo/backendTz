require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const createError = require('http-errors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const pool = require('./db');

function generateUniqueTag(username) {
  return username.toLowerCase().replace(/\s+/g, '') || 'user';
}

const app = express();

app.use(
  cors({
    origin: 'http://localhost:3000',
    credentials: true,
  }),
);

console.log('DATABASE_URL:', process.env.DATABASE_URL);
app.use(express.json());

/* ================= AUTH ================= */

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ success: false, message: 'Username is required' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const baseTag = generateUniqueTag(username);
    let tag = baseTag;
    let counter = 1;
    let result;
    while (true) {
      try {
        result = await pool.query(
          `INSERT INTO users (username, email, password, tag)
           VALUES ($1,$2,$3,$4)
           RETURNING id, username, email, tag`,
          [username, email, hash, tag],
        );
        break;
      } catch (e) {
        if (e.code === '23505' && e.constraint && e.constraint.includes('tag')) {
          tag = `${baseTag}${counter}`;
          counter++;
        } else {
          throw e;
        }
      }
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ message: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ message: 'Wrong password' });
    res.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, tag: user.tag },
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ================= USERS ================= */

app.get('/users', async (req, res) => {
  const result = await pool.query(`SELECT id, username, email, tag FROM users ORDER BY id DESC`);
  res.json(result.rows);
});

app.get('/users/tag/:tag', async (req, res) => {
  const { tag } = req.params;
  try {
    const result = await pool.query(`SELECT id, username, email, tag FROM users WHERE tag=$1`, [
      tag,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { username, email } = req.body;
  if (!username || !username.trim() || !email || !email.trim()) {
    return res.status(400).json({ message: 'Username and email are required' });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET username=$1, email=$2 WHERE id=$3
       RETURNING id, username, email, tag`,
      [username.trim(), email.trim(), id],
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, user: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'Email already taken' });
    res.status(500).json({ message: e.message });
  }
});

app.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM deeds WHERE user_id=$1`, [id]);
    const result = await client.query(`DELETE FROM users WHERE id=$1 RETURNING id`, [id]);
    await client.query('COMMIT');
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
});

/* ================= DEEDS ================= */

app.get('/deeds/:userId', async (req, res) => {
  const { userId } = req.params;

  const result = await pool.query(`SELECT * FROM deeds WHERE user_id=$1 ORDER BY id DESC`, [
    userId,
  ]);

  res.json(result.rows);
});

app.post('/deeds', async (req, res) => {
  const { userId, title } = req.body;

  const result = await pool.query(
    `INSERT INTO deeds (user_id, title)
     VALUES ($1,$2)
     RETURNING *`,
    [userId, title],
  );

  res.json(result.rows[0]);
});

app.put('/deeds/:id', async (req, res) => {
  const { id } = req.params;
  const { done } = req.body;

  const result = await pool.query(`UPDATE deeds SET done=$1 WHERE id=$2 RETURNING *`, [done, id]);

  res.json(result.rows[0]);
});

app.delete('/deeds/:id', async (req, res) => {
  await pool.query(`DELETE FROM deeds WHERE id=$1`, [req.params.id]);
  res.json({ success: true });
});

/* ================= FRIENDS ================= */

app.post('/friends', async (req, res) => {
  const { userId, friendTag } = req.body;
  if (!userId || !friendTag) {
    return res.status(400).json({ message: 'userId and friendTag are required' });
  }
  const parsedUserId = parseInt(userId, 10);
  if (isNaN(parsedUserId)) {
    return res.status(400).json({ message: 'userId must be a number' });
  }
  try {
    const userResult = await pool.query(`SELECT id FROM users WHERE tag=$1`, [friendTag]);
    if (userResult.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    const friendId = userResult.rows[0].id;
    if (String(friendId) === String(parsedUserId))
      return res.status(400).json({ message: 'Cannot add yourself' });
    await pool.query(`INSERT INTO friends (user_id, friend_id) VALUES ($1,$2)`, [
      parsedUserId,
      friendId,
    ]);
    res.json({ success: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'Already following' });
    res.status(500).json({ message: e.message });
  }
});

app.get('/friends/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.tag
       FROM friends f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id=$1
       ORDER BY f.id DESC`,
      [userId],
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.delete('/friends/:userId/:friendId', async (req, res) => {
  const { userId, friendId } = req.params;
  try {
    const result = await pool.query(`DELETE FROM friends WHERE user_id=$1 AND friend_id=$2`, [
      userId,
      friendId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Friend not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ================= ERROR ================= */

app.use((req, res, next) => {
  next(createError(404));
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ message: err.message });
});

/* ================= REACT ================= */

app.use(
  '/',
  createProxyMiddleware({
    target: 'http://localhost:3000',
    changeOrigin: true,
  }),
);

module.exports = app;
