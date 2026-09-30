require('dotenv').config();

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const sourcePath = path.join(__dirname, 'database.sqlite');
const isDryRun = process.argv.includes('--dry-run');
const fallbackProductImage = 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80';
const tables = ['admin_users', 'settings', 'categories', 'products', 'offers', 'orders'];
const mediaColumns = [
  ['products', 'image_url'],
  ['categories', 'image_url'],
  ['offers', 'image_url'],
  ['settings', 'logo_url'],
];

const allSqliteRows = (db, table) => new Promise((resolve, reject) => {
  db.all(`SELECT * FROM ${table}`, (error, rows) => {
    if (error) return reject(error);
    resolve(rows || []);
  });
});

const countPostgresRows = async (client, table) => {
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return result.rows[0].count;
};

const mimeTypeFor = (filePath) => ({
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}[path.extname(filePath).toLowerCase()] || 'application/octet-stream');

const readMedia = async (value) => {
  if (value.startsWith('/uploads/')) {
    const filename = path.basename(decodeURIComponent(value));
    const filePath = path.join(__dirname, 'uploads', filename);
    if (!fs.existsSync(filePath)) {
      if (filename.toLowerCase() === 'default-product.png') return readMedia(fallbackProductImage);
      if (filename.toLowerCase() === 'default-logo.png') return null;
      throw new Error(`Referenced upload is missing: ${filePath}`);
    }
    return { buffer: fs.readFileSync(filePath), contentType: mimeTypeFor(filePath), filename };
  }

  if (!/^https?:\/\//i.test(value)) return null;
  const url = new URL(value);
  if (url.pathname.startsWith('/storage/v1/object/public/')) return null;
  const response = await fetch(value, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not download existing media (${response.status}): ${value}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 50 * 1024 * 1024) throw new Error(`Media exceeds 50 MB: ${value}`);
  return {
    buffer,
    contentType: response.headers.get('content-type') || mimeTypeFor(url.pathname),
    filename: path.basename(url.pathname) || 'media',
  };
};

const moveMediaToStorage = async (rowsByTable, supabase, bucket) => {
  const mediaNeedsCopy = mediaColumns.some(([table, column]) =>
    rowsByTable[table].some((row) => {
      const value = String(row[column] || '');
      return value && !value.includes(`/storage/v1/object/public/${bucket}/`);
    })
  );
  if (!supabase && mediaNeedsCopy) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to migrate product and store media.');
  }
  if (!supabase) return 0;

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  const existingBucket = (buckets || []).find((item) => item.name === bucket);
  if (existingBucket && !existingBucket.public) {
    throw new Error(`Make the Supabase bucket "${bucket}" public before migrating.`);
  }
  if (!existingBucket && !isDryRun) {
    const { error } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: '50MB',
      allowedMimeTypes: ['image/*', 'video/*'],
    });
    if (error) throw error;
  }

  let uploaded = 0;
  for (const [table, column] of mediaColumns) {
    for (const row of rowsByTable[table]) {
      const value = String(row[column] || '');
      if (!value || value.includes(`/storage/v1/object/public/${bucket}/`)) continue;
      const media = await readMedia(value);
      if (!media) {
        row[column] = '';
        continue;
      }
      if (isDryRun) {
        uploaded += 1;
        continue;
      }

      const extension = path.extname(media.filename).toLowerCase();
      const objectPath = `${table}/${row.id}/${column}${extension}`;
      const { error } = await supabase.storage.from(bucket).upload(objectPath, media.buffer, {
        contentType: media.contentType,
        upsert: true,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      row[column] = data.publicUrl;
      uploaded += 1;
    }
  }
  return uploaded;
};

const migrate = async () => {
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite database not found: ${sourcePath}`);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

  const source = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY);
  const rowsByTable = {};
  for (const table of tables) rowsByTable[table] = await allSqliteRows(source, table);

  const defaultSeedAdmin = rowsByTable.admin_users.find((user) => {
    try { return bcrypt.compareSync('admin123', user.password_hash); } catch { return false; }
  });
  if (defaultSeedAdmin && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
    throw new Error('The SQLite database has the default admin123 account. Set ADMIN_EMAIL and ADMIN_PASSWORD before migrating so the copied account is secured.');
  }
  if (defaultSeedAdmin) {
    defaultSeedAdmin.username = process.env.ADMIN_USERNAME || 'admin';
    defaultSeedAdmin.email = process.env.ADMIN_EMAIL;
    defaultSeedAdmin.password_hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
  }

  const sourceCounts = Object.fromEntries(tables.map((table) => [table, rowsByTable[table].length]));
  if (isDryRun) {
    console.log('Dry run only. Source row counts:', sourceCounts);
  }

  const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'moscow-bakers';
  const mediaCount = await moveMediaToStorage(rowsByTable, supabase, bucket);
  if (isDryRun) {
    console.log(`Media references ready for cloud storage: ${mediaCount}`);
    await new Promise((resolve) => source.close(resolve));
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8'));
    const beforeCounts = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await countPostgresRows(client, table)])));

    await client.query('BEGIN');
    for (const table of tables) {
      for (const row of rowsByTable[table]) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        await client.query(query, columns.map((column) => row[column]));
      }
    }
    await client.query('COMMIT');

    for (const table of ['admin_users', 'categories', 'products', 'offers']) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), EXISTS (SELECT 1 FROM ${table}))`);
    }
    const afterCounts = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await countPostgresRows(client, table)])));
    console.log('SQLite source row counts:', sourceCounts);
    console.log('PostgreSQL row counts before migration:', beforeCounts);
    console.log('PostgreSQL row counts after migration:', afterCounts);
    console.log(`Media objects copied to Supabase Storage: ${mediaCount}`);
    console.log('Migration completed without deleting or truncating source or destination rows.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
    await new Promise((resolve) => source.close(resolve));
  }
};

migrate().catch((error) => {
  console.error('Migration stopped safely:', error.message);
  process.exitCode = 1;
});
