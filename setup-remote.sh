#!/bin/bash
set -e
cd /opt/vietravel-exam

# Create .env
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ADMIN_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

cat > .env << EOF
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
echo "[1] .env created"

# Create data dir
mkdir -p /opt/vietravel-exam/data
echo "[2] data dir ready"

# Test DB init
node -e "require('./src/lib/db'); console.log('[3] DB OK')"

# Run init script
node scripts/init.js
echo "[4] init.js done"

# Create systemd service
sudo tee /etc/systemd/system/vietravel-exam.service > /dev/null << 'SVCEOF'
[Unit]
Description=Vietravel English Test
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/vietravel-exam
ExecStart=/usr/bin/bash -c 'cd /opt/vietravel-exam && node scripts/init.js && node server.js'
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/vietravel-exam/.env

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable vietravel-exam
sudo systemctl restart vietravel-exam
echo "[5] systemd service started"

# Wait and check
sleep 3
curl -s http://localhost:3000/health
echo ""
echo "[6] health check done"

# Install and configure nginx
sudo apt-get install -y nginx > /dev/null 2>&1

sudo tee /etc/nginx/sites-available/vietravel-exam > /dev/null << 'NGXEOF'
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
NGXEOF

sudo ln -sf /etc/nginx/sites-available/vietravel-exam /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
echo "[7] nginx configured"

echo ""
echo "========================================="
echo "  DEPLOY COMPLETE!"
echo "  URL: http://13.229.103.28"
echo "  Admin: http://13.229.103.28/admin/login.html"
echo "  Exam: http://13.229.103.28/exam/"
echo "  Login: admin / (check .env for ADMIN_PASSWORD)"
echo "========================================="
