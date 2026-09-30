CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL
);

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
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  image_url TEXT,
  is_visible INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
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
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  title TEXT,
  image_url TEXT,
  description TEXT,
  old_price REAL,
  offer_price REAL,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER DEFAULT 1
);

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
);
