const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件設定
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // 放置前端網頁的資料夾

// 1. 初始化 SQLite 資料庫 (會自動建立 database.sqlite 檔案)
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('資料庫連線失敗:', err.message);
  } else {
    console.log('成功連線至 SQLite 資料庫。');
  }
});

// 2. 自動建立三個核心表格 (products, orders, customers)
db.serialize(() => {
  // 商品表
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL
  )`);

  // 會員表
  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 訂單表
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending', -- pending: 待付款, paid: 已付款, shipped: 已出貨
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 預先寫入預設商品資料（如果商品表是空的）
  db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
    if (row.count === 0) {
      const stmt = db.prepare("INSERT INTO products (name, price, stock) VALUES (?, ?, ?)");
      stmt.run("ONE STROKE TEE", 1680, 50);
      stmt.run("LINE HOODIE", 2980, 30);
      stmt.run("STATEMENT TEE", 1880, 40);
      stmt.finalize();
      console.log('預設商品資料已匯入資料庫');
    }
  });
});

// ==========================================
// 3. 後端 API 接口 (Backend API Routes)
// ==========================================

// 【API 1】GET /api/orders：後台控制台抓取真實訂單
app.get('/api/orders', (req, res) => {
  db.all("SELECT * FROM orders ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, data: rows });
  });
});

// 【API 2】GET /api/products：取得所有商品與實時庫存
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, data: rows });
  });
});

// 【API 3】GET /api/customers：後台控制台抓取會員列表與消費統計
app.get('/api/customers', (req, res) => {
  const query = `
    SELECT c.id, c.name, c.email, c.created_at,
           COALESCE(SUM(o.total_amount), 0) as total_spent,
           COUNT(o.id) as total_orders
    FROM customers c
    LEFT JOIN orders o ON c.email = o.customer_email AND o.status = 'paid'
    GROUP BY c.id
  `;
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, data: rows });
  });
});

// 【API 4】POST /api/checkout：前台顧客下單並自動扣減庫存
app.post('/api/checkout', (req, res) => {
  const { customer_name, customer_email, items } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: '購物車不得為空' });
  }

  db.serialize(() => {
    // 步驟 A: 自動新增/更新會員
    db.run(
      `INSERT INTO customers (name, email) VALUES (?, ?) 
       ON CONFLICT(email) DO UPDATE SET name=excluded.name`,
      [customer_name, customer_email]
    );

    // 步驟 B: 計算總金額與檢查庫存
    let total_amount = 0;
    let order_no = 'OSC' + Date.now();

    // 假設簡化處理：這裡以傳入的商品項進行計算與庫存扣減
    items.forEach(item => {
      total_amount += item.price * item.quantity;
      // 自動扣減庫存
      db.run("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?", 
        [item.quantity, item.product_id, item.quantity]);
    });

    // 步驟 C: 建立訂單 (預設待付款 pending)
    db.run(
      `INSERT INTO orders (order_no, customer_name, customer_email, total_amount, status) VALUES (?, ?, ?, ?, ?)`,
      [order_no, customer_name, customer_email, total_amount, 'paid'], // 目前先寫為 paid 模擬成功
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: err.message });
        }
        res.json({
          success: true,
          message: '訂單建立成功！',
          order_no: order_no,
          total_amount: total_amount
        });
      }
    );
  });
});

// 【預留區】待金流申請通過後串接 API (例如: 綠界/藍新 ReturnURL / NotifyURL)
app.post('/api/payment/callback', (req, res) => {
  // TODO: 金流審核通過後，在此更新訂單狀態為 paid
  console.log('收到金流付款結果通知:', req.body);
  res.send('1|OK');
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`OSC CONTROL 後端伺服器已啟動！`);
  console.log(`網址: http://localhost:${PORT}`);
  console.log(`=================================`);
});
