require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const createError = require('http-errors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const pool = require('./db');

const app = express();

app.use(
  cors({
    origin: 'http://localhost:3000',
    credentials: true,
  }),
);

app.use(express.json());

/* ================= AUTH ================= */

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password)
       VALUES ($1,$2,$3)
       RETURNING id, username, email`,
      [username, email, hash],
    );

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
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ================= USERS ================= */

app.get('/users', async (req, res) => {
  const result = await pool.query(`SELECT id, username, email FROM users ORDER BY id DESC`);

  res.json(result.rows);
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
