const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.VERCEL ? '/tmp/database.sqlite' : path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('Connecting to SQLite database...');

db.serialize(() => {
    // 1. Products Table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        price REAL NOT NULL,
        cost_price REAL NOT NULL
    )`);

    // 2. Guests Table
    db.run(`CREATE TABLE IF NOT EXISTS guests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT
    )`);

    // 3. Bookings Table
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        guest_id INTEGER,
        trip_date TEXT NOT NULL,
        pax INTEGER NOT NULL,
        total_price REAL NOT NULL,
        down_payment REAL DEFAULT 0,
        status TEXT DEFAULT 'BELUM TRIP',
        closing_by TEXT,
        guest_type TEXT,
        service_type TEXT,
        service_category TEXT,
        ship_type TEXT,
        cabin_name TEXT,
        ship_name TEXT,
        operator_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (guest_id) REFERENCES guests(id)
    )`);

    // 4. Booking Services Table
    db.run(`CREATE TABLE IF NOT EXISTS booking_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER,
        product_id INTEGER,
        qty INTEGER DEFAULT 1,
        price REAL NOT NULL,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // 5. Booking Payments Table
    db.run(`CREATE TABLE IF NOT EXISTS booking_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER,
        payment_date TEXT NOT NULL,
        amount REAL NOT NULL,
        proof_url TEXT,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    )`);

    // 6. Operator Payments Table
    db.run(`CREATE TABLE IF NOT EXISTS operator_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER,
        payment_date TEXT NOT NULL,
        amount REAL NOT NULL,
        proof_url TEXT,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    )`);

    // 7. Master Settings Tables
    db.run(`CREATE TABLE IF NOT EXISTS master_ships (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_name TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS master_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS master_services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS master_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS master_ship_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);

    // 8. Users Table for Auth
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'staff'
        )
    `, () => {
        db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
            if (!err && row.count === 0) {
                console.log('Seeding master admin user...');
                const headpass = bcrypt.hashSync('admin123', 8);
                db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ['admin', headpass, 'admin']);
            }
        });
    });

    // Insert some initial master data if empty
    db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
        if (!err && row.count === 0) {
            console.log('Seeding initial products data...');
            const stmt = db.prepare("INSERT INTO products (name, type, price, cost_price) VALUES (?, ?, ?, ?)");
            stmt.run("Open Trip Darat 3D2N", "Open Trip", 1500000, 1000000);
            stmt.run("Sailing 1 Day Komodo", "Sailing Trip", 1200000, 800000);
            stmt.run("Private Trip Darat 2D1N", "Private Trip", 2500000, 1800000);
            stmt.run("Sewa Spesial Drone", "Layanan Tambahan", 1500000, 1000000);
            stmt.finalize();
        }
    });
});

module.exports = db;
