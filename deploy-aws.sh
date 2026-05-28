#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Vietravel English Test — AWS EC2 Deploy Script
# Run this on a fresh Ubuntu 22.04/24.04 EC2 instance
# Usage: curl -sSL <raw-github-url> | bash
#   or:  bash deploy-aws.sh
# ═══════════════════════════════════════════════════════════════

set -e

echo "═══════════════════════════════════════════════════"
echo "  Vietravel English Test — AWS EC2 Setup"
echo "═══════════════════════════════════════════════════"

# ── 1. System update + dependencies ────────────────────────
echo "[1/7] Updating system..."
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential python3 nginx certbot python3-certbot-nginx

# ── 2. Install Node.js 20 ─────────────────────────────────
echo "[2/7] Installing Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node: $(node --version), npm: $(npm --version)"

# ── 3. Clone repo ─────────────────────────────────────────
echo "[3/7] Cloning repository..."
APP_DIR="/opt/vietravel-exam"
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  git pull origin main
else
  sudo git clone https://github.com/YOUR_ORGANIZATION/YOUR_REPO.git "$APP_DIR"
  cd "$APP_DIR"
fi
sudo chown -R $USER:$USER "$APP_DIR"

# ── 4. Install npm dependencies ───────────────────────────
echo "[4/7] Installing dependencies..."
cd "$APP_DIR"
npm ci --omit=dev

# ── 5. Create .env file ───────────────────────────────────
echo "[5/7] Setting up environment..."
if [ ! -f "$APP_DIR/.env" ]; then
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ADMIN_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  cat > "$APP_DIR/.env" << EOF
NODE_ENV=production
PORT=3000
DATA_DIR=/opt/vietravel-exam/data

JWT_SECRET=${JWT_SECRET}
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}

ADMIN_USERNAME=admin
ADMIN_PASSWORD=\${ADMIN_PASSWORD:-$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")}

ANTHROPIC_API_KEY=\${ANTHROPIC_API_KEY:-YOUR_ANTHROPIC_API_KEY}

EXAM_DURATION_SEC=1800
MAX_LISTENS_PER_AUDIO=2
EOF
  echo "  → Created .env with fresh secrets"
else
  echo "  → .env already exists, skipping"
fi

# ── 6. Create systemd service ─────────────────────────────
echo "[6/7] Creating systemd service..."
sudo tee /etc/systemd/system/vietravel-exam.service > /dev/null << 'EOF'
[Unit]
Description=Vietravel English Test
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/vietravel-exam
ExecStart=/usr/bin/node scripts/init.js && /usr/bin/node server.js
ExecStart=/bin/bash -c 'cd /opt/vietravel-exam && node scripts/init.js && node server.js'
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable vietravel-exam
sudo systemctl restart vietravel-exam

# ── 7. Configure Nginx reverse proxy ─────────────────────
echo "[7/7] Configuring Nginx..."
sudo tee /etc/nginx/sites-available/vietravel-exam > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/vietravel-exam /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ DEPLOY COMPLETE!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  App URL:    http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo "  Admin:      http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)/admin/login.html"
echo "  Exam:       http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)/exam/"
echo ""
echo "  Login:      admin / (check .env for password)"
echo ""
echo "  Logs:       sudo journalctl -u vietravel-exam -f"
echo "  Restart:    sudo systemctl restart vietravel-exam"
echo ""
echo "  ⚡ Để thêm HTTPS (SSL), chạy:"
echo "     sudo certbot --nginx -d yourdomain.com"
echo "═══════════════════════════════════════════════════"
