-- Products by EAN, and one price per product, chain and source.
CREATE TABLE products (
  ean TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  size TEXT
);

CREATE TABLE prices (
  ean TEXT NOT NULL REFERENCES products(ean),
  chain TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('open_prices', 'demo')),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  observed_on TEXT NOT NULL,
  place TEXT,
  PRIMARY KEY (ean, chain, source)
);
CREATE INDEX idx_prices_chain ON prices (chain);

CREATE TABLE imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  at TEXT NOT NULL,
  requests INTEGER NOT NULL,
  prices INTEGER NOT NULL,
  skipped INTEGER NOT NULL
);
