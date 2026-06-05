require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const createError = require('http-errors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use(
  cors({
    origin: 'http://localhost:3000',
    credentials: true,
  }),
);

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'auth_db',
  password: 'postgres',
  port: 5432,
});

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword],
    );

    res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(400).json({ message: 'Wrong password' });
    }

    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/users', async (req, res) => {
  const result = await pool.query('SELECT * FROM users');
  res.json(result.rows);
});

app.use((req, res, next) => {
  next(createError(404));
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    message: err.message,
  });
});

app.use(
  '/',
  createProxyMiddleware({
    target: 'http://localhost:3000',
  }),
);

module.exports = app;
