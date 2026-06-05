const pool = require('./db');

async function test() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Подключение успешно:', result.rows[0]);
  } catch (err) {
    console.error('Ошибка подключения:', err);
  } finally {
    await pool.end();
  }
}

test();
