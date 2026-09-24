// server.js: konfigurasi dan endpoint untuk backend aplikasi dapur-aina
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'ganti-rahasia-ini-di-env',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 4 }, // sesi login 4 jam
}));

// Sajikan file frontend (index.html, style.css, script.js, assets/) yang sejajar dengan server.js ini
app.use(express.static(__dirname));

// Koneksi pool ke MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

/* autitentikasi admin dia admin/bukan  */ 
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'administrator') return next();
  return res.status(401).json({ error: 'Silakan login sebagai admin dulu.' });
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Username atau password salah.' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Username atau password salah.' });

    req.session.user = { id: user.id, name: user.name, role: user.role };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal login.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ user: req.session.user || null });
});

// GET /api/products: ambil daftar produk aktif dari database
// Join ke categories supaya frontend dapat "category" berupa slug (makanan-utama/appetizer/minuman)
// dan "image" dari kolom image_path.
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.sku, p.name, p.price, p.stock, p.minimum_stock,
             p.image_path AS image, c.slug AS category
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1
      ORDER BY p.id ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data produk dari database.' });
  }
});

// POST /api/products: tambah menu baru — hanya admin
app.post('/api/products', requireAdmin, async (req, res) => {
  const { name, price, stock, category, image } = req.body; // category = slug, mis. 'makanan-utama'

  if (!name || !price || stock === undefined || !category) {
    return res.status(400).json({ error: 'Data menu tidak lengkap.' });
  }

  try {
    const [catRows] = await pool.query('SELECT id FROM categories WHERE slug = ?', [category]);
    if (catRows.length === 0) return res.status(400).json({ error: 'Kategori tidak dikenali.' });

    const sku = `SKU-${Date.now()}`;
    await pool.query(
      'INSERT INTO products (category_id, sku, name, price, stock, minimum_stock, image_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [catRows[0].id, sku, name, price, stock, 3, image || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan menu baru.' });
  }
});

// POST /api/restock: tambah stok produk — hanya admin
app.post('/api/restock', requireAdmin, async (req, res) => {
  const { product_id, quantity } = req.body;

  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Data restock tidak valid.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query('SELECT stock FROM products WHERE id = ? FOR UPDATE', [product_id]);
    if (rows.length === 0) throw new Error('Produk tidak ditemukan.');

    const newStock = rows[0].stock + Number(quantity);
    await connection.query('UPDATE products SET stock = ? WHERE id = ?', [newStock, product_id]);
    await connection.query(
      'INSERT INTO stock_movements (product_id, movement_type, quantity_change, stock_after, note) VALUES (?, "restock", ?, ?, ?)',
      [product_id, quantity, newStock, 'Restock manual dari dashboard']
    );

    await connection.commit();
    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: err.message || 'Gagal menambah stok.' });
  } finally {
    connection.release();
  }
});

/* ============ GET /api/orders: riwayat pembelian — hanya admin ============ */
// Menggabungkan orders + payments + ringkasan order_items jadi satu baris per transaksi.
// Query opsional ?date=YYYY-MM-DD buat filter transaksi di tanggal tertentu.
app.get('/api/orders', requireAdmin, async (req, res) => {
  const { date } = req.query;

  try {
    let query = `
      SELECT o.id, o.order_number, o.order_type, o.subtotal, o.total_amount,
             o.status, o.paid_at, o.created_at, pay.payment_method,
             GROUP_CONCAT(CONCAT(oi.product_name, ' ×', oi.quantity) SEPARATOR ', ') AS items_summary
      FROM orders o
      LEFT JOIN payments pay ON pay.order_id = o.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
    `;
    const params = [];

    if (date) {
      query += ' WHERE DATE(o.created_at) = ? ';
      params.push(date);
    }

    query += ' GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100';

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil riwayat pembelian dari database.' });
  }
});

/* ============ POST /api/checkout ============ */
app.post('/api/checkout', async (req, res) => {
  const { items, payment_method } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Keranjang kosong.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let subtotal = 0;
    const itemDetails = [];

    // cek & kunci stok tiap produk
    for (const item of items) {
      const [rows] = await connection.query(
        'SELECT id, name, price, stock FROM products WHERE id = ? FOR UPDATE',
        [item.product_id]
      );
      if (rows.length === 0) throw new Error('Produk tidak ditemukan.');
      const product = rows[0];
      if (product.stock < item.quantity) throw new Error(`Stok ${product.name} tidak cukup.`);

      const lineSubtotal = Number(product.price) * item.quantity;
      subtotal += lineSubtotal;
      itemDetails.push({ ...product, quantity: item.quantity, lineSubtotal });
    }

    // buat order
    const orderNumber = `ORD-${Date.now()}`;
    const [orderResult] = await connection.query(
      `INSERT INTO orders (order_number, order_type, subtotal, total_amount, status, paid_at)
       VALUES (?, 'takeaway', ?, ?, 'paid', NOW())`,
      [orderNumber, subtotal, subtotal]
    );
    const orderId = orderResult.insertId;

    // order_items + update stok + stock_movements
    for (const item of itemDetails) {
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, item.id, item.name, item.price, item.quantity, item.lineSubtotal]
      );

      const newStock = item.stock - item.quantity;
      await connection.query('UPDATE products SET stock = ? WHERE id = ?', [newStock, item.id]);
      await connection.query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity_change, stock_after, reference_order_id, note)
         VALUES (?, 'sale', ?, ?, ?, 'Penjualan')`,
        [item.id, -item.quantity, newStock, orderId]
      );
    }

    // payments
    await connection.query(
      'INSERT INTO payments (order_id, payment_method, amount_paid) VALUES (?, ?, ?)',
      [orderId, payment_method, subtotal]
    );

    await connection.commit();

    // Ambil timestamp asli dari order supaya struk menampilkan jam yang sama persis dengan yang tersimpan
    const [[orderRow]] = await pool.query('SELECT paid_at FROM orders WHERE id = ?', [orderId]);

    // Sertakan rincian item & total supaya frontend bisa langsung menampilkan struk tanpa fetch tambahan
    res.json({
      success: true,
      order_number: orderNumber,
      payment_method,
      paid_at: orderRow.paid_at,
      subtotal,
      total_amount: subtotal,
      items: itemDetails.map(item => ({
        name: item.name,
        price: Number(item.price),
        quantity: item.quantity,
        subtotal: item.lineSubtotal,
      })),
    });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(400).json({ error: err.message || 'Checkout gagal.' });
  } finally {
    connection.release();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server jalan di http://localhost:${PORT}`);
});