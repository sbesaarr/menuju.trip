const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.post('/api/upload', upload.single('proof'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// --- AUTH ROUTES ---
const JWT_SECRET = 'menuju_trip_super_secret_key_123';

const verifyToken = (req, res, next) => {
    const header = req.headers['authorization'];
    if (!header) return res.status(403).json({ error: 'Token missing' });
    const token = header.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Token invalid' });
        req.userId = decoded.id;
        next();
    });
};
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Username tidak ditemukan' });
        
        const isMatch = bcrypt.compareSync(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Password salah' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    });
});

app.get('/api/users', (req, res) => {
    db.all("SELECT id, username, role FROM users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', (req, res) => {
    const { username, password, role } = req.body;
    const hash = bcrypt.hashSync(password, 8);
    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, hash, role || 'staff'], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username sudah digunakan' });
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, username, role: role || 'staff' });
    });
});

app.delete('/api/users/:id', (req, res) => {
    db.run("DELETE FROM users WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.put('/api/users/:id/reset', verifyToken, (req, res) => {
    db.get("SELECT role FROM users WHERE id = ?", [req.userId], (err, currentUser) => {
        if (err || !currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ error: 'Akses ditolak. Hanya admin yang dapat melakukan reset password.' });
        }
        
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Password minimal 6 karakter' });
        }

        const hash = bcrypt.hashSync(newPassword, 8);
        db.run("UPDATE users SET password = ? WHERE id = ?", [hash, req.params.id], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            res.json({ success: true, message: 'Password berhasil direset' });
        });
    });
});

// --- PROFILE ROUTES ---
app.get('/api/profile', verifyToken, (req, res) => {
    db.get("SELECT id, username, role, photo_url FROM users WHERE id = ?", [req.userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    });
});

app.put('/api/profile/password', verifyToken, (req, res) => {
    const { oldPassword, newPassword } = req.body;
    db.get("SELECT password FROM users WHERE id = ?", [req.userId], (err, user) => {
        if (err || !user) return res.status(500).json({ error: "Terjadi kesalahan" });
        if (!bcrypt.compareSync(oldPassword, user.password)) return res.status(400).json({ error: "Password lama salah" });
        
        const hash = bcrypt.hashSync(newPassword, 8);
        db.run("UPDATE users SET password = ? WHERE id = ?", [hash, req.userId], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            res.json({ success: true });
        });
    });
});

app.put('/api/profile/avatar', verifyToken, upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Image missing" });
    const url = `/uploads/${req.file.filename}`;
    db.run("UPDATE users SET photo_url = ? WHERE id = ?", [url, req.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ photo_url: url });
    });
});

// --- SETTINGS ROUTES ---
app.get('/api/settings/:type', (req, res) => {
    const valid = ['ships', 'sales', 'services', 'categories', 'ship_types'];
    if (!valid.includes(req.params.type)) return res.status(400).end();
    db.all(`SELECT * FROM master_${req.params.type} ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/settings/:type', (req, res) => {
    const valid = ['ships', 'sales', 'services', 'categories', 'ship_types'];
    if (!valid.includes(req.params.type)) return res.status(400).end();
    
    if (req.params.type === 'ships') {
        db.run(`INSERT INTO master_ships (name, category_name) VALUES (?, ?)`, [req.body.name, req.body.category_name || ''], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name: req.body.name, category_name: req.body.category_name });
        });
    } else {
        db.run(`INSERT INTO master_${req.params.type} (name) VALUES (?)`, [req.body.name], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name: req.body.name });
        });
    }
});

app.delete('/api/settings/:type/:id', (req, res) => {
    const valid = ['ships', 'sales', 'services', 'categories', 'ship_types'];
    if (!valid.includes(req.params.type)) return res.status(400).end();
    db.run(`DELETE FROM master_${req.params.type} WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});


app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/products', (req, res) => {
    const { name, type, price, cost_price } = req.body;
    db.run(
        "INSERT INTO products (name, type, price, cost_price) VALUES (?, ?, ?, ?)",
        [name, type, price, cost_price],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.get('/api/bookings', (req, res) => {
    const query = `
        SELECT b.*, p.name as product_name, p.cost_price, g.name as guest_name, g.phone as guest_phone 
        FROM bookings b
        JOIN products p ON b.product_id = p.id
        JOIN guests g ON b.guest_id = g.id
        ORDER BY b.trip_date ASC
    `;
    db.all(query, [], (err, bookings) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all("SELECT bs.*, p.name, p.cost_price FROM booking_services bs JOIN products p ON bs.product_id = p.id", [], (err2, services) => {
            if (err2) return res.status(500).json({ error: err2.message });
            db.all("SELECT * FROM booking_payments", [], (err3, payments) => {
                if (err3) return res.status(500).json({ error: err3.message });
                db.all("SELECT * FROM operator_payments", [], (err4, op_payments) => {
                    const results = bookings.map(b => ({
                        ...b,
                        additional_services: services.filter(s => s.booking_id === b.id),
                        payments: payments.filter(p => p.booking_id === b.id),
                        operator_payments: op_payments ? op_payments.filter(p => p.booking_id === b.id) : []
                    }));
                    res.json(results);
                });
            });
        });
    });
});

app.post('/api/bookings', (req, res) => {
    const { guest_name, guest_phone, product_id, trip_date, pax, total_price, down_payment, additional_services, payments, closing_by, guest_type, service_type, service_category, ship_type, cabin_name, ship_name, operator_name, operator_payments } = req.body;
    
    db.run("INSERT INTO guests (name, phone) VALUES (?, ?)", [guest_name, guest_phone], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        const guest_id = this.lastID;
        
        db.run(
            "INSERT INTO bookings (product_id, guest_id, trip_date, pax, total_price, down_payment, closing_by, guest_type, service_type, service_category, ship_type, cabin_name, ship_name, operator_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [product_id, guest_id, trip_date, pax, total_price, down_payment, closing_by, guest_type, service_type, service_category, ship_type, cabin_name, ship_name, operator_name],
            function (err2) {
                if (err2) return res.status(500).json({ error: err2.message });
                const booking_id = this.lastID;
                
                const processOpPayments = () => {
                    if (operator_payments && operator_payments.length > 0) {
                        const stmt = db.prepare("INSERT INTO operator_payments (booking_id, payment_date, amount, proof_url) VALUES (?, ?, ?, ?)");
                        operator_payments.forEach(p => stmt.run(booking_id, p.payment_date, p.amount, p.proof_url || null));
                        stmt.finalize(() => res.json({ id: booking_id }));
                    } else {
                        res.json({ id: booking_id });
                    }
                };

                const processPayments = () => {
                    if (payments && payments.length > 0) {
                        const stmt = db.prepare("INSERT INTO booking_payments (booking_id, payment_date, amount, proof_url) VALUES (?, ?, ?, ?)");
                        payments.forEach(p => stmt.run(booking_id, p.payment_date, p.amount, p.proof_url || null));
                        stmt.finalize(processOpPayments);
                    } else {
                        processOpPayments();
                    }
                };

                if (additional_services && additional_services.length > 0) {
                    const stmt = db.prepare("INSERT INTO booking_services (booking_id, product_id, qty, price) VALUES (?, ?, ?, ?)");
                    additional_services.forEach(svc => {
                        stmt.run(booking_id, svc.product_id, svc.qty, svc.price);
                    });
                    stmt.finalize(processPayments);
                } else {
                    processPayments();
                }
            }
        );
    });
});

app.put('/api/bookings/:id', (req, res) => {
    const { guest_name, guest_phone, product_id, trip_date, pax, total_price, down_payment, additional_services, payments, closing_by, guest_type, service_type, service_category, ship_type, cabin_name, ship_name, operator_name, operator_payments, guest_id } = req.body;
    const booking_id = req.params.id;

    db.run("UPDATE guests SET name = ?, phone = ? WHERE id = ?", [guest_name, guest_phone, guest_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.run(
            "UPDATE bookings SET product_id = ?, trip_date = ?, pax = ?, total_price = ?, down_payment = ?, closing_by = ?, guest_type = ?, service_type = ?, service_category = ?, ship_type = ?, cabin_name = ?, ship_name = ?, operator_name = ? WHERE id = ?",
            [product_id, trip_date, pax, total_price, down_payment, closing_by, guest_type, service_type, service_category, ship_type, cabin_name, ship_name, operator_name, booking_id],
            (err2) => {
                if (err2) return res.status(500).json({ error: err2.message });
                
                db.run("DELETE FROM booking_services WHERE booking_id = ?", [booking_id], (err3) => {
                    const processOpPayments = () => {
                        db.run("DELETE FROM operator_payments WHERE booking_id = ?", [booking_id], () => {
                            if (operator_payments && operator_payments.length > 0) {
                                const stmt = db.prepare("INSERT INTO operator_payments (booking_id, payment_date, amount, proof_url) VALUES (?, ?, ?, ?)");
                                operator_payments.forEach(p => stmt.run(booking_id, p.payment_date, p.amount, p.proof_url || null));
                                stmt.finalize(() => res.json({ updated: true }));
                            } else {
                                res.json({ updated: true });
                            }
                        });
                    };

                    const processPayments = () => {
                        db.run("DELETE FROM booking_payments WHERE booking_id = ?", [booking_id], () => {
                            if (payments && payments.length > 0) {
                                const stmt = db.prepare("INSERT INTO booking_payments (booking_id, payment_date, amount, proof_url) VALUES (?, ?, ?, ?)");
                                payments.forEach(p => stmt.run(booking_id, p.payment_date, p.amount, p.proof_url || null));
                                stmt.finalize(processOpPayments);
                            } else {
                                processOpPayments();
                            }
                        });
                    };

                    if (additional_services && additional_services.length > 0) {
                        const stmt = db.prepare("INSERT INTO booking_services (booking_id, product_id, qty, price) VALUES (?, ?, ?, ?)");
                        additional_services.forEach(svc => {
                            stmt.run(booking_id, svc.product_id, svc.qty, svc.price);
                        });
                        stmt.finalize(processPayments);
                    } else {
                        processPayments();
                    }
                });
            }
        );
    });
});

app.delete('/api/bookings/:id', (req, res) => {
    db.run("DELETE FROM operator_payments WHERE booking_id = ?", [req.params.id], () => {
        db.run("DELETE FROM booking_payments WHERE booking_id = ?", [req.params.id], () => {
            db.run("DELETE FROM booking_services WHERE booking_id = ?", [req.params.id], () => {
                db.run("DELETE FROM bookings WHERE id = ?", [req.params.id], function (err2) {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ deleted: this.changes });
                });
            });
        });
    });
});

app.patch('/api/bookings/:id/status', (req, res) => {
    const { status } = req.body;
    db.run("UPDATE bookings SET status = ? WHERE id = ?", [status, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
    });
});

app.get('/api/dashboard/full', (req, res) => {
    const query = `
        SELECT 
            b.*, 
            p.name as product_name, p.cost_price as product_cost, p.type as product_type,
            g.name as guest_name
        FROM bookings b
        JOIN products p ON b.product_id = p.id
        LEFT JOIN guests g ON b.guest_id = g.id
        WHERE b.status != 'CANCEL/RESCHEDULE'
    `;
    db.all(query, [], (err, bookings) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.all("SELECT * FROM booking_services", [], (err2, all_services) => {
            db.all("SELECT * FROM products", [], (err3, all_products) => {
                let total_revenue = 0;
                let total_pax = 0;
                let total_hpp = 0;

                const packagesPax = {};
                const packagesMargin = {};
                const operatorFreq = {};
                const operatorMargin = {};
                const salesClosing = {};
                
                let marginOpenTrip = 0;

                const openTripPax = {};
                const privateDaratPax = {};
                const shipFreq = {};

                bookings.forEach(b => {
                    total_revenue += b.total_price;
                    total_pax += b.pax;

                    let base_hpp = b.pax * b.product_cost;
                    let addons_hpp = 0;
                    
                    const b_services = all_services.filter(s => s.booking_id === b.id);
                    b_services.forEach(svc => {
                        const prod = all_products.find(p => p.id === svc.product_id);
                        if (prod) addons_hpp += (svc.qty * prod.cost_price);
                    });

                    const final_hpp = base_hpp + addons_hpp;
                    total_hpp += final_hpp;
                    
                    const net_margin = b.total_price - final_hpp;

                    packagesPax[b.product_name] = (packagesPax[b.product_name] || 0) + b.pax;
                    packagesMargin[b.product_name] = (packagesMargin[b.product_name] || 0) + net_margin;
                    
                    if (b.operator_name && b.operator_name !== '-') {
                        operatorFreq[b.operator_name] = (operatorFreq[b.operator_name] || 0) + 1;
                        operatorMargin[b.operator_name] = (operatorMargin[b.operator_name] || 0) + net_margin;
                    }

                    if (b.product_type === 'Open Trip') {
                        marginOpenTrip += net_margin;
                        openTripPax[b.product_name] = (openTripPax[b.product_name] || 0) + b.pax;
                    }

                    if (b.service_category === 'PRIVATE DARAT' || b.product_name.toLowerCase().includes('darat')) {
                        privateDaratPax[b.product_name] = (privateDaratPax[b.product_name] || 0) + b.pax;
                    }

                    if (b.ship_name && b.ship_name !== '-') {
                        shipFreq[b.ship_name] = (shipFreq[b.ship_name] || 0) + 1;
                    }

                    if (b.closing_by && b.closing_by !== '-') {
                        salesClosing[b.closing_by] = (salesClosing[b.closing_by] || 0) + 1;
                    }
                });

                const getTop = (map, limit) => Object.entries(map).sort((a,b) => b[1] - a[1]).slice(0, limit).map(e => ({ name: e[0], value: e[1] }));

                res.json({
                    financials: {
                        total_revenue,
                        total_operator_expense: total_hpp,
                        net_margin: total_revenue - total_hpp
                    },
                    products: {
                        top_packages_pax: getTop(packagesPax, 5),
                        top_packages_margin: getTop(packagesMargin, 5),
                        top_operators: getTop(operatorFreq, 5)
                    },
                    goal: {
                        current_pax: total_pax,
                        target_pax: 650
                    },
                    trends: {
                        margin_open_trip: marginOpenTrip,
                        top_3_operators: getTop(operatorFreq, 3),
                        top_5_operators_margin: getTop(operatorMargin, 5),
                        top_open_trip: getTop(openTripPax, 1)[0] || {name: '-', value: 0},
                        top_darat: getTop(privateDaratPax, 1)[0] || {name: '-', value: 0},
                        top_ship: getTop(shipFreq, 1)[0] || {name: '-', value: 0}
                    },
                    sales: getTop(salesClosing, 10)
                });
            });
        });
    });
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
