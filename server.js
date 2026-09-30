require('dotenv').config();

const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3011;
const dbPath = path.join(__dirname, 'database.sqlite');
const uploadsDir = path.join(__dirname, 'uploads');
const usePostgres = Boolean(process.env.DATABASE_URL);
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'moscow-bakers';
const hasCloudStorage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
let supabaseStorage = null;

fs.mkdirSync(uploadsDir, { recursive: true });

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured in production.');
}
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured in production; SQLite is local-only.');
}

if (hasCloudStorage) {
  supabaseStorage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const db = usePostgres
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 5,
    })
  : new sqlite3.Database(dbPath);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const filename = `product-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage: hasCloudStorage ? multer.memoryStorage() : storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/'));
  },
});

const toPostgresSql = (query) => query
  .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
  .replace(/\?/g, (() => {
    let parameter = 0;
    return () => `$${++parameter}`;
  })());

const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return Boolean(value);
};

const ensureString = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value));

const normalizeAvailability = (availableValue, stockStatusValue) => {
  const available = parseBoolean(availableValue) ? 1 : 0;
  const normalizedStatus = ensureString(stockStatusValue || (available ? 'in_stock' : 'out_of_stock'), available ? 'in_stock' : 'out_of_stock').toLowerCase();
  return {
    available,
    stock_status: normalizedStatus === 'out_of_stock' ? 'out_of_stock' : 'in_stock',
  };
};

const firstRow = (query, params = []) => new Promise((resolve, reject) => {
  if (usePostgres) {
    db.query(toPostgresSql(query), params)
      .then((result) => resolve(result.rows[0] || null))
      .catch(reject);
    return;
  }
  db.get(query, params, (err, row) => {
    if (err) return reject(err);
    resolve(row || null);
  });
});

const allRows = (query, params = []) => new Promise((resolve, reject) => {
  if (usePostgres) {
    db.query(toPostgresSql(query), params)
      .then((result) => resolve(result.rows || []))
      .catch(reject);
    return;
  }
  db.all(query, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows || []);
  });
});

const runSql = (query, params = []) => new Promise((resolve, reject) => {
  if (usePostgres) {
    db.query(toPostgresSql(query), params)
      .then((result) => resolve({ id: null, changes: result.rowCount || 0 }))
      .catch(reject);
    return;
  }
  db.run(query, params, function onRun(err) {
    if (err) return reject(err);
    resolve({ id: this.lastID, changes: this.changes });
  });
});

const persistUpload = async (file, fallback) => {
  if (!file) return fallback;
  if (!hasCloudStorage) return `/uploads/${file.filename}`;
  const objectPath = `${Date.now()}-${Math.random().toString(16).slice(2)}-${path.basename(file.originalname)}`;
  const { error } = await supabaseStorage.storage.from(storageBucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) throw error;
  return supabaseStorage.storage.from(storageBucket).getPublicUrl(objectPath).data.publicUrl;
};

const seedData = async () => {
  await runSql(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      business_name TEXT,
      logo_url TEXT,
      phone TEXT,
      whatsapp TEXT,
      address TEXT,
      opening_hours TEXT,
      facebook TEXT,
      instagram TEXT,
      tiktok TEXT,
      google_maps TEXT,
      delivery_charge REAL DEFAULT 80,
      free_delivery_min REAL DEFAULT 1000,
      currency TEXT DEFAULT '৳',
      delivery_areas TEXT DEFAULT 'Sitakunda',
      delivery_availability INTEGER DEFAULT 1
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT,
      image_url TEXT,
      is_visible INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      discount_price REAL DEFAULT 0,
      image_url TEXT,
      short_description TEXT,
      full_description TEXT,
      available INTEGER DEFAULT 1,
      featured INTEGER DEFAULT 0,
      stock_status TEXT DEFAULT 'in_stock',
      display_order INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      image_url TEXT,
      description TEXT,
      old_price REAL,
      offer_price REAL,
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      phone TEXT,
      address TEXT,
      order_items TEXT,
      subtotal REAL,
      delivery_charge REAL,
      total REAL,
      payment_method TEXT,
      order_date TEXT,
      order_time TEXT,
      status TEXT DEFAULT 'Pending'
    )
  `);

  const adminUser = await firstRow('SELECT * FROM admin_users WHERE email = ?', [process.env.ADMIN_EMAIL || 'admin@moscowbakers.com']);
  if (!adminUser && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
    await runSql(
      'INSERT INTO admin_users (username, email, password_hash) VALUES (?, ?, ?)',
      [process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_EMAIL, hash]
    );
  }

  const existingSettings = await firstRow('SELECT * FROM settings WHERE id = 1');
  if (!existingSettings) {
    await runSql(`
      INSERT INTO settings (
        id, business_name, logo_url, phone, whatsapp, address, opening_hours,
        facebook, instagram, tiktok, google_maps, delivery_charge, free_delivery_min,
        currency, delivery_areas, delivery_availability
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      1,
      'Moscow Bakers',
      '/uploads/default-logo.png',
      '+8801894839321',
      '+8801894839321',
      'Sitakunda, Chattogram, Bangladesh',
      '9:00 AM - 11:00 PM',
      'https://facebook.com',
      'https://instagram.com',
      'https://tiktok.com',
      'https://maps.google.com/?q=Sitakunda,Chattogram',
      80,
      1000,
      '৳',
      'Sitakunda, Banshkhali, Hathazari',
      1,
    ]);
  }

  const categoryCount = await firstRow('SELECT COUNT(*) as total FROM categories');
  if (!categoryCount || Number(categoryCount.total) === 0) {
    const defaultCategories = [
      ['Burger', 'burger', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80', 1, 1],
      ['Fast Food', 'fast-food', 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=900&q=80', 1, 2],
      ['Sweets', 'sweets', 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80', 1, 3],
      ['Bakery', 'bakery', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80', 1, 4],
      ['Coffee', 'coffee', 'https://images.unsplash.com/photo-1497636577773-f1231844b336?auto=format&fit=crop&w=900&q=80', 1, 5],
      ['Desserts', 'desserts', 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=900&q=80', 1, 6],
    ];

    for (const category of defaultCategories) {
      await runSql('INSERT INTO categories (name, slug, image_url, is_visible, sort_order) VALUES (?, ?, ?, ?, ?)', category);
    }
  }

  const productCount = await firstRow('SELECT COUNT(*) as total FROM products');
  if (!productCount || Number(productCount.total) === 0) {
    const sampleProducts = [
      ['Chicken Burger', 'Fast Food', 290, 260, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80', 'Juicy chicken burger with crisp lettuce and signature sauce.', 'Juicy chicken patty packed with fresh vegetables, cheese, and house sauce.', 1, 1, 'in_stock', 1, 0],
      ['Beef Burger', 'Fast Food', 320, 290, 'https://images.unsplash.com/photo-1550317138-10000687a72b?auto=format&fit=crop&w=900&q=80', 'Big beef burger with melted cheese and grilled flavor.', 'A rich beef burger layered with cheese, tomato, and our special dressing.', 1, 1, 'in_stock', 2, 0],
      ['Chicken Shawarma', 'Fast Food', 260, 240, 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=900&q=80', 'Fresh shawarma roll with garlic sauce and crunchy vegetables.', 'Hand-rolled shawarma loaded with chicken, vegetables and creamy garlic sauce.', 1, 0, 'in_stock', 3, 0],
      ['Sandesh', 'Sweets', 260, 240, 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80', 'Traditional Bengali sweet with creamy richness.', 'Authentic Bengali sweet made with fresh dairy and smooth texture.', 1, 1, 'in_stock', 4, 0],
      ['Hot Coffee', 'Coffee', 180, 160, 'https://images.unsplash.com/photo-1497636577773-f1231844b336?auto=format&fit=crop&w=900&q=80', 'Freshly brewed aromatic coffee.', 'Smooth, rich, and comforting hot coffee made for your daily pick-me-up.', 1, 1, 'in_stock', 5, 0],
      ['Chocolate Cake', 'Desserts', 620, 560, 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=900&q=80', 'Rich chocolate cake with gooey frosting.', 'Silky rich dessert cake loaded with chocolate flavor and soft crumb.', 1, 1, 'in_stock', 6, 0],
    ];

    for (const product of sampleProducts) {
      await runSql(
        'INSERT INTO products (name, category, price, discount_price, image_url, short_description, full_description, available, featured, stock_status, display_order, is_hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        product
      );
    }
  }

  const offerCount = await firstRow('SELECT COUNT(*) as total FROM offers');
  if (!offerCount || Number(offerCount.total) === 0) {
    await runSql(
      'INSERT INTO offers (title, image_url, description, old_price, offer_price, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['আজকের বিশেষ অফার', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80', '২টি বার্গার + ২টি ফ্রাই + ২টি ড্রিংক', 499, 399, '2026-10-01', '2026-10-31', 1]
    );
  }

  await runSql(`
    UPDATE products
    SET available = CASE WHEN stock_status = 'out_of_stock' OR available = 0 THEN 0 ELSE 1 END,
        stock_status = CASE WHEN stock_status = 'out_of_stock' OR available = 0 THEN 'out_of_stock' ELSE 'in_stock' END
    WHERE stock_status IS NULL OR stock_status = '' OR (available = 0 AND stock_status <> 'out_of_stock') OR (available = 1 AND stock_status <> 'in_stock') OR stock_status = 'out_of_stock'
  `);

  const orderCount = await firstRow('SELECT COUNT(*) as total FROM orders');
  if (!orderCount || Number(orderCount.total) === 0) {
    await runSql(
      'INSERT INTO orders (id, customer_name, phone, address, order_items, subtotal, delivery_charge, total, payment_method, order_date, order_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['MB-001', 'Rahman', '+8801712345678', 'Baitul Aman Road, Sitakunda', JSON.stringify([{ name: 'Chicken Burger', qty: 2, price: 290 }]), 580, 80, 660, 'Cash on Delivery', '2026-10-01', '18:15', 'Pending']
    );
    await runSql(
      'INSERT INTO orders (id, customer_name, phone, address, order_items, subtotal, delivery_charge, total, payment_method, order_date, order_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['MB-002', 'Nadia', '+8801812345678', 'Madrasa Road, Sitakunda', JSON.stringify([{ name: 'Sandesh', qty: 1, price: 260 }]), 260, 80, 340, 'bKash', '2026-10-01', '19:02', 'Confirmed']
    );
  }
};

const initializePostgres = async () => {
  if (!hasCloudStorage) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured for cloud media storage.');
  }

  await db.query(fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8'));

  const { data: bucket, error: bucketError } = await supabaseStorage.storage.getBucket(storageBucket);
  if (bucketError) {
    const { error: createError } = await supabaseStorage.storage.createBucket(storageBucket, {
      public: true,
      fileSizeLimit: 50 * 1024 * 1024,
      allowedMimeTypes: ['image/*', 'video/*'],
    });
    if (createError && !/already exists/i.test(createError.message)) throw createError;
  } else if (!bucket.public) {
    throw new Error(`Supabase bucket "${storageBucket}" must be public so storefront media can load.`);
  }

  const existingAdmin = await firstRow('SELECT id FROM admin_users LIMIT 1');
  if (!existingAdmin) {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      throw new Error('Create an admin by setting ADMIN_EMAIL and ADMIN_PASSWORD before starting the cloud service.');
    }
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
    await runSql(
      'INSERT INTO admin_users (username, email, password_hash) VALUES (?, ?, ?)',
      [process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_EMAIL, hash]
    );
  }
};

function getSessionUser(req) {
  return req.session && req.session.user ? req.session.user : null;
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (!hasCloudStorage) app.use('/uploads', express.static(uploadsDir));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'local-development-only-change-me',
    resave: false,
    saveUninitialized: false,
    store: usePostgres ? new PgSession({ pool: db, createTableIfMissing: true }) : undefined,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.set('trust proxy', 1);
app.use((req, res, next) => {
  const allowedOrigins = (process.env.CUSTOMER_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const origin = req.get('origin');
  const liveServerOrigins = ['http://localhost:5500', 'http://127.0.0.1:5500'];
  if (origin && (allowedOrigins.includes(origin) || liveServerOrigins.includes(origin) || origin === `${req.protocol}://${req.get('host')}`)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const publicFiles = new Set(['/index.html', '/styles.css', '/script.js', '/config.js', '/admin-login.html', '/admin.css', '/admin.js']);
app.use((req, res, next) => {
  if (req.path === '/') return res.sendFile(path.join(__dirname, 'index.html'));
  if (!publicFiles.has(req.path)) return next();
  express.static(__dirname, { index: false })(req, res, next);
});

function requireAdmin(req, res, next) {
  if (!getSessionUser(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

app.post('/api/admin/login', async (req, res) => {
  const usernameOrEmail = ensureString(req.body.usernameOrEmail || req.body.email || req.body.username, '').trim();
  const password = ensureString(req.body.password, '');

  if (!usernameOrEmail || !password) {
    return res.status(400).json({ ok: false, error: 'Email/username and password are required.' });
  }

  try {
    const user = await firstRow(
      'SELECT * FROM admin_users WHERE email = ? OR username = ?',
      [usernameOrEmail, usernameOrEmail]
    );

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Invalid login credentials.' });
    }

    req.session.user = { id: user.id, username: user.username, email: user.email };
    return res.json({ ok: true, user: req.session.user });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true, message: 'Logged out.' });
  });
});

app.get('/api/admin/session', (req, res) => {
  const currentUser = getSessionUser(req);
  if (!currentUser) {
    return res.status(401).json({ ok: false, message: 'Not logged in.' });
  }
  return res.json({ ok: true, user: currentUser });
});

app.get('/api/public/data', async (_req, res) => {
  try {
    const [categories, products, offers, settings] = await Promise.all([
      allRows('SELECT * FROM categories WHERE is_visible = 1 ORDER BY sort_order, id ASC'),
      allRows('SELECT * FROM products WHERE is_hidden = 0 ORDER BY display_order, id DESC'),
      allRows('SELECT * FROM offers WHERE is_active = 1 ORDER BY id DESC'),
      firstRow('SELECT * FROM settings WHERE id = 1')
    ]);

    const normalizedProducts = (products || []).map((product) => {
      const hidden = Number(product.is_hidden) === 1;
      const stockOut = String(product.stock_status || '').toLowerCase() === 'out_of_stock' || Number(product.available) === 0;
      const available = hidden ? 0 : stockOut ? 0 : Number(product.available) === 1 ? 1 : 0;
      return {
        ...product,
        available,
        stock_status: available ? 'in_stock' : 'out_of_stock',
      };
    });

    res.json({
      ok: true,
      categories,
      products: normalizedProducts,
      offers,
      settings: settings || {
        business_name: 'Moscow Bakers',
        phone: '+8801894839321',
        whatsapp: '+8801894839321',
        delivery_charge: 80,
        currency: '৳',
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/public/orders', async (req, res) => {
  try {
    const payload = req.body || {};
    const items = Array.isArray(payload.items) ? payload.items : [];

    for (const item of items) {
      const productId = Number(item.id ?? item.product_id ?? item.productId ?? 0);
      const product = productId ? await firstRow('SELECT * FROM products WHERE id = ?', [productId]) : null;
      if (!product) {
        return res.status(400).json({ ok: false, error: 'One or more selected products are no longer available.' });
      }
      if (Number(product.is_hidden) === 1 || Number(product.available) === 0 || String(product.stock_status || '').toLowerCase() === 'out_of_stock') {
        return res.status(400).json({ ok: false, error: `${product.name} is currently unavailable.` });
      }
      if (Number(item.qty || item.quantity || 1) < 1) {
        return res.status(400).json({ ok: false, error: 'Order quantity must be at least 1.' });
      }
    }

    const customerName = ensureString(payload.customerName, 'Customer');
    const phone = ensureString(payload.phone || payload.mobile, '');
    const address = ensureString(payload.address, '');
    const paymentMethod = ensureString(payload.paymentMethod, 'Cash on Delivery');
    const subtotal = Number(payload.subtotal || 0);
    const deliveryCharge = Number(payload.deliveryCharge || 80);
    const total = Number(payload.total || subtotal + deliveryCharge);
    const orderId = `MB-${Date.now().toString().slice(-6)}`;
    const orderDate = new Date().toISOString().slice(0, 10);
    const orderTime = new Date().toLocaleTimeString('en-GB', { hour12: false });

    await runSql(
      'INSERT INTO orders (id, customer_name, phone, address, order_items, subtotal, delivery_charge, total, payment_method, order_date, order_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [orderId, customerName, phone, address, JSON.stringify(items), subtotal, deliveryCharge, total, paymentMethod, orderDate, orderTime, 'Pending']
    );

    res.json({ ok: true, orderId, message: 'Order placed successfully.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const counts = await Promise.all([
      firstRow('SELECT COUNT(*) as total FROM products'),
      firstRow('SELECT COUNT(*) as total FROM products WHERE available = 1 AND is_hidden = 0'),
      firstRow("SELECT COUNT(*) as total FROM products WHERE available = 0 OR stock_status = 'out_of_stock' OR is_hidden = 1"),
      firstRow('SELECT COUNT(*) as total FROM orders'),
      firstRow("SELECT COUNT(*) as total FROM orders WHERE status = 'Pending'"),
      firstRow("SELECT COUNT(*) as total FROM orders WHERE status = 'Confirmed'"),
      firstRow("SELECT COUNT(*) as total FROM orders WHERE status = 'Delivered'"),
      firstRow(`SELECT COUNT(*) as total FROM orders WHERE ${usePostgres ? 'order_date::date = CURRENT_DATE' : 'date(order_date) = date(\"now\")'}`),
      firstRow(`SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE ${usePostgres ? 'order_date::date = CURRENT_DATE' : 'date(order_date) = date(\"now\")'}`),
    ]);

    const payload = {
      totalProducts: Number(counts[0]?.total || 0),
      availableProducts: Number(counts[1]?.total || 0),
      outOfStockProducts: Number(counts[2]?.total || 0),
      totalOrders: Number(counts[3]?.total || 0),
      pendingOrders: Number(counts[4]?.total || 0),
      confirmedOrders: Number(counts[5]?.total || 0),
      deliveredOrders: Number(counts[6]?.total || 0),
      todaysOrders: Number(counts[7]?.total || 0),
      todaysSales: Number(counts[8]?.total || 0),
    };

    res.json({ ok: true, dashboard: payload });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/admin/products', requireAdmin, async (_req, res) => {
  try {
    const products = await allRows('SELECT * FROM products ORDER BY display_order ASC, id DESC');
    const normalizedProducts = (products || []).map((product) => {
      const stockOut = String(product.stock_status || '').toLowerCase() === 'out_of_stock' || Number(product.available) === 0;
      const available = stockOut ? 0 : Number(product.available) === 1 ? 1 : 0;
      return {
        ...product,
        available,
        stock_status: available ? 'in_stock' : 'out_of_stock',
      };
    });
    res.json({ ok: true, products: normalizedProducts });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/products', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const imageUrl = await persistUpload(req.file, ensureString(req.body.image_url || req.body.image, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80'));
    const normalizedAvailability = normalizeAvailability(req.body.available, req.body.stock_status);
    const product = {
      name: ensureString(req.body.name, 'New Product').trim(),
      category: ensureString(req.body.category, 'Fast Food').trim(),
      price: Number(req.body.price || 0),
      discount_price: Number(req.body.discount_price || 0),
      image_url: imageUrl,
      short_description: ensureString(req.body.short_description || req.body.description, 'Freshly prepared from Moscow Bakers.'),
      full_description: ensureString(req.body.full_description || req.body.description, 'Freshly prepared from Moscow Bakers.'),
      available: normalizedAvailability.available,
      featured: parseBoolean(req.body.featured) ? 1 : 0,
      stock_status: normalizedAvailability.stock_status,
      display_order: toInt(req.body.display_order, 0),
      is_hidden: parseBoolean(req.body.is_hidden) ? 1 : 0,
    };

    await runSql(
      `INSERT INTO products (name, category, price, discount_price, image_url, short_description, full_description, available, featured, stock_status, display_order, is_hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        product.name,
        product.category,
        product.price,
        product.discount_price,
        product.image_url,
        product.short_description,
        product.full_description,
        product.available,
        product.featured,
        product.stock_status,
        product.display_order,
        product.is_hidden,
      ]
    );

    res.json({ ok: true, message: 'Product added successfully.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const imageUrl = await persistUpload(req.file, ensureString(req.body.image_url || req.body.image, ''));
    const normalizedAvailability = normalizeAvailability(req.body.available, req.body.stock_status);
    const updateFields = {
      name: ensureString(req.body.name, 'Updated Product').trim(),
      category: ensureString(req.body.category, 'Fast Food').trim(),
      price: Number(req.body.price || 0),
      discount_price: Number(req.body.discount_price || 0),
      short_description: ensureString(req.body.short_description || req.body.description, 'Freshly prepared product.'),
      full_description: ensureString(req.body.full_description || req.body.description, 'Freshly prepared product.'),
      available: normalizedAvailability.available,
      featured: parseBoolean(req.body.featured) ? 1 : 0,
      stock_status: normalizedAvailability.stock_status,
      display_order: toInt(req.body.display_order, 0),
      is_hidden: parseBoolean(req.body.is_hidden) ? 1 : 0,
    };

    let queryFields = Object.entries(updateFields)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => `${key} = ?`)
      .join(', ');
    const values = Object.values(updateFields);

    if (imageUrl) {
      queryFields += ', image_url = ?';
      values.push(imageUrl);
    }

    await runSql(`UPDATE products SET ${queryFields} WHERE id = ?`, [...values, id]);
    res.json({ ok: true, message: 'Product updated successfully.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch('/api/admin/products/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const field = ensureString(req.body.field || 'available', 'available');
    const current = await firstRow('SELECT available, is_hidden, stock_status FROM products WHERE id = ?', [id]);
    if (!current) {
      return res.status(404).json({ ok: false, error: 'Product not found.' });
    }

    if (field === 'available') {
      const nextValue = Number(current.available) === 1 ? 0 : 1;
      await runSql('UPDATE products SET available = ?, stock_status = ? WHERE id = ?', [nextValue, nextValue ? 'in_stock' : 'out_of_stock', id]);
      return res.json({ ok: true, value: nextValue });
    }

    const nextValue = Number(current.is_hidden) === 1 ? 0 : 1;
    await runSql('UPDATE products SET is_hidden = ? WHERE id = ?', [nextValue, id]);
    return res.json({ ok: true, value: nextValue });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    await runSql('DELETE FROM products WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true, message: 'Product deleted.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/admin/categories', requireAdmin, async (_req, res) => {
  try {
    const categories = await allRows('SELECT * FROM categories ORDER BY sort_order, id ASC');
    res.json({ ok: true, categories });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    const name = ensureString(req.body.name, '').trim();
    if (!name) {
      return res.status(400).json({ ok: false, error: 'Category name is required.' });
    }
    const slug = ensureString(req.body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'category');
    const imageUrl = ensureString(req.body.image_url || req.body.image, 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80');
    const isVisible = parseBoolean(req.body.is_visible) ? 1 : 1;
    const sortOrder = toInt(req.body.sort_order, 0);
    await runSql('INSERT INTO categories (name, slug, image_url, is_visible, sort_order) VALUES (?, ?, ?, ?, ?)', [name, slug, imageUrl, isVisible, sortOrder]);
    res.json({ ok: true, message: 'Category created.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = ensureString(req.body.name, '').trim();
    if (!name) {
      return res.status(400).json({ ok: false, error: 'Category name is required.' });
    }
    const slug = ensureString(req.body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'category');
    const imageUrl = ensureString(req.body.image_url || req.body.image, '');
    const isVisible = parseBoolean(req.body.is_visible) ? 1 : 0;
    const sortOrder = toInt(req.body.sort_order, 0);

    const updateValues = [name, slug, sortOrder, isVisible];
    let query = 'UPDATE categories SET name = ?, slug = ?, sort_order = ?, is_visible = ?';
    if (imageUrl) {
      query += ', image_url = ?';
      updateValues.push(imageUrl);
    }
    query += ' WHERE id = ?';
    updateValues.push(id);

    await runSql(query, updateValues);
    res.json({ ok: true, message: 'Category updated.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    await runSql('DELETE FROM categories WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true, message: 'Category deleted.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  try {
    const orders = await allRows('SELECT * FROM orders ORDER BY order_date DESC, order_time DESC');
    const parsed = orders.map((order) => ({ ...order, order_items: JSON.parse(order.order_items || '[]') }));
    res.json({ ok: true, orders: parsed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const status = ensureString(req.body.status, 'Pending');
    await runSql('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true, message: 'Order status updated.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/admin/offers', requireAdmin, async (_req, res) => {
  try {
    const offers = await allRows('SELECT * FROM offers ORDER BY id DESC');
    res.json({ ok: true, offers });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/offers', requireAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    await runSql(
      'INSERT INTO offers (title, image_url, description, old_price, offer_price, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ensureString(payload.title, 'Special Offer'), ensureString(payload.image_url || payload.image || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80'), ensureString(payload.description, ''), Number(payload.old_price || 0), Number(payload.offer_price || 0), ensureString(payload.start_date, new Date().toISOString().slice(0, 10)), ensureString(payload.end_date, new Date().toISOString().slice(0, 10)), parseBoolean(payload.is_active) ? 1 : 0]
    );
    res.json({ ok: true, message: 'Offer created.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put('/api/admin/offers/:id', requireAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    await runSql(
      'UPDATE offers SET title = ?, image_url = ?, description = ?, old_price = ?, offer_price = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?',
      [ensureString(payload.title, 'Special Offer'), ensureString(payload.image_url || payload.image || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80'), ensureString(payload.description, ''), Number(payload.old_price || 0), Number(payload.offer_price || 0), ensureString(payload.start_date, new Date().toISOString().slice(0, 10)), ensureString(payload.end_date, new Date().toISOString().slice(0, 10)), parseBoolean(payload.is_active) ? 1 : 0, Number(req.params.id)]
    );
    res.json({ ok: true, message: 'Offer updated.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  try {
    const settings = await firstRow('SELECT * FROM settings WHERE id = 1');
    res.json({ ok: true, settings: settings || {} });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    const updates = [
      ensureString(payload.business_name, 'Moscow Bakers'),
      ensureString(payload.logo_url || payload.logo, '/uploads/default-logo.png'),
      ensureString(payload.phone, '+8801894839321'),
      ensureString(payload.whatsapp, '+8801894839321'),
      ensureString(payload.address, 'Sitakunda, Chattogram, Bangladesh'),
      ensureString(payload.opening_hours, '9:00 AM - 11:00 PM'),
      ensureString(payload.facebook, 'https://facebook.com'),
      ensureString(payload.instagram, 'https://instagram.com'),
      ensureString(payload.tiktok, 'https://tiktok.com'),
      ensureString(payload.google_maps, 'https://maps.google.com/?q=Sitakunda,Chattogram'),
      Number(payload.delivery_charge || 80),
      Number(payload.free_delivery_min || 1000),
      ensureString(payload.currency, '৳'),
      ensureString(payload.delivery_areas, 'Sitakunda'),
      parseBoolean(payload.delivery_availability) ? 1 : 0,
      1,
    ];

    await runSql(
      `UPDATE settings SET business_name = ?, logo_url = ?, phone = ?, whatsapp = ?, address = ?, opening_hours = ?, facebook = ?, instagram = ?, tiktok = ?, google_maps = ?, delivery_charge = ?, free_delivery_min = ?, currency = ?, delivery_areas = ?, delivery_availability = ? WHERE id = ?`,
      updates
    );
    res.json({ ok: true, message: 'Settings updated.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/admin', (req, res) => {
  if (!getSessionUser(req)) return res.redirect('/admin-login.html');
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin-login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.get('/admin.html', (req, res) => {
  if (!getSessionUser(req)) return res.redirect('/admin-login.html');
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy' });
});

const initialize = usePostgres ? initializePostgres : seedData;

initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`Moscow Bakers server running on http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error('Database setup failed:', error);
  process.exit(1);
});
