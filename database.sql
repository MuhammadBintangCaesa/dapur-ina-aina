-- Jalankan ini SEBAGAI ROOT dulu (lewat tab SQL, atau mysql -u root -p)
-- buat bikin user baru bintangc dan kasih akses penuh ke database dapur_ina_aina.
 
CREATE DATABASE IF NOT EXISTS dapur_ina_aina
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
 
CREATE USER IF NOT EXISTS 'bintangc'@'localhost' IDENTIFIED BY 'bintang123';
GRANT ALL PRIVILEGES ON dapur_ina_aina.* TO 'bintangc'@'localhost';
FLUSH PRIVILEGES;
 
-- Dapur Ina Aina: skema MySQL untuk pemesanan, pembayaran, stok, dan laporan.
USE dapur_ina_aina;

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('administrator','kasir') NOT NULL DEFAULT 'kasir',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE categories (
  id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  slug VARCHAR(60) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id TINYINT UNSIGNED NOT NULL,
  sku VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  price DECIMAL(12,2) UNSIGNED NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  minimum_stock INT UNSIGNED NOT NULL DEFAULT 3,
  image_path VARCHAR(255) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories(id),
  INDEX idx_product_stock (stock, is_active)
) ENGINE=InnoDB;

CREATE TABLE orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(25) NOT NULL UNIQUE,
  customer_name VARCHAR(120) DEFAULT NULL,
  order_type ENUM('dine_in','takeaway') NOT NULL DEFAULT 'dine_in',
  table_number VARCHAR(10) DEFAULT NULL,
  subtotal DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('draft','pending_payment','paid','cancelled') NOT NULL DEFAULT 'draft',
  created_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME DEFAULT NULL,
  CONSTRAINT fk_order_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_order_report (status, paid_at)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  unit_price DECIMAL(12,2) UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  subtotal DECIMAL(12,2) UNSIGNED NOT NULL,
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_item_order (order_id)
) ENGINE=InnoDB;

CREATE TABLE payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL UNIQUE,
  payment_method ENUM('cash','debit','credit_card','qris') NOT NULL,
  amount_paid DECIMAL(12,2) UNSIGNED NOT NULL,
  reference_number VARCHAR(100) DEFAULT NULL COMMENT 'Nomor transaksi EDC/debit/kartu kredit',
  paid_by INT UNSIGNED DEFAULT NULL,
  paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_payment_user FOREIGN KEY (paid_by) REFERENCES users(id),
  INDEX idx_payment_report (paid_at, payment_method)
) ENGINE=InnoDB;

CREATE TABLE stock_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  movement_type ENUM('initial','restock','sale','adjustment','waste') NOT NULL,
  quantity_change INT NOT NULL COMMENT 'Positif untuk masuk, negatif untuk keluar',
  stock_after INT UNSIGNED NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  reference_order_id BIGINT UNSIGNED DEFAULT NULL,
  created_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movement_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_movement_order FOREIGN KEY (reference_order_id) REFERENCES orders(id),
  CONSTRAINT fk_movement_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_movement_stock (product_id, created_at)
) ENGINE=InnoDB;

-- Master data awal. Password administrator harus diisi hash bcrypt oleh backend.
INSERT INTO categories (name, slug) VALUES
  ('Makanan Utama', 'makanan-utama'),
  ('Appetizer', 'appetizer'),
  ('Minuman', 'minuman');

INSERT INTO products (category_id, sku, name, price, stock, minimum_stock, image_path) VALUES
  (1, 'MU-001', 'Mie Goreng Jawa', 35000, 20, 3, 'assets/mie-goreng.jpeg'),
  (1, 'MU-002', 'Nasi Uduk', 18000, 20, 3, 'assets/nasi-uduk.webp'),
  (1, 'MU-003', 'Nasi Goreng', 30000, 20, 3, 'assets/Nasi_goreng.jpg'),
  (2, 'AP-001', 'Kue Strawberry', 24000, 15, 3, 'assets/dessert.jpeg'),
  (3, 'MN-001', 'Jus Mangga', 17000, 20, 3, 'assets/jus-mangga.jpeg'),
  (3, 'MN-002', 'Es Teh', 8000, 25, 5, 'assets/esteh.jpeg');

-- Laporan: hanya penjualan yang sudah dibayar yang dihitung.
CREATE OR REPLACE VIEW v_sales_weekly AS
SELECT YEARWEEK(paid_at, 1) AS week_key,
       DATE(MIN(paid_at)) AS period_start,
       DATE(MAX(paid_at)) AS period_end,
       COUNT(*) AS transaction_count,
       SUM(total_amount) AS total_sales
FROM orders
WHERE status = 'paid'
GROUP BY YEARWEEK(paid_at, 1);

CREATE OR REPLACE VIEW v_sales_monthly AS
SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month_key,
       COUNT(*) AS transaction_count,
       SUM(total_amount) AS total_sales
FROM orders
WHERE status = 'paid'
GROUP BY DATE_FORMAT(paid_at, '%Y-%m');

CREATE OR REPLACE VIEW v_low_stock AS
SELECT id, sku, name, stock, minimum_stock
FROM products
WHERE is_active = 1 AND stock <= minimum_stock;