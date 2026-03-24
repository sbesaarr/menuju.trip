const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

console.log('Connecting to PostgreSQL database...', process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':**@'));

// Helper to convert SQLite `?` to PostgreSQL `$1, $2, ...`
function convertQuery(query) {
    let count = 1;
    return query.replace(/\?/g, () => `$${count++}`);
}

const db = {
    all: (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        pool.query(convertQuery(sql), params || [], (err, res) => {
            if (cb) cb(err, res ? res.rows : []);
        });
    },
    get: (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        pool.query(convertQuery(sql), params || [], (err, res) => {
            if (cb) cb(err, res && res.rows.length > 0 ? res.rows[0] : null);
        });
    },
    run: (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        
        let q = convertQuery(sql);
        const isInsert = q.trim().toUpperCase().startsWith('INSERT');
        
        if (isInsert && !q.toUpperCase().includes('RETURNING')) {
            q += ' RETURNING id';
        }

        pool.query(q, params || [], (err, res) => {
            const context = {
                lastID: (isInsert && res && res.rows && res.rows.length > 0 && res.rows[0].id) ? res.rows[0].id : null,
                changes: res ? res.rowCount : 0
            };
            if (err) {
                // Adapt SQLite UNIQUE constraint error
                if (err.code === '23505') {
                    err.message = 'UNIQUE constraint failed';
                }
            }
            if (cb) cb.call(context, err);
        });
    },
    serialize: (cb) => {
        cb();
    },
    prepare: (sql) => {
        let promises = [];
        return {
            run: (...args) => {
                let cb = null;
                if (args.length > 0 && typeof args[args.length - 1] === 'function') {
                    cb = args.pop();
                }
                const promise = new Promise((resolve) => {
                    db.run(sql, args, function(err) {
                        if (cb) cb.call(this, err);
                        resolve();
                    });
                });
                promises.push(promise);
            },
            finalize: (cb) => {
                Promise.all(promises).then(() => {
                    if (cb) cb();
                });
            }
        };
    }
};

// Initialize schema
const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(100) NOT NULL,
            price REAL NOT NULL,
            cost_price REAL NOT NULL
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS guests (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50)
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS bookings (
            id SERIAL PRIMARY KEY,
            product_id INTEGER REFERENCES products(id),
            guest_id INTEGER REFERENCES guests(id),
            trip_date VARCHAR(100) NOT NULL,
            pax INTEGER NOT NULL,
            total_price REAL NOT NULL,
            down_payment REAL DEFAULT 0,
            status VARCHAR(100) DEFAULT 'BELUM TRIP',
            closing_by VARCHAR(255),
            guest_type VARCHAR(100),
            service_type VARCHAR(100),
            service_category VARCHAR(100),
            ship_type VARCHAR(100),
            cabin_name VARCHAR(255),
            ship_name VARCHAR(255),
            operator_name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS booking_services (
            id SERIAL PRIMARY KEY,
            booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id),
            qty INTEGER DEFAULT 1,
            price REAL NOT NULL
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS booking_payments (
            id SERIAL PRIMARY KEY,
            booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
            payment_date VARCHAR(100) NOT NULL,
            amount REAL NOT NULL,
            proof_url TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS operator_payments (
            id SERIAL PRIMARY KEY,
            booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
            payment_date VARCHAR(100) NOT NULL,
            amount REAL NOT NULL,
            proof_url TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS master_ships (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, category_name VARCHAR(255))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS master_sales (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS master_services (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS master_categories (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS master_ship_types (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role VARCHAR(100) DEFAULT 'staff',
                photo_url TEXT
            )
        `);

        // Seed Admin user
        const { rows: userRows } = await pool.query("SELECT COUNT(*) FROM users");
        if (parseInt(userRows[0].count) === 0) {
            console.log('Seeding master admin user...');
            const headpass = bcrypt.hashSync('admin123', 8);
            await pool.query("INSERT INTO users (username, password, role) VALUES ($1, $2, $3)", ['admin', headpass, 'admin']);
        }

        // Seed initial products
        const { rows: prodRows } = await pool.query("SELECT COUNT(*) FROM products");
        if (parseInt(prodRows[0].count) === 0) {
            console.log('Seeding initial products data...');
            await pool.query("INSERT INTO products (name, type, price, cost_price) VALUES ($1, $2, $3, $4)", ["Open Trip Darat 3D2N", "Open Trip", 1500000, 1000000]);
            await pool.query("INSERT INTO products (name, type, price, cost_price) VALUES ($1, $2, $3, $4)", ["Sailing 1 Day Komodo", "Sailing Trip", 1200000, 800000]);
            await pool.query("INSERT INTO products (name, type, price, cost_price) VALUES ($1, $2, $3, $4)", ["Private Trip Darat 2D1N", "Private Trip", 2500000, 1800000]);
            await pool.query("INSERT INTO products (name, type, price, cost_price) VALUES ($1, $2, $3, $4)", ["Sewa Spesial Drone", "Layanan Tambahan", 1500000, 1000000]);
        }

    } catch (e) {
        console.error('Error initializing PostgreSQL schema', e);
    }
};

initDB();

module.exports = db;
